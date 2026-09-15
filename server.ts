import express from 'express';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import axios from 'axios';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';
import { createServer as createViteServer } from 'vite';
import TurndownService from 'turndown';
import 'dotenv/config';

// Handle pdf-parse default export issue
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

// Init turndown for HTML to MD
const turndownService = new TurndownService({ headingStyle: 'atx' });
// Aggressively remove unwanted elements that clutter the LLM context
turndownService.remove(['style', 'script', 'noscript', 'meta', 'head', 'link']);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// --- Thread-Safe / Concurrency Tools ---
class Mutex {
  private mutex = Promise.resolve();
  lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void;
    this.mutex = this.mutex.then(() => new Promise(begin));
    return new Promise(res => { begin = res; });
  }
}
const registryMutex = new Mutex();

async function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function sanitizeTitle(rawTitle: string, originalName: string) {
  let title = rawTitle || originalName;
  // Remove extensions
  title = title.replace(/\.[a-z0-9]+$/i, '');
  // Remove prefixes like Re:, FW:
  title = title.replace(/^(re|fw|fwd|title|file):\s*/i, '');
  // Remove leading timestamps
  title = title.replace(/^(\d{4}[-_]?\d{2}[-_]?\d{2}[-_]?\d{0,6}|\d{10,14})\s*/, '');
  // Clean illegal chars and truncate
  title = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (title.length > 100) title = title.substring(0, 100).trim();
  if (!title) title = 'Untitled_Document';
  return title;
}

// --- State & Lifecycle ---
let isWatching = false;
let watcher: FSWatcher | null = null;
let currentConfig = {
  vaultPath: '',
  llamaUrl: 'http://127.0.0.1:8080'
};

// Timeout Wrapper for Promises
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms);
    });
    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => clearTimeout(timeoutId));
};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    currentConfig = { ...currentConfig, ...savedConfig };
  }
} catch(e) {}

let logs: { timestamp: string, message: string, type: 'info' | 'error' | 'success' }[] = [];

