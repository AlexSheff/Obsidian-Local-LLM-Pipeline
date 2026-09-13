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
import { convert } from 'html-to-text';

// Handle pdf-parse default export issue
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

const app = express();
const PORT = 3000;

app.use(express.json());

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// State for the pipeline
let isWatching = false;
let watcher: FSWatcher | null = null;
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
        const text = pdfData.text || '';
        // Strict limit to prevent HTTP 400 (Context length exceeded in local LLMs)
        // Cyrillic uses more tokens, 6000 chars is roughly 6000-12000 tokens.
        textToProcess = text.length <= 6000 ? text : text.slice(0, 3000) + '\n\n...[CONTENT OMITTED]...\n\n' + text.slice(-3000);
      } catch (err: any) {
        addLog(`Failed to parse PDF: ${err.message}. Falling back to filename classification.`, 'error');
        textToProcess = `[Error extracting text. Please classify based on the file name: ${originalFilename}]`;
      }
    } else if (docxExtensions.includes(fileExtension)) {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value || '';
        originalContent = text; // Save it so we can include it in the markdown block if needed, though for docx we usually attach it
        textToProcess = text.length <= 6000 ? text : text.slice(0, 3000) + '\n\n...[CONTENT OMITTED]...\n\n' + text.slice(-3000);
      } catch (err: any) {
        addLog(`Failed to parse DOCX: ${err.message}. Falling back to filename classification.`, 'error');
        textToProcess = `[Error extracting text. Please classify based on the file name: ${originalFilename}]`;
      }
    } else {
      try {
        originalContent = await fsPromises.readFile(filePath, 'utf-8');
        
        // Attempt to clean encoding artifacts/weird chars if any
        let text = originalContent.replace(/\uFFFD/g, ''); 
        
        // Strip existing frontmatter from markdown files so it doesn't get duplicated
        if (fileExtension === '.md') {
          text = text.replace(/^---\n[\s\S]*?\n---\n*/, '');
        }
        
        if (fileExtension === '.json') {
          try {
            const parsed = JSON.parse(text);
            if (parsed.textContent) {
              // Usually Google Keep JSON format
              text = (parsed.title ? parsed.title + '\n\n' : '') + parsed.textContent;
            } else {
              // Generic extraction: pull out all string values recursively
              const extractStrings = (obj: any): string => {
                if (typeof obj === 'string') return obj;
                if (Array.isArray(obj)) return obj.map(extractStrings).filter(Boolean).join('\n');
                if (typeof obj === 'object' && obj !== null) return Object.values(obj).map(extractStrings).filter(Boolean).join('\n');
                return '';
              };
              text = extractStrings(parsed);
            }
          } catch (e) {
            // Ignore parse errors, just use the raw text
          }
        } else if (fileExtension === '.html' || fileExtension === '.xml') {
          try {
            let cleanHtml = text.replace(/<\?xml.*?\?>/gi, '').replace(/<!DOCTYPE.*?>/gi, '');
            text = convert(cleanHtml, {
              wordwrap: 130,
              selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' }
              ]
            });
          } catch (e) {
            addLog(`html-to-text failed, using basic cleanup.`, 'error');
            text = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
          }
        }
        
        // Strict limit to prevent HTTP 400 (Context length exceeded in local LLMs)
        if (text.length <= 6000) {
          textToProcess = text;
        } else {
          textToProcess = text.slice(0, 2500) + '\n\n...[MIDDLE CONTENT OMITTED]...\n\n' + text.slice(Math.floor(text.length/2)-500, Math.floor(text.length/2)+500) + '\n\n...[MIDDLE CONTENT OMITTED]...\n\n' + text.slice(-2500);
        }
      } catch (err: any) {
        addLog(`Failed to read file text: ${err.message}. Falling back to filename classification.`, 'error');
        textToProcess = `[Error reading text file. Please classify based on the file name: ${originalFilename}]`;
      }
    }
    
    addLog(`Sending to local LLM at ${currentConfig.llamaUrl}`);
    
    const prompt = `
You are an expert system that extracts information from notes and categorizes them into a structured schema.
Read the following text and extract exactly 14 fields in strict JSON format.
Do not include markdown blocks like \`\`\`json. Output ONLY the JSON object.

The required fields are:
1. "title" (string): A short, clear title for the document.
2. "document_type" (string): MUST be one of:
   - "resume", "profile", "contact", "book", "literature", "story", "scenario", "script", "short_film", "essay", "article", "document", "quote", "phrase", "idea", "concept", "note", "research", "tutorial", "list", "reference", "whitepaper", "specification", "technical_document", "journal", "meeting", "event", "dialogue", "transcript", "correspondence", "project_document", "archive", "unknown"
3. "primary_entity_type" (string or null): If the document is fundamentally ABOUT a specific person, organization, place, book, or project, specify it here (e.g., "person", "organization", "place", "book", "project"). Otherwise null.
4. "primary_entity_name" (string or null): The exact name of that primary entity (e.g., "John Smith", "Apple Inc"). Otherwise null.
5. "summary" (string): A brief summary of the content.
6. "tags" (array of strings): List of tags without the '#' symbol.
7. "entities" (array of strings): List of people, orgs, or places mentioned.
8. "projects" (array of strings): List of related projects.
9. "tasks" (array of strings): List of actionable tasks identified.
10. "relationships" (array of strings): Key connections identified (e.g. "John Smith works at Apple").
11. "key_points" (array of strings): 3-5 key points extracted.
12. "evidence" (string): Briefly explain why you classified this document_type and primary_entity.
13. "scores" (object): Provide three float scores (0.0 to 1.0): {"semantic": 0.9, "structural": 0.8, "entity": 0.9}.
14. "alternative_classes" (array of objects): Up to 2 alternatives if uncertain, format: [{"class": "type", "score": 0.8}].

Text:
${textToProcess}
`;

    let responseContent = '';
    try {
      const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, // lowered to enforce determinism
        max_tokens: 2000, // ensure enough tokens to complete the JSON response
        response_format: { type: "json_object" }, // Many local LLMs (LM Studio/Ollama) support this now
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
    
    // Attempt to extract just the JSON object to avoid trailing text errors
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    let data: any = {};
    try {
      data = JSON.parse(jsonStr.trim());
    } catch (parseError: any) {
      addLog(`JSON Parse failed for ${originalFilename}: ${parseError.message}. Using fallback.`, 'error');
      // Fallback behavior
      const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]+)"/i);
      const typeMatch = jsonStr.match(/"document_type"\s*:\s*"([^"]+)"/i);
      const entityMatch = jsonStr.match(/"primary_entity_type"\s*:\s*"([^"]+)"/i);
      const entityNameMatch = jsonStr.match(/"primary_entity_name"\s*:\s*"([^"]+)"/i);
      
      data = {
        title: titleMatch ? titleMatch[1] : originalFilename.replace(/\.[^/.]+$/, ""),
        document_type: typeMatch ? typeMatch[1] : 'unknown',
        primary_entity_type: entityMatch ? entityMatch[1] : null,
        primary_entity_name: entityNameMatch ? entityNameMatch[1] : null,
        summary: 'Automatic fallback due to model parsing error or incomplete generation.',
        tags: ['processing_error'],
        key_points: [],
        entities: [],
        projects: [],
        tasks: [],
        relationships: [],
        scores: { semantic: 0, structural: 0, entity: 0 },
        alternative_classes: []
      };
    }
    
    // Application-level decision logic
    const semScore = data.scores?.semantic || 0;
    const structScore = data.scores?.structural || 0;
    const entScore = data.scores?.entity || 0;
    const finalScore = (semScore + structScore + entScore) / 3;
    
    let margin = finalScore;
    if (data.alternative_classes && data.alternative_classes.length > 0) {
       const altScore = data.alternative_classes[0].score || 0;
       margin = finalScore - altScore;
    }
    
    let decision = 'REVIEW';
    if (finalScore > 0.7 && margin > 0.1) decision = 'ACCEPT';
    
    data.confidence = finalScore;
    data.decision = decision;
    
    const semanticType = data.document_type?.toLowerCase() || 'unknown';
    const primaryType = data.primary_entity_type?.toLowerCase() || null;
    const primaryName = data.primary_entity_name || null;
    let destFolder = path.join('03_Knowledge', 'Topics'); // default
    
    // Entity Resolution & Naming Hint
    let overrideFileName = null;
    if (primaryType && primaryName && primaryName.length > 1) {
       let safeEntityName = primaryName.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, ' ');
       if (safeEntityName) {
         overrideFileName = `${safeEntityName}.md`;
       }
    }
    
    if (decision === 'REVIEW') {
      destFolder = path.join('00_Inbox', 'Review');
    } else if (['person', 'organization', 'place', 'entity', 'book', 'project'].includes(primaryType)) {
      if (primaryType === 'person') destFolder = path.join('02_Areas', 'People');
      else if (primaryType === 'organization') destFolder = path.join('02_Areas', 'Organizations');
      else if (primaryType === 'place') destFolder = path.join('02_Areas', 'Places');
      else if (primaryType === 'book') destFolder = path.join('03_Knowledge', 'Books');
      else if (primaryType === 'project') destFolder = path.join('01_Projects', 'Active');
      else destFolder = path.join('02_Areas', 'Entities');
    } else {
      if (['project', 'plan', 'task', 'project_document'].includes(semanticType)) destFolder = path.join('01_Projects', 'Active');
      else if (['person', 'contact', 'resume', 'profile'].includes(semanticType)) destFolder = path.join('02_Areas', 'People'); // Fallback if primary_entity missed it
      else if (['book', 'literature'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Books');
      else if (['quote', 'phrase'].includes(semanticType)) destFolder = path.join('05_Ideas', 'Quotes');
      else if (['dialogue', 'transcript'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Transcripts');
      else if (['topic', 'note', 'research', 'tutorial', 'list', 'correspondence', 'unknown'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Topics');
      else if (['reference', 'whitepaper', 'specification', 'technical_document'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'References');
      else if (['document', 'article', 'essay', 'story', 'scenario', 'script', 'short_film'].includes(semanticType)) destFolder = path.join('03_Knowledge', 'Documents');
      else if (semanticType === 'journal') destFolder = path.join('04_Journal', 'Daily');
      else if (semanticType === 'meeting') destFolder = path.join('04_Journal', 'Meetings');
      else if (semanticType === 'event') destFolder = path.join('04_Journal', 'Events');
      else if (semanticType === 'idea') destFolder = path.join('05_Ideas', 'Inbox');
      else if (semanticType === 'archive') destFolder = path.join('06_Archive', 'Other');
    }
    
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
document_type: ${data.document_type || 'unknown'}
primary_entity_type: ${data.primary_entity_type || 'null'}
primary_entity_name: ${data.primary_entity_name || 'null'}
tags:${tagsYaml}
summary: "${(data.summary || '').replace(/"/g, '\\"')}"
key_points: ${formatList(data.key_points)}
entities: ${formatList(data.entities)}
projects: ${formatList(data.projects)}
tasks: ${formatList(data.tasks)}
relationships: ${formatList(data.relationships)}
confidence: ${data.confidence || 0}
margin: ${margin || 0}
decision: ${data.decision || 'REVIEW'}
---
`;

    // Generate clean filename from title
    let safeTitle = (data.title || 'Untitled Document').replace(/[\\/:*?"<>|]/g, '').trim();
    safeTitle = safeTitle.replace(/\s+/g, ' ');
    if (!safeTitle) safeTitle = 'Untitled_Document';
    
    let mdFilename = overrideFileName || `${safeTitle}.md`;
    let destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
    
    // Handle name collisions for the markdown file
    let counter = 1;
    while (fs.existsSync(destMdPath)) {
        mdFilename = overrideFileName ? `${overrideFileName.replace('.md', '')} ${counter}.md` : `${safeTitle} ${counter}.md`;
        destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
        counter++;
    }
    
    // Ensure dest directory exists
    await fsPromises.mkdir(path.dirname(destMdPath), { recursive: true });
    
    let destResourcePath = '';
    let finalContent = frontmatter;
    
    let linkedContent = textToProcess;
    
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
      
      // Provide a preview for text-based non-MD files. Use CLEANED TEXT (textToProcess), not originalContent!
      if (['.json', '.html', '.py', '.csv', '.rtf', '.xml', '.js', '.ts', '.yaml', '.yml'].includes(fileExtension) && textToProcess) {
         finalContent += `## Content Preview\n\n${textToProcess.slice(0, 5000)}\n${textToProcess.length > 5000 ? '...\n' : ''}\n`;
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
      document_type: semanticType,
      primary_entity_type: primaryType,
      primary_entity_name: primaryName,
      entities: data.entities || [],
      projects: data.projects || [],
      confidence: data.confidence || 0,
      scores: data.scores || {},
      margin: margin || 0,
      decision: data.decision || 'REVIEW',
      pipeline_version: '2.0',
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
      if (destFolder.includes('02_Areas') && (semanticType === 'person' || primaryType === 'person')) {
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
    ignored: [
      /(^|[\\/])\\../,
      (testPath: string) => testPath.includes(path.sep + 'Review') || testPath.includes('/Review') || testPath.includes('\\Review')
    ],
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });
  
  watcher.on('add', (filePath) => {
    // Double check to prevent loops
    if (filePath.includes('/Review/') || filePath.includes('\\Review\\')) return;
    
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
