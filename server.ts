import express from 'express';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import chokidar from 'chokidar';
import axios from 'axios';
import { createRequire } from 'module';
const req = typeof require !== 'undefined' ? require : createRequire(import.meta.url);
const pdfParseModule = req('pdf-parse');
const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule.default || pdfParseModule);
const mammothModule = req('mammoth');
const mammoth = typeof mammothModule === 'function' ? mammothModule : (mammothModule.default || mammothModule);
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// State for the pipeline
let isWatching = false;
let watcher: chokidar.FSWatcher | null = null;
let currentConfig = {
  vaultPath: '',
  llamaUrl: 'http://127.0.0.1:8080'
};

// Load config from disk if exists
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    currentConfig = { ...currentConfig, ...savedConfig };
  }
} catch(e) {}

let logs: { timestamp: string, message: string, type: 'info' | 'error' | 'success' }[] = [];

// Queue system to process one file at a time so we don't overload the local LLM
const fileQueue: string[] = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  while (fileQueue.length > 0) {
    const filePath = fileQueue.shift();
    if (filePath) {
      await processFile(filePath);
    }
  }
  
  isProcessingQueue = false;
}

function addLog(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const log = { timestamp: new Date().toISOString(), message, type };
  logs.unshift(log);
  if (logs.length > 200) logs.pop();
  console.log(`[${type.toUpperCase()}] ${message}`);
}

