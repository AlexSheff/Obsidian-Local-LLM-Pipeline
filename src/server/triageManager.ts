import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { createSnapshotSession } from './snapshot';
import { parseNote, serializeNote } from './frontmatter';

export interface InteractiveTriageQuestion {
  index: number;
  targetOption: string;
  targetFolder: string;
  questionText: string;
  answered?: 'yes' | 'no';
  timestamp?: string;
}

export interface InteractiveTriageItem {
  id: string;
  filePath: string;
  relativePath: string;
  filename: string;
  contentType: string;
  confidence: number;
  distribution: Array<{ letter: string; option: string; probability: number }>;
  currentQuestionIndex: number;
  questions: InteractiveTriageQuestion[];
  status: 'pending' | 'resolved' | 'manual';
  resolvedFolder?: string;
  timestamp: string;
}

export class TriageManager {
  private queue: InteractiveTriageItem[] = [];

  constructor() {}

  public getQueue(): InteractiveTriageItem[] {
    return this.queue;
  }

  public getPendingCount(): number {
    return this.queue.filter(i => i.status === 'pending').length;
  }

  public enqueue(
    item: {
      id?: string;
      filePath: string;
      relativePath: string;
      filename: string;
      contentType: string;
      confidence: number;
      topFolder?: string;
      distribution: Array<{ letter: string; option: string; probability: number }>;
    },
    typeRoutes: Record<string, string> = {}
  ): InteractiveTriageItem {
    const id = item.id || `triage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Remove existing entry for same file path
    this.queue = this.queue.filter(q => q.filePath !== item.filePath);

    // Build up to 3 questions from top candidates (C7.1)
    const topOptions = item.distribution && item.distribution.length > 0
      ? item.distribution.slice(0, 3)
      : [{ letter: 'A', option: item.topFolder || '03_Knowledge', probability: item.confidence }];

    const questions: InteractiveTriageQuestion[] = topOptions.map((opt, idx) => {
      const folder = typeRoutes[opt.option] || opt.option;
      const questionText = idx === 0
        ? `Это "${opt.option}"?`
        : `Тогда это "${opt.option}"?`;
      return {
        index: idx,
        targetOption: opt.option,
        targetFolder: folder,
        questionText
      };
    });

    const triageItem: InteractiveTriageItem = {
      id,
      filePath: item.filePath,
      relativePath: item.relativePath,
      filename: item.filename,
      contentType: item.contentType,
      confidence: item.confidence,
      distribution: item.distribution || [],
      currentQuestionIndex: 0,
      questions,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    this.queue.unshift(triageItem);
    if (this.queue.length > 150) this.queue.pop();
    return triageItem;
  }

  public getNext(): { item: InteractiveTriageItem; question: InteractiveTriageQuestion } | null {
    const pendingItem = this.queue.find(
      i => i.status === 'pending' && i.currentQuestionIndex < i.questions.length
    );
    if (!pendingItem) return null;

    const question = pendingItem.questions[pendingItem.currentQuestionIndex];
    if (!question) return null;

    return { item: pendingItem, question };
  }

  public async answerQuestion(
    id: string,
    questionIndex: number,
    answer: 'yes' | 'no',
    vaultPath: string
  ): Promise<{
    resolved: boolean;
    status: 'resolved' | 'pending' | 'manual';
    targetFolder?: string;
    newPath?: string;
  }> {
    const item = this.queue.find(i => i.id === id);
    if (!item) {
      throw new Error(`Triage item "${id}" not found`);
    }

    const question = item.questions[questionIndex];
    if (!question) {
      throw new Error(`Question index ${questionIndex} out of bounds`);
    }

    question.answered = answer;
    question.timestamp = new Date().toISOString();

    // Log answer to feedback.jsonl (C7.3)
    try {
      if (vaultPath && fs.existsSync(vaultPath)) {
        const feedbackDir = path.join(vaultPath, '99_System', 'index');
        await fsPromises.mkdir(feedbackDir, { recursive: true });
        const feedbackLine = JSON.stringify({
          noteId: item.id,
          filePath: item.relativePath,
          question: question.questionText,
          targetOption: question.targetOption,
          answer,
          ts: new Date().toISOString()
        }) + '\n';
        await fsPromises.appendFile(path.join(feedbackDir, 'feedback.jsonl'), feedbackLine, 'utf-8');
      }
    } catch (err) {
      console.error('Failed writing to feedback.jsonl:', err);
    }

    if (answer === 'yes') {
      item.status = 'resolved';
      item.resolvedFolder = question.targetFolder;

      // Physically execute move with snapshot backup
      let newPath = item.filePath;
      if (vaultPath && fs.existsSync(item.filePath)) {
        try {
          const snapshot = await createSnapshotSession(vaultPath, 'triage_resolve');
          await snapshot.backup(item.filePath);

          const targetDir = path.isAbsolute(question.targetFolder)
            ? question.targetFolder
            : path.join(vaultPath, question.targetFolder);
          await fsPromises.mkdir(targetDir, { recursive: true });
          const destPath = path.join(targetDir, item.filename);

          // Update frontmatter with ai_refined
          const content = await fsPromises.readFile(item.filePath, 'utf-8');
          const parsed = parseNote(content);
          parsed.data.ai_refined = true;
          parsed.data.category = question.targetFolder;
          const updatedContent = serializeNote(parsed.data, parsed.body);
          await fsPromises.writeFile(item.filePath, updatedContent, 'utf-8');

          if (item.filePath !== destPath) {
            await fsPromises.rename(item.filePath, destPath);
            newPath = destPath;
          }
        } catch (moveErr) {
          console.error('Failed to move file during triage answer:', moveErr);
        }
      }

      return {
        resolved: true,
        status: 'resolved',
        targetFolder: question.targetFolder,
        newPath
      };
    } else {
      // Answered NO: advance to next question
      item.currentQuestionIndex += 1;
      if (item.currentQuestionIndex >= item.questions.length) {
        // All questions exhausted -> manual review
        item.status = 'manual';
        return {
          resolved: false,
          status: 'manual'
        };
      } else {
        return {
          resolved: false,
          status: 'pending'
        };
      }
    }
  }
}

export const triageManager = new TriageManager();
