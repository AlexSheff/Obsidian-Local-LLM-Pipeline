import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { createSnapshotSession } from './snapshot';
import { parseNote, serializeNote } from './frontmatter';
import { pruneEmptyParentDirs } from './directoryRevisor';

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

    // Remove existing entry for same file path or filename
    this.queue = this.queue.filter(
      q => q.filePath !== item.filePath && q.filename !== item.filename
    );

    // Build up to 3 questions from top candidates (C7.1)
    const topOptions =
      item.distribution && item.distribution.length > 0
        ? item.distribution.slice(0, 3)
        : [{ letter: 'A', option: item.topFolder || '03_Knowledge', probability: item.confidence }];

    const questions: InteractiveTriageQuestion[] = topOptions.map((opt, idx) => {
      const folder = typeRoutes[opt.option] || opt.option;
      const questionText =
        idx === 0 ? `Is this "${opt.option}"?` : `Then is this "${opt.option}"?`;
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

  /**
   * Updates the tracked file path after refineFile renames or moves a note,
   * preventing stale paths and duplicate file creation if Triage is answered later.
   */
  public syncRefinedFile(
    oldFilePath: string,
    newFilePath: string,
    newRelativeFolder: string,
    newFilename: string
  ): void {
    for (const item of this.queue) {
      if (item.filePath === oldFilePath) {
        item.filePath = newFilePath;
        item.relativePath = newRelativeFolder;
        // Keep original filename searchable or update if needed
        if (!item.filename) {
          item.filename = newFilename;
        }
      }
    }
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
    vaultPath: string,
    options?: {
      rethinkAlternative?: (
        item: InteractiveTriageItem,
        rejectedFolders: string[],
        rejectedOptions: string[]
      ) => Promise<{ option: string; folder: string; reason?: string } | null>;
    }
  ): Promise<{
    resolved: boolean;
    alreadyResolved?: boolean;
    status: 'resolved' | 'pending' | 'manual';
    targetFolder?: string;
    newPath?: string;
    nextQuestion?: InteractiveTriageQuestion;
    rethought?: boolean;
  }> {
    const item = this.queue.find(i => i.id === id);
    if (!item) {
      throw new Error(`Triage item "${id}" not found`);
    }

    if (item.status === 'resolved') {
      return {
        resolved: true,
        alreadyResolved: true,
        status: 'resolved',
        targetFolder: item.resolvedFolder,
        newPath: item.filePath
      };
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
        const feedbackLine =
          JSON.stringify({
            noteId: item.id,
            filePath: item.relativePath,
            question: question.questionText,
            targetOption: question.targetOption,
            answer,
            ts: new Date().toISOString()
          }) + '\n';
        await fsPromises.appendFile(
          path.join(feedbackDir, 'feedback.jsonl'),
          feedbackLine,
          'utf-8'
        );
      }
    } catch (err) {
      console.error('Failed writing to feedback.jsonl:', err);
    }

    if (answer === 'yes') {
      return this.resolveToFolder(item.id, question.targetFolder, vaultPath);
    } else {
      // Answered NO: advance to next candidate question
      item.currentQuestionIndex += 1;

      if (item.currentQuestionIndex < item.questions.length) {
        return {
          resolved: false,
          status: 'pending',
          nextQuestion: item.questions[item.currentQuestionIndex]
        };
      }

      // All initial candidates exhausted: if rethinkAlternative callback is provided, ask AI to rethink and propose a new alternative!
      if (options?.rethinkAlternative && item.questions.length < 8) {
        const rejectedFolders = item.questions.map(q => q.targetFolder);
        const rejectedOptions = item.questions.map(q => q.targetOption);
        try {
          const alt = await options.rethinkAlternative(item, rejectedFolders, rejectedOptions);
          if (alt && alt.folder) {
            const newIdx = item.questions.length;
            const newQuestion: InteractiveTriageQuestion = {
              index: newIdx,
              targetOption: alt.option || alt.folder,
              targetFolder: alt.folder,
              questionText: alt.reason
                ? `${alt.reason} — Move to "${alt.folder}"?`
                : `Alternative suggestion: Move to "${alt.folder}" (${alt.option})?`
            };
            item.questions.push(newQuestion);
            item.status = 'pending';
            return {
              resolved: false,
              status: 'pending',
              nextQuestion: newQuestion,
              rethought: true
            };
          }
        } catch (rethinkErr) {
          console.error('Failed to rethink triage alternative:', rethinkErr);
        }
      }

      // All questions exhausted -> manual review
      item.status = 'manual';
      return {
        resolved: false,
        status: 'manual'
      };
    }
  }

  /**
   * Resolves a triage item directly to a chosen or auto-determined folder,
   * moving the note safely and pruning any empty parent directories left behind.
   */
  public async resolveToFolder(
    id: string,
    targetFolder: string,
    vaultPath: string
  ): Promise<{
    resolved: boolean;
    status: 'resolved';
    targetFolder: string;
    newPath: string;
  }> {
    const item = this.queue.find(i => i.id === id);
    if (!item) {
      throw new Error(`Triage item "${id}" not found`);
    }

    item.status = 'resolved';
    item.resolvedFolder = targetFolder;

    let newPath = item.filePath;
    if (vaultPath && fs.existsSync(item.filePath)) {
      try {
        const oldDir = path.dirname(item.filePath);
        const snapshot = await createSnapshotSession(vaultPath, 'triage_resolve');
        await snapshot.backup(item.filePath);

        const targetDir = path.isAbsolute(targetFolder)
          ? targetFolder
          : path.join(vaultPath, targetFolder);
        await fsPromises.mkdir(targetDir, { recursive: true });
        const currentBaseName = path.basename(item.filePath);
        const destPath = path.join(targetDir, currentBaseName);

        const content = await fsPromises.readFile(item.filePath, 'utf-8');
        const parsed = parseNote(content);
        parsed.data.ai_refined = true;
        parsed.data.category = targetFolder;
        const updatedContent = serializeNote(parsed.data, parsed.body);
        await fsPromises.writeFile(item.filePath, updatedContent, 'utf-8');

        if (path.resolve(item.filePath) !== path.resolve(destPath)) {
          await fsPromises.rename(item.filePath, destPath);
          newPath = destPath;
          item.filePath = destPath;
          item.relativePath = targetFolder;
          await pruneEmptyParentDirs(vaultPath, oldDir);
        }
      } catch (moveErr) {
        console.error('Failed to move file during triage resolution:', moveErr);
      }
    }

    return {
      resolved: true,
      status: 'resolved',
      targetFolder,
      newPath
    };
  }
}

export const triageManager = new TriageManager();