async function processFile(filePath: string) {
  const originalFilename = path.basename(filePath);
  const fileExtension = path.extname(originalFilename).toLowerCase();
  
  // Categorize file extensions
  const textExtensions = ['.md', '.txt', '.csv', '.rtf', '.html', '.json', '.xml', '.py', '.js', '.ts', '.yaml', '.yml'];
  const pdfExtensions = ['.pdf'];
  const docxExtensions = ['.docx'];
  
  if (!textExtensions.includes(fileExtension) && !pdfExtensions.includes(fileExtension) && !docxExtensions.includes(fileExtension) && fileExtension !== '') {
    addLog(`Skipped unsupported file type: ${originalFilename}`);
    return;
  }
  
  addLog(`Processing file: ${filePath}`);
  try {
    const stats = await fsPromises.stat(filePath);
    if (stats.size === 0) {
      addLog(`Skipped empty file: ${originalFilename}`, 'error');
      return;
    }

    let textToProcess = '';
    let originalContent = '';
    
    if (pdfExtensions.includes(fileExtension)) {
      try {
        const dataBuffer = await fsPromises.readFile(filePath);
        const pdfData = await pdfParse(dataBuffer);
        const text = pdfData.text;
        textToProcess = text.length <= 5000 ? text : text.slice(0, 2500) + '\n\n...[CONTENT OMITTED]...\n\n' + text.slice(-2500);
      } catch (err: any) {
        throw new Error(`Failed to parse PDF: ${err.message}`);
      }
    } else if (docxExtensions.includes(fileExtension)) {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value;
        originalContent = text; // Save it so we can include it in the markdown block if needed, though for docx we usually attach it
        textToProcess = text.length <= 5000 ? text : text.slice(0, 2500) + '\n\n...[CONTENT OMITTED]...\n\n' + text.slice(-2500);
      } catch (err: any) {
        throw new Error(`Failed to parse DOCX: ${err.message}`);
      }
    } else {
      originalContent = await fsPromises.readFile(filePath, 'utf-8');
      
      // Attempt to clean encoding artifacts/weird chars if any
      let text = originalContent.replace(/\uFFFD/g, ''); 
      
      if (fileExtension === '.html' || fileExtension === '.xml') {
        text = text.replace(/<[^>]*>?/gm, '\n').replace(/\n\s*\n/g, '\n').trim();
      }
      
      textToProcess = text.length <= 5000 ? text : text.slice(0, 2500) + '\n\n...[CONTENT OMITTED]...\n\n' + text.slice(-2500);
    }
    
    addLog(`Sending to local LLM at ${currentConfig.llamaUrl}`);
    
    const prompt = `
You are an expert system that extracts information from notes and categorizes them into a PARA structure.
Read the following text and extract exactly 8 fields in strict JSON format. 
Do not include markdown blocks like \`\`\`json. Output ONLY the JSON object.

The required fields are:
1. "title" (string): A short, clear title for the document.
2. "type" (string): MUST be one of the following exact strings:
   - "person", "contact" (for people, contacts, character profiles)
   - "organization", "place", "entity" (for companies, locations, generic entities)
   - "project", "plan", "task" (for actionable projects or plans)
   - "story", "scenario", "script", "short_film", "essay", "article", "document" (for creative writing, scripts, and texts)
   - "idea", "concept", "note", "research", "tutorial", "list" (for general knowledge)
   - "reference", "whitepaper", "specification", "technical_document" (for technical references)
   - "journal", "meeting", "event", "dialogue", "transcript", "correspondence" (for time-based logs and conversations)
   - "archive", "unknown" (if none fit)
3. "summary" (string): A brief summary of the content.
4. "tags" (array of strings): List of tags without the '#' symbol.
5. "entities" (array of strings): List of people, orgs, or places mentioned.
6. "projects" (array of strings): List of related projects.
7. "tasks" (array of strings): List of actionable tasks identified.
8. "key_points" (array of strings): 3-5 key points extracted.

Text:
${textToProcess}
`;

    let responseContent = '';
    try {
      const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        stream: false
      }, { timeout: 120000 }); // 2-minute timeout for CPU-bound generation
      
      responseContent = response.data.choices[0].message.content;
    } catch (llmError: any) {
      if (llmError.code === 'ECONNREFUSED') {
        throw new Error(`LLM Server is not running at ${currentConfig.llamaUrl}. Please start it using start.bat`);
      }
      throw new Error(`LLM request failed: ${llmError.message}`);
    }
    
    // Clean response (remove markdown if it's there)
    let jsonStr = responseContent.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.replace(/^```json/, '');
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```/, '');
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.replace(/```$/, '');
    
    let data: any = {};
    try {
      data = JSON.parse(jsonStr.trim());
    } catch (parseError: any) {
      addLog(`JSON Parse failed for ${originalFilename}: ${parseError.message}. Using fallback.`, 'error');
      // Fallback behavior
      const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]+)"/i);
      data = {
        title: titleMatch ? titleMatch[1] : originalFilename.replace(/\.[^/.]+$/, ""),
        type: 'knowledge_topic',
        summary: 'Automatic fallback due to model parsing error.',
        tags: 'processing_error',
        key_points: '',
        entities: '',
        projects: '',
        tasks: ''
      };
    }
    
    const semanticType = data.type?.toLowerCase() || 'unknown';
    let destFolder = path.join('03_Knowledge', 'Topics'); // default
    
    if (['project', 'plan', 'task'].includes(semanticType)) destFolder = path.join('01_Projects', 'Active');
    else if (['person', 'contact'].includes(semanticType)) destFolder = path.join('02_Areas', 'People');
    else if (semanticType === 'organization') destFolder = path.join('02_Areas', 'Organizations');
    else if (semanticType === 'place') destFolder = path.join('02_Areas', 'Places');
    else if (semanticType === 'entity') destFolder = path.join('02_Areas', 'Entities');
    else if (semanticType === 'concept') destFolder = path.join('03_Knowledge', 'Concepts');
    else if (['topic', 'note', 'research', 'tutorial', 'list', 'correspondence', 'unknown'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Topics');
    else if (['reference', 'whitepaper', 'specification', 'technical_document'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'References');
    else if (['document', 'article', 'essay', 'story', 'scenario', 'script', 'short_film', 'dialogue', 'transcript'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Documents');
    else if (semanticType === 'journal') destFolder = path.join('04_Journal', 'Daily');
    else if (semanticType === 'meeting') destFolder = path.join('04_Journal', 'Meetings');
    else if (semanticType === 'event') destFolder = path.join('04_Journal', 'Events');
    else if (semanticType === 'idea') destFolder = path.join('05_Ideas', 'Inbox');
    else if (semanticType === 'archive') destFolder = path.join('06_Archive', 'Other');
    
    // Helper to format arrays safely
    const formatArray = (arr: any) => {
      if (!arr) return [];
      if (Array.isArray(arr)) return arr;
      if (typeof arr === 'string') return arr.split(',').map(s => s.trim()).filter(Boolean);
      return [];
    };

    // Format tags as a valid YAML list (with #)
    const parsedTags = formatArray(data.tags).map((t: string) => {
      let tag = String(t).trim().replace(/^#/, '');
      tag = tag.replace(/\s+/g, '-');
      return `#${tag}`;
    }).filter((t: string) => t !== '#' && t !== '#null' && t !== '#undefined');
    
    // In YAML frontmatter, tags starting with # should be quoted if presented as a list, or we can just output them unquoted if we are careful, but quoting is safer to prevent YAML parsing errors
    const tagsYaml = parsedTags.length > 0 ? `\n  - ${parsedTags.map(t => `"${t}"`).join('\n  - ')}` : ' []';
    
    // Format other lists
    const formatList = (arr: any) => {
      const list = formatArray(arr);
      if (list.length === 0) return '[]';
      return `[${list.map(s => `"${String(s).replace(/"/g, '\\"')}"`).join(', ')}]`;
    };

    const frontmatter = `---
title: "${(data.title || 'Untitled').replace(/"/g, '\\"')}"
type: ${data.type || 'knowledge_topic'}
tags:${tagsYaml}
summary: "${(data.summary || '').replace(/"/g, '\\"')}"
key_points: ${formatList(data.key_points)}
entities: ${formatList(data.entities)}
projects: ${formatList(data.projects)}
tasks: ${formatList(data.tasks)}
---
`;

    // Generate clean filename from title
    let safeTitle = (data.title || 'Untitled Document').replace(/[\\/:*?"<>|]/g, '').trim();
    safeTitle = safeTitle.replace(/\s+/g, ' ');
    if (!safeTitle) safeTitle = 'Untitled_Document';
    
    let mdFilename = `${safeTitle}.md`;
    let destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
    
    // Handle name collisions for the markdown file
    let counter = 1;
    while (fs.existsSync(destMdPath)) {
        mdFilename = `${safeTitle} ${counter}.md`;
        destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
        counter++;
    }
    
    // Ensure dest directory exists
    await fsPromises.mkdir(path.dirname(destMdPath), { recursive: true });
    
    let destResourcePath = '';
    let finalContent = frontmatter;
    
    let linkedContent = originalContent;
    
    // Auto-link entities and projects in text files
    if (['.md', '.txt'].includes(fileExtension)) {
      const terms = [...(data.entities || []), ...(data.projects || [])].filter(Boolean);
      // Sort by length descending to replace longer terms first
      terms.sort((a, b) => b.length - a.length);
      
      terms.forEach(term => {
        if (term.length > 3) { // Only link meaningful words
           try {
             // Escape regex chars
             const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             const regex = new RegExp(`(?<!\\[\\[)\\b(${safeTerm})\\b(?!\\]\\])`, 'gi');
             linkedContent = linkedContent.replace(regex, '[[$1]]');
           } catch(e) {}
        }
      });
      finalContent += `\n${linkedContent}`;
    } else {
      // For PDF, HTML, JSON, etc., copy the file as an attachment and link it.
      let resourceFilename = `${safeTitle.replace(/\s+/g, '_')}${fileExtension}`;
      destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
      
      let resCounter = 1;
      while (fs.existsSync(destResourcePath)) {
          resourceFilename = `${safeTitle.replace(/\s+/g, '_')}_${resCounter}${fileExtension}`;
          destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
          resCounter++;
      }
      
      finalContent += `\n# ${safeTitle}\n\n**Attachment:** [[${resourceFilename}]]\n\n`;
      
      // Provide a preview for text-based non-MD files
      if (['.json', '.html', '.py', '.csv', '.rtf', '.xml', '.js', '.ts', '.yaml', '.yml'].includes(fileExtension) && originalContent) {
         finalContent += `\`\`\`\n${originalContent.slice(0, 3000)}\n${originalContent.length > 3000 ? '...\n' : ''}\`\`\`\n`;
      }
    }
    
    // Write new markdown note
    try {
      await fsPromises.writeFile(destMdPath, finalContent);
      addLog(`Created note: ${destFolder}/${mdFilename}`, 'success');
    } catch (writeErr: any) {
      throw new Error(`Failed to write new file: ${writeErr.message}`);
    }
    
    // Copy the attachment if applicable
    if (destResourcePath) {
      try {
        await fsPromises.copyFile(filePath, destResourcePath);
        addLog(`Copied attachment to: ${destFolder}/${path.basename(destResourcePath)}`, 'success');
      } catch (copyErr: any) {
        addLog(`Failed to copy attachment: ${copyErr.message}`, 'error');
      }
    }
    
    // Move original
    const hash = crypto.createHash('sha256').update(originalFilename).digest('hex').slice(0, 8);
    const rawFolder = path.join(currentConfig.vaultPath, '99_System', '_keep_raw', 'inbox');
    await fsPromises.mkdir(rawFolder, { recursive: true });
    const originalMovePath = path.join(rawFolder, `${hash}_${originalFilename}`);
    
    try {
      await fsPromises.rename(filePath, originalMovePath);
      addLog(`Moved original to: 99_System/_keep_raw/inbox/${hash}_${originalFilename}`);
    } catch (renameErr: any) {
      if (renameErr.code === 'EXDEV') {
        // Cross-device link error fallback
        await fsPromises.copyFile(filePath, originalMovePath);
        await fsPromises.unlink(filePath);
        addLog(`Copied and deleted original to: 99_System/_keep_raw/inbox/${hash}_${originalFilename}`);
      } else if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
        throw new Error(`File is locked by another process (EPERM/EBUSY)`);
      } else {
        throw new Error(`Failed to move original file: ${renameErr.message}`);
      }
    }
    
    // Update registry
    const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
    let registry: any[] = [];
    if (fs.existsSync(registryPath)) {
      try {
        const regContent = await fsPromises.readFile(registryPath, 'utf-8');
        const parsed = JSON.parse(regContent);
        if (Array.isArray(parsed)) {
          registry = parsed;
        }
      } catch(e) {
        addLog(`Could not read existing registry (starting fresh).`, 'error');
      }
    }
    registry.push({
      hash,
      original_path: `00_Inbox/${originalFilename}`,
      destination: `${destFolder}/${mdFilename}`,
      type: semanticType,
      processed_at: new Date().toISOString()
    });
    
    await fsPromises.writeFile(registryPath, JSON.stringify(registry, null, 2));
    
    // Auto-update MOCs
    try {
      const mocsDir = path.join(currentConfig.vaultPath, '00_MOC');
      const link = `[[${mdFilename.replace('.md', '')}]]`;
      
      // Topics/Knowledge MOC
      if (destFolder.includes('03_Knowledge')) {
        const mocTopicsPath = path.join(mocsDir, 'moc_topics.md');
        if (fs.existsSync(mocTopicsPath)) {
          await fsPromises.appendFile(mocTopicsPath, `\n- ${link} - ${data.summary || ''}`);
        }
      }
      
      // Projects MOC
      if (destFolder.includes('01_Projects')) {
        const mocProjectsPath = path.join(mocsDir, 'moc_projects.md');
        if (fs.existsSync(mocProjectsPath)) {
          await fsPromises.appendFile(mocProjectsPath, `\n- ${link} - ${data.summary || ''}`);
        }
      }
      
      // People MOC
      if (destFolder.includes('02_Areas') && semanticType === 'person') {
        const mocPeoplePath = path.join(mocsDir, 'moc_people.md');
        if (fs.existsSync(mocPeoplePath)) {
          await fsPromises.appendFile(mocPeoplePath, `\n- ${link} - ${data.summary || ''}`);
        }
      }
      
      // Tags MOC (aggregate new tags)
      if (parsedTags && parsedTags.length > 0) {
        const mocTagsPath = path.join(mocsDir, 'moc_tags.md');
        if (fs.existsSync(mocTagsPath)) {
          const newTags = parsedTags.map(t => `- ${t} => ${link}`).join('\n');
          await fsPromises.appendFile(mocTagsPath, `\n${newTags}`);
        }
      }
    } catch(mocErr) {
       addLog(`Failed to update MOCs: ${mocErr.message}`, 'error');
    }
    
  } catch (error: any) {
    addLog(`Error processing ${filePath}: ${error.message}`, 'error');
  }
}

