import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import crypto from 'crypto';

const __dirname = path.resolve();

const LLM_DIR = path.join(__dirname, 'llm');
const BIN_DIR = path.join(LLM_DIR, 'bin');
const MODEL_DIR = path.join(LLM_DIR, 'models');
const MODEL_FILE = 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf';
const MODEL_URL = 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.2-3B-GGUF/resolve/main/Hermes-3-Llama-3.2-3B.Q4_K_M.gguf';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const EXE_NAME = isWin ? 'llama-server.exe' : 'llama-server';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Starting download from ${url}...`);
    
    // Follow redirects
    const request = (currentUrl) => {
      https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return request(response.headers.location);
        }
        
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to get '${currentUrl}' (${response.statusCode})`));
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
            process.stdout.write(`\rDownloading: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`);
          } else {
            process.stdout.write(`\rDownloading: ${(downloadedSize / 1024 / 1024).toFixed(1)} MB`);
          }
        });
        
        file.on('finish', () => {
          process.stdout.write('\n');
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    };
    
    request(url);
  });
}

async function setupLlamaCpp() {
  if (fs.existsSync(path.join(BIN_DIR, EXE_NAME))) {
    console.log(`[OK] ${EXE_NAME} already installed.`);
    return;
  }
  
  console.log('Fetching latest llama.cpp release info...');
  
  const releaseInfo = await new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/ggerganov/llama.cpp/releases', { headers: { 'User-Agent': 'node.js' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  if (!Array.isArray(releaseInfo)) {
    if (releaseInfo.message && releaseInfo.message.includes('API rate limit')) {
      throw new Error('\nGitHub API rate limit exceeded. \nWORKAROUND: Download the llama.cpp release manually from https://github.com/ggerganov/llama.cpp/releases and extract "llama-server.exe" into the "/llm/bin/" folder, then run install.bat again.');
    }
    throw new Error(`GitHub API Error: ${releaseInfo.message || 'Unknown error'}`);
  }

  const validRelease = releaseInfo.find(r => r.assets && r.assets.length > 5);
  if (!validRelease) throw new Error('Could not find a valid release for llama.cpp');
  
  let assetNameQuery = 'ubuntu-x64.zip'; // Linux fallback
  if (isWin) assetNameQuery = 'win-cpu-x64.zip';
  if (isMac) assetNameQuery = 'macos-x64.zip'; // Just an approximation, but macOS is usually handled via brew
  
  const asset = validRelease.assets.find(a => {
     if (isWin) return a.name.includes('win-cpu-x64.zip') || a.name.includes('win-avx2-x64.zip');
     if (isMac) return a.name.includes('macos') && a.name.endsWith('.zip');
     return a.name.includes('ubuntu') && a.name.endsWith('.zip'); // Linux
  });

  if (!asset) {
      console.log(`[WARNING] Could not find precompiled binaries for ${process.platform}.`);
      console.log('You may need to compile llama.cpp from source or install via your package manager.');
      return;
  }
  
  const zipPath = path.join(LLM_DIR, 'llama-temp.zip');
  console.log(`Downloading llama.cpp (${asset.name})...`);
  await downloadFile(asset.browser_download_url, zipPath);
  
  console.log('Extracting llama.cpp...');
  if (isWin) {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`);
  } else {
      try {
          execSync(`unzip -o '${zipPath}' -d '${BIN_DIR}'`);
      } catch (e) {
          console.log('[ERROR] Unzip failed. Make sure "unzip" is installed on your system.');
          throw e;
      }
  }
  
  // Clean up zip
  fs.unlinkSync(zipPath);
  
  // Make binary executable on unix
  if (!isWin && fs.existsSync(path.join(BIN_DIR, EXE_NAME))) {
      execSync(`chmod +x '${path.join(BIN_DIR, EXE_NAME)}'`);
  }
  
  if (fs.existsSync(path.join(BIN_DIR, EXE_NAME))) {
    console.log(`[SUCCESS] ${EXE_NAME} installed successfully!`);
  } else {
    console.log(`[WARNING] ${EXE_NAME} might be in a subfolder. Check your /llm/bin folder.`);
  }
}

async function setupModel() {
  const modelPath = path.join(MODEL_DIR, MODEL_FILE);
  if (fs.existsSync(modelPath)) {
    console.log('[OK] Model already downloaded.');
    return;
  }
  
  console.log('Downloading AI Model. This may take several minutes (approx 2GB)...');
  await downloadFile(MODEL_URL, modelPath);
  console.log('[SUCCESS] Model downloaded successfully!');
}

async function main() {
  console.log('===================================================');
  console.log('  Checking LLM Requirements');
  console.log('===================================================\n');
  
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  
  try {
    await setupLlamaCpp();
    console.log('');
    await setupModel();
    console.log('\n[ALL OK] LLM Server and Model are ready.');
  } catch (err) {
    console.error('\n[ERROR] Setup failed:', err.message);
    process.exit(1);
  }
}

main();