function addLog(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const log = { timestamp: new Date().toISOString(), message, type };
  logs.unshift(log);
  if (logs.length > 200) logs.pop();
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// --- Queue System with Exponential Backoff ---
interface QueueItem {
  filePath: string;
  retryCount: number;
}
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 1000;
const fileQueue: QueueItem[] = [];
let isProcessingQueue = false;
let isShuttingDown = false;
let activeTasks = 0;

async function processQueue() {
  if (isProcessingQueue || isShuttingDown) return;
  isProcessingQueue = true;
  
  while (fileQueue.length > 0 && !isShuttingDown) {
    const item = fileQueue.shift();
    if (!item) continue;
    
    // Check if file still exists before processing (might be deleted/moved manually)
    try {
       await fsPromises.access(item.filePath);
    } catch {
       continue; 
    }
    
    activeTasks++;
    try {
      await processFile(item.filePath);
    } catch (err: any) {
      addLog(`Error processing ${path.basename(item.filePath)}: ${err.message}`, 'error');
      
      const isRetriable = err.isRetriable !== false;
      
      if (isRetriable && item.retryCount < MAX_RETRIES) {
        addLog(`Re-queueing ${path.basename(item.filePath)} (Retry ${item.retryCount + 1}/${MAX_RETRIES})`, 'info');
        // Exponential backoff pushing to queue asynchronously so it doesn't block the rest
        setTimeout(() => {
            fileQueue.push({ filePath: item.filePath, retryCount: item.retryCount + 1 });
            processQueue(); // trigger if idle
        }, Math.pow(2, item.retryCount) * 2000);
      } else {
        addLog(`Abandoned ${path.basename(item.filePath)}.`, 'error');
      }
    }
    activeTasks--;
  }
  
  isProcessingQueue = false;
}

// --- Graceful Shutdown ---
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  addLog('Initiating graceful shutdown...', 'info');
  if (watcher) await watcher.close();
  
  const startWait = Date.now();
  while (activeTasks > 0 && Date.now() - startWait < 130000) {
    await new Promise(r => setTimeout(r, 500));
  }
  addLog('Shutdown complete.', 'success');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // addLog can't easily be used directly without a mock if we're outside, but wait, addLog is a global function in server.ts
  addLog(`Uncaught Exception: ${err.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  addLog(`Unhandled Rejection: ${reason}`, 'error');
});


// --- Main Processing Logic ---
async function processFile(filePath: string) {
  const originalFilename = path.basename(filePath);
  const fileExtension = path.extname(originalFilename).toLowerCase();
  
  const textExtensions = ['.md', '.txt', '.csv', '.rtf', '.html', '.json', '.xml', '.py', '.js', '.ts', '.yaml', '.yml'];
  const pdfExtensions = ['.pdf'];
  const docxExtensions = ['.docx'];
  
  const isText = textExtensions.includes(fileExtension);
  const isPdf = pdfExtensions.includes(fileExtension);
  const isDocx = docxExtensions.includes(fileExtension);
  const isBinary = !isText && !isPdf && !isDocx;
  
  addLog(`Processing file: ${filePath}`);
  
  const stats = await fsPromises.stat(filePath);
  if (stats.size === 0) {
    const err = new Error('File is empty.');
    (err as any).isRetriable = false;
    throw err;
  }

  let textToProcess = '';     
  let fullConvertedText = ''; 
  
  if (isBinary) {
     textToProcess = `[Binary file. Classify based on filename: ${originalFilename}]`;
  } else if (isPdf) {
    try {
      const dataBuffer = await fsPromises.readFile(filePath);
      const pdfData = await withTimeout(pdfParse(dataBuffer), 30000, 'PDF Parsing');
      const text = pdfData.text || '';
      fullConvertedText = text;
      textToProcess = text.length <= 4000 ? text : text.slice(0, 4000) + '\n\n...[CONTENT OMITTED]...';
    } catch (err: any) {
      addLog(`Failed to parse PDF: ${err.message}. Falling back to filename.`, 'error');
      textToProcess = `[Error extracting text. Please classify based on filename: ${originalFilename}]`;
    }
  } else if (isDocx) {
    try {
      const result = await withTimeout(mammoth.convertToHtml({ path: filePath }), 30000, 'DOCX Parsing');
      const html = result.value || '';
      const mdText = turndownService.turndown(html);
      fullConvertedText = mdText;
      textToProcess = mdText.length <= 4000 ? mdText : mdText.slice(0, 4000) + '\n\n...[CONTENT OMITTED]...';
    } catch (err: any) {
      addLog(`Failed to parse DOCX: ${err.message}. Falling back to filename.`, 'error');
      textToProcess = `[Error extracting text. Please classify based on filename: ${originalFilename}]`;
    }
  } else {
    // Is Text/HTML/JSON
    try {
      let originalContent = await fsPromises.readFile(filePath, 'utf-8');
      
      let text = originalContent.replace(/\uFFFD/g, ''); 
      
      if (fileExtension === '.md') {
        text = text.replace(/^---\n[\s\S]*?\n---\n*/, '');
        fullConvertedText = text;
      } else if (fileExtension === '.json') {
        try {
          const parsed = JSON.parse(text);
          if (parsed.textContent) {
            text = (parsed.title ? parsed.title + '\n\n' : '') + parsed.textContent;
          } else {
            const extractStrings = (obj: any): string => {
              if (typeof obj === 'string') return obj;
              if (Array.isArray(obj)) return obj.map(extractStrings).filter(Boolean).join('\n');
              if (typeof obj === 'object' && obj !== null) return Object.values(obj).map(extractStrings).filter(Boolean).join('\n');
              return '';
            };
            text = extractStrings(parsed);
          }
          fullConvertedText = text;
        } catch (e) {
          fullConvertedText = text;
        }
      } else if (fileExtension === '.html' || fileExtension === '.xml') {
        try {
          // Pre-emptively strip styles and scripts using robust regex before Turndown processes it
          let cleanHtml = text
             .replace(/<\?xml.*?\?>/gi, '')
             .replace(/<!DOCTYPE.*?>/gi, '')
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
             .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ''); // Google Keep embeds giant inline SVGs
          text = turndownService.turndown(cleanHtml);
          fullConvertedText = text;
        } catch (e) {
          addLog(`turndown failed, using basic cleanup.`, 'error');
          let basicClean = text
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
          text = basicClean.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          fullConvertedText = text;
        }
      } else {
         fullConvertedText = text;
      }
      
      if (fullConvertedText.length <= 4000) {
        textToProcess = fullConvertedText;
      } else {
        textToProcess = fullConvertedText.slice(0, 4000) + '\n\n...[MIDDLE CONTENT OMITTED]...';
      }
    } catch (err: any) {
      addLog(`Failed to read file text: ${err.message}. Falling back to filename classification.`, 'error');
      textToProcess = `[Error reading text file. Classify based on filename: ${originalFilename}]`;
    }
  }
  
  addLog(`Sending to local LLM at ${currentConfig.llamaUrl}`);
  
  const prompt = `
Analyze the text and output a JSON object.
DO NOT output any markdown, explanations, or backticks. Return ONLY raw JSON.

Extract these exactly 5 fields:
1. "title" (string): Create a highly descriptive title based on the core topic, entities, or event discussed (e.g. 'Interview with John Doe', 'Project Apollo Specs'). DO NOT just copy the filename or use generic words like 'Transcript'.
2. "summary" (string): 1-2 sentence summary of the content.
3. "category" (string): MUST be one of: "People", "Organizations", "Knowledge", "Projects", "Journal", "Ideas", "Inbox". Pick the best fit.
4. "tags" (array of strings): Relevant topic tags (no '#' needed).
5. "related_concepts" (array of strings): Extract 3-7 core concepts, names, or topics mentioned in the text to be used as graph links.

Text:
${textToProcess}
`;

  let responseContent = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout
  
  try {
    const payload: any = {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1500,
      stream: false
    };
    
    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, payload, { 
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    responseContent = response.data.choices[0].message.content;
  } catch (llmError: any) {
    clearTimeout(timeoutId);
    if (llmError.name === 'CanceledError' || llmError.code === 'ECONNABORTED') {
       throw new Error(`LLM Error: Request timed out after 120 seconds.`);
    }
    if (llmError.response && llmError.response.status === 400) {
        throw new Error(`LLM Error 400: Context length exceeded or invalid format.`);
    }
    if (llmError.code === 'ECONNREFUSED') {
      throw new Error(`LLM Server is not running at ${currentConfig.llamaUrl}.`);
    }
    throw new Error(`LLM request failed: ${llmError.message}`);
  }
  
  // Robust JSON Extraction
  let jsonStr = responseContent.trim();
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  
  let data: any = {};
  try {
    let cleanedJsonStr = jsonStr
       .replace(/,\s*([\}\]])/g, '$1')
       .replace(/\n/g, ' '); 
    data = JSON.parse(cleanedJsonStr);
  } catch (parseError: any) {
    addLog(`JSON Parse failed for ${originalFilename}: ${parseError.message}. Using aggressive fallback string extraction.`, 'error');
    const extractField = (key: string) => {
       const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i');
       const match = jsonStr.match(regex);
       return match ? match[1].trim() : null;
    };
    
    data = {
      title: extractField("title") || originalFilename.replace(/\.[^/.]+$/, ""),
      category: extractField("category") || 'Inbox',
      summary: extractField("summary") || 'Automatic fallback due to model parsing error.',
      tags: ['processing_error'],
      related_concepts: []
    };
  }
  
  // Routing
  const category = data.category || 'Inbox';
  let destFolder = path.join('00_Inbox', 'Processed'); 
  
  if (category === 'People') destFolder = path.join('02_Areas', 'People');
  else if (category === 'Organizations') destFolder = path.join('02_Areas', 'Organizations');
  else if (category === 'Knowledge') destFolder = path.join('03_Knowledge', 'Topics');
  else if (category === 'Projects') destFolder = path.join('01_Projects', 'Active');
  else if (category === 'Journal') destFolder = path.join('04_Journal', 'Daily');
  else if (category === 'Ideas') destFolder = path.join('05_Ideas', 'Inbox');
  
  let safeTitle = sanitizeTitle(data.title, originalFilename);
  let mdFilename = `${safeTitle}.md`;
  
  const formatArray = (arr: any) => {
    if (!arr) return [];
    if (Array.isArray(arr)) return arr;
    if (typeof arr === 'string') return arr.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const parsedTags = formatArray(data.tags).map((t: string) => {
    let tag = String(t).trim().replace(/^#/, '').replace(/\s+/g, '-');
    return `#${tag}`;
  }).filter((t: string) => t !== '#' && t !== '#null' && t !== '#undefined');
  
  const tagsYaml = parsedTags.length > 0 ? `\n  - ${parsedTags.map(t => `"${t}"`).join('\n  - ')}` : ' []';
  
  const safeSummary = (data.summary || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
  
  const frontmatter = `---
title: "${safeTitle.replace(/"/g, '\\"').replace(/\n/g, ' ')}"
category: ${category}
tags:${tagsYaml}
summary: "${safeSummary}"
---
`;

  let destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
  
  // Handle collisions
  let counter = 1;
  while (fs.existsSync(destMdPath)) {
      mdFilename = `${safeTitle} ${counter}.md`;
      destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
      counter++;
  }
  
  await fsPromises.mkdir(path.dirname(destMdPath), { recursive: true });
  
  let linksBlock = '';
  const concepts = formatArray(data.related_concepts);
  if (concepts.length > 0) {
    linksBlock = `> **Связанные темы:** ${concepts.map((c: string) => `[[${c}]]`).join(', ')}\n\n`;
  }

  let finalContent = frontmatter + linksBlock;
  let destResourcePath = '';
  
  if (isBinary || isPdf || isDocx) {
    // Preserve binary/pdf/docx original file as attachment
    let resourceFilename = `${safeTitle.replace(/\s+/g, '_')}${fileExtension}`;
    destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
    
    let resCounter = 1;
    while (fs.existsSync(destResourcePath)) {
        resourceFilename = `${safeTitle.replace(/\s+/g, '_')}_${resCounter}${fileExtension}`;
        destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
        resCounter++;
    }
    
    finalContent += `**Исходный файл:** [[${resourceFilename}]]\n\n---\n\n`;
    if (!isBinary) {
       finalContent += fullConvertedText;
    } else {
       finalContent += `*(Бинарный файл не конвертируется в Markdown)*`;
    }
  } else {
    // Pure text -> just inject
    finalContent += fullConvertedText;
  }
  
  // ATOMIC WRITES
  const tmpMdPath = destMdPath + '.tmp';
  try {
    await fsPromises.writeFile(tmpMdPath, finalContent);
    await fsPromises.rename(tmpMdPath, destMdPath);
    addLog(`Created note: ${destFolder}/${mdFilename}`, 'success');
  } catch (writeErr: any) {
    if (fs.existsSync(tmpMdPath)) await fsPromises.unlink(tmpMdPath).catch(()=>null);
    throw new Error(`Failed to write note: ${writeErr.message}`);
  }
  
  // ATOMIC ATTACHMENT COPY
  if (destResourcePath) {
    const tmpResPath = destResourcePath + '.tmp';
    try {
      await fsPromises.copyFile(filePath, tmpResPath);
      await fsPromises.rename(tmpResPath, destResourcePath);
      addLog(`Copied attachment to: ${destFolder}/${path.basename(destResourcePath)}`, 'success');
    } catch (copyErr: any) {
      if (fs.existsSync(tmpResPath)) await fsPromises.unlink(tmpResPath).catch(()=>null);
      addLog(`Failed to copy attachment: ${copyErr.message}`, 'error');
    }
  }
  
  // HASH & MOVE ORIGINAL (Guaranteed no loss since we reached here successfully)
  const hash = await getFileHash(filePath);
  const inboxRoot = path.join(currentConfig.vaultPath, '00_Inbox');
  let relativePath = path.relative(inboxRoot, filePath); 
  const rawFolder = path.join(currentConfig.vaultPath, '99_System', '_keep_raw', 'inbox');
  
  const relativeDir = path.dirname(relativePath);
  const targetRawFolder = path.join(rawFolder, relativeDir);
  await fsPromises.mkdir(targetRawFolder, { recursive: true });
  
  const originalMovePath = path.join(targetRawFolder, `${hash}_${originalFilename}`);
  
  try {
    // Retry mechanism for locked files (EBUSY/EPERM)
    let moved = false;
    let moveRetries = 0;
    while (!moved && moveRetries < 5) {
      try {
        await fsPromises.rename(filePath, originalMovePath);
        moved = true;
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await fsPromises.copyFile(filePath, originalMovePath);
          await fsPromises.unlink(filePath);
          moved = true;
        } else if (err.code === 'EPERM' || err.code === 'EBUSY') {
          moveRetries++;
          await new Promise(r => setTimeout(r, 500));
        } else {
          throw err;
        }
      }
    }
    if (!moved) throw new Error("File locked permanently");
    addLog(`Archived original to: 99_System/_keep_raw/inbox/${relativeDir !== '.' ? relativeDir + '/' : ''}${hash}_${originalFilename}`);
  } catch (renameErr: any) {
    throw new Error(`Failed to archive original file: ${renameErr.message}`);
  }
  
  // SERIALIZED REGISTRY UPDATE (Mutex + Avoiding full JSON.parse)
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  const unlock = await registryMutex.lock();
  try {
    const newEntry = {
      hash,
      original_path: `00_Inbox/${relativePath}`,
      destination: `${destFolder}/${mdFilename}`,
      category: category,
      processed_at: new Date().toISOString()
    };
    
    const entryStr = JSON.stringify(newEntry, null, 2);
    
    if (!fs.existsSync(registryPath)) {
      await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
    } else {
      // Append-like injection for standard JSON array to save memory
      const stats = await fsPromises.stat(registryPath);
      if (stats.size > 2) {
         // File has content like [ ... ]
         // We open the file, chop the last bracket ']', append the new item, and close the bracket.
         const fd = await fsPromises.open(registryPath, 'r+');
         
         // Search for the last ']' bracket
         let position = stats.size - 1;
         let found = false;
         const buffer = Buffer.alloc(1);
         while (position >= 0) {
            await fd.read(buffer, 0, 1, position);
            if (buffer.toString('utf-8') === ']') {
               found = true;
               break;
            }
            position--;
         }
         
         if (found) {
             const appendStr = `,\n${entryStr}\n]`;
             await fd.write(appendStr, position);
         } else {
             // Fallback if badly formatted
             await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
         }
         await fd.close();
      } else {
         await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
      }
    }
  } catch (err: any) {
     addLog(`Failed to update registry efficiently: ${err.message}`, 'error');
  } finally {
    unlock();
  }
  
  // Auto-update MOCs
  try {
    const mocsDir = path.join(currentConfig.vaultPath, '00_MOC');
    const link = `[[${mdFilename.replace('.md', '')}]]`;
    
    if (destFolder.includes('03_Knowledge')) {
      const p = path.join(mocsDir, 'moc_topics.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (destFolder.includes('01_Projects')) {
      const p = path.join(mocsDir, 'moc_projects.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (destFolder.includes('02_Areas') && category === 'People') {
      const p = path.join(mocsDir, 'moc_people.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (parsedTags && parsedTags.length > 0) {
      const p = path.join(mocsDir, 'moc_tags.md');
      if (fs.existsSync(p)) {
        const newTags = parsedTags.map(t => `- ${t} => ${link}`).join('\n');
        await fsPromises.appendFile(p, `\n${newTags}`);
      }
    }
  } catch(mocErr) {
     addLog(`Failed to update MOCs.`, 'error');
  }
}

// --- API Routes ---
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.post('/api/config', async (req, res) => {
  const { vaultPath, llamaUrl } = req.body;
  if (vaultPath !== undefined) currentConfig.vaultPath = vaultPath;
  if (llamaUrl !== undefined) currentConfig.llamaUrl = llamaUrl;
  
  try {
    await fsPromises.writeFile(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
  } catch(e) {}
  
  res.json({ success: true, config: currentConfig });
});

app.get('/api/status', (req, res) => {
  res.json({ isWatching, vaultPath: currentConfig.vaultPath, queueLength: fileQueue.length });
});

app.post('/api/start', async (req, res) => {
  if (isWatching) return res.json({ success: false, message: 'Already watching' });
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  
  const inboxPath = path.join(currentConfig.vaultPath, '00_Inbox');
  
  try {
    await fsPromises.mkdir(inboxPath, { recursive: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not access or create 00_Inbox in vault' });
  }

  isWatching = true;
  addLog(`Started watching ${inboxPath}`, 'success');
  
  watcher = chokidar.watch(inboxPath, {
    ignored: [
      /(^|[\\/])\../,
      (testPath: string) => {
         const parts = testPath.split(path.sep);
         return parts.includes('Review') || parts.includes('Processed');
      }
    ],
    persistent: true,
    depth: 99,
    ignoreInitial: false, // Important: Process existing files on start
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });
  
  watcher.on('add', (filePath) => {
    if (filePath.includes('/Review/') || filePath.includes('\\Review\\')) return;
    if (filePath.includes('/Processed/') || filePath.includes('\\Processed\\')) return;
    
    if (fileQueue.length >= MAX_QUEUE_SIZE) {
       addLog(`Queue is full! Dropping event for ${path.basename(filePath)}.`, 'error');
       return;
    }
    
    fileQueue.push({ filePath, retryCount: 0 });
    processQueue();
  });
  
  res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
  if (!isWatching) return res.json({ success: false, message: 'Not watching' });
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  isWatching = false;
  addLog('Stopped watching inbox');
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.post('/api/init-vault', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  const vaultPath = currentConfig.vaultPath;
  
  try {
    const dirs = [
      '00_Inbox', '00_Inbox/Processed',
      '01_Projects/Active', '01_Projects/Incubator', '01_Projects/Archive',
      '02_Areas/People', '02_Areas/Organizations', '02_Areas/Places', '02_Areas/Entities',
      '03_Knowledge/Concepts', '03_Knowledge/Topics', '03_Knowledge/References', '03_Knowledge/Documents',
      '04_Journal/Daily', '04_Journal/Meetings', '04_Journal/Events',
      '05_Ideas/Inbox', '05_Ideas/Developing', '05_Ideas/Archive',
      '06_Archive/Projects', '06_Archive/Knowledge', '06_Archive/Other',
      '00_MOC',
      '99_System/_keep_raw/inbox', '99_System/templates', '99_System/prompts', '99_System/logs'
    ];
    
    for (const dir of dirs) {
      await fsPromises.mkdir(path.join(vaultPath, dir), { recursive: true });
    }
    
    const mocs = ['moc_projects.md', 'moc_people.md', 'moc_topics.md', 'moc_tags.md'];
    for (const moc of mocs) {
      const mocPath = path.join(vaultPath, '00_MOC', moc);
      if (!fs.existsSync(mocPath)) {
        await fsPromises.writeFile(mocPath, `# ${moc.replace('.md', '').replace('moc_', 'MOC ')}\n\nMap of Content.`);
      }
    }
    
    const sysFiles = ['_processing_registry.json', '_knowledge_index.json', '_pipeline_report.json', '_test_report.json'];
    for (const sys of sysFiles) {
      const sysPath = path.join(vaultPath, '99_System', sys);
      if (!fs.existsSync(sysPath)) {
        await fsPromises.writeFile(sysPath, sys.endsWith('.json') ? '[]' : '');
      }
    }
    
    addLog('Vault structure initialized successfully', 'success');
    res.json({ success: true, message: 'Vault initialized' });
  } catch (error: any) {
    addLog(`Error initializing vault: ${error.message}`, 'error');
    res.status(500).json({ error: 'Could not initialize vault structure' });
  }
});

app.get('/api/registry', async (req, res) => {
  if (!currentConfig.vaultPath) return res.json([]);
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  if (fs.existsSync(registryPath)) {
    const unlock = await registryMutex.lock();
    try {
      const regContent = await fsPromises.readFile(registryPath, 'utf-8');
      res.json(JSON.parse(regContent));
    } catch (e) {
      res.json([]);
    } finally {
      unlock();
    }
  } else {
    res.json([]);
  }
});

app.post('/api/generate-digest', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  
  if (!fs.existsSync(registryPath)) return res.status(400).json({ error: 'No files processed yet' });
  
  try {
    let registry: any[] = [];
    const unlock = await registryMutex.lock();
    try {
      const regContent = await fsPromises.readFile(registryPath, 'utf-8');
      registry = JSON.parse(regContent);
    } catch (e) {
      registry = [];
    } finally {
      unlock();
    }
    
    const todayStr = new Date().toLocaleDateString('sv-SE'); 
    const todayItems = registry.filter((item: any) => {
        if (!item.processed_at) return false;
        const itemDate = new Date(item.processed_at);
        return itemDate.toLocaleDateString('sv-SE') === todayStr;
    });
    
    if (todayItems.length === 0) return res.status(400).json({ error: 'No files processed today to summarize.' });
    
    addLog(`Generating daily digest for ${todayItems.length} items...`);
    
    let summaries = [];
    for (const item of todayItems) {
      try {
        const filePath = path.join(currentConfig.vaultPath, item.destination);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const summaryMatch = content.match(/summary:\s*["']?([^"'\n]+)["']?/);
        // Ensure Analytics field matches the V3 property item.category
        if (summaryMatch && summaryMatch[1]) {
           summaries.push(`- ${path.basename(item.destination)} (${item.category || 'unknown'}): ${summaryMatch[1]}`);
        } else {
           summaries.push(`- ${path.basename(item.destination)} (${item.category || 'unknown'})`);
        }
      } catch (err) {}
    }
    
    const prompt = `You are a helpful knowledge assistant. I have processed ${todayItems.length} notes today.
Here is the list of notes and their summaries:
${summaries.join('\n')}

Write a concise "Daily Digest" journal entry summarizing what I focused on today, what types of concepts or projects I worked on, and any overarching themes. Format it in Markdown. Use a professional, reflective tone.`;

    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        stream: false
    }, { timeout: 120000 });
    
    const digestContent = response.data.choices[0].message.content;
    const digestPath = path.join(currentConfig.vaultPath, '04_Journal', 'Daily', `${todayStr}-Digest.md`);
    
    // Atomic Write
    await fsPromises.mkdir(path.dirname(digestPath), { recursive: true });
    const tmpDigestPath = digestPath + '.tmp';
    const finalFileContent = `---
type: "journal"
tags: ["daily-digest", "log"]
date: "${todayStr}"
---

# Daily Digest: ${todayStr}

${digestContent.trim()}
`;

    await fsPromises.writeFile(tmpDigestPath, finalFileContent);
    await fsPromises.rename(tmpDigestPath, digestPath);
    
    addLog(`Created daily digest: 04_Journal/Daily/${todayStr}-Digest.md`, 'success');
    res.json({ success: true, message: 'Digest created successfully' });
    
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
       addLog(`LLM Server is not running. Start it to generate digests.`, 'error');
       return res.status(500).json({ error: 'LLM Server not running.' });
    }
    addLog(`Digest error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to generate digest: ' + err.message });
  }
});

// Vite middleware for dev or static serving for prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