// API Routes
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
  res.json({ isWatching, vaultPath: currentConfig.vaultPath });
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
    ignored: /(^|[\\/])\\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });
  
  watcher.on('add', (filePath) => {
    fileQueue.push(filePath);
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
      '00_Inbox',
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
    try {
      const regContent = await fsPromises.readFile(registryPath, 'utf-8');
      res.json(JSON.parse(regContent));
    } catch (e) {
      res.json([]);
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
    const regContent = await fsPromises.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(regContent);
    
    // Get today's local date in YYYY-MM-DD
    const todayStr = new Date().toLocaleDateString('sv-SE'); 
    const todayItems = registry.filter((item: any) => item.processed_at && item.processed_at.startsWith(todayStr));
    
    if (todayItems.length === 0) return res.status(400).json({ error: 'No files processed today to summarize.' });
    
    addLog(`Generating daily digest for ${todayItems.length} items...`);
    
    let summaries = [];
    for (const item of todayItems) {
      try {
        const filePath = path.join(currentConfig.vaultPath, item.destination);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const summaryMatch = content.match(/summary:\s*["']?([^"'\n]+)["']?/);
        if (summaryMatch && summaryMatch[1]) {
           summaries.push(`- ${path.basename(item.destination)} (${item.type}): ${summaryMatch[1]}`);
        } else {
           summaries.push(`- ${path.basename(item.destination)} (${item.type})`);
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
    await fsPromises.mkdir(path.dirname(digestPath), { recursive: true });
    
    const finalFileContent = `---
type: "journal"
tags: ["daily-digest", "log"]
date: "${todayStr}"
---

# Daily Digest: ${todayStr}

${digestContent.trim()}
`;

    await fsPromises.writeFile(digestPath, finalFileContent);
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
