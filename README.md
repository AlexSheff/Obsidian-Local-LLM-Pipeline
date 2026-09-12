# Obsidian Local LLM Pipeline

Hermes is an automated, **Zero-Config**, completely local intelligence pipeline designed to ingest, analyze, and categorize raw notes into a strictly formatted PARA (Projects, Areas, Resources, Archives) / Zettelkasten knowledge base using a local LLM via `llama.cpp`.

This system is fully autonomous. You drop a raw `.md` or `.txt` file into `00_Inbox`, and Hermes will use AI to read the content, generate a highly structured YAML frontmatter (with summary, tags, entities, related projects), move the file to its correct semantic location, and preserve the original hashed file in a system archive.

## Key Features

1. **Fully Local & Private**: No cloud APIs (OpenAI/Anthropic). Everything runs via a local `llama-server.exe` instance, preserving 100% data privacy.
2. **Autonomous Obsidian Organization**: Automatically determines if a file is a Concept, Event, Meeting, Project, Idea, etc., and routes it to the corresponding Vault folder.
3. **Intelligent Auto-linking**: Scans text for AI-extracted entities and projects, automatically wrapping them in `[[WikiLinks]]` to seamlessly connect your Knowledge Graph.
4. **Daily Digest Generator**: Summarizes all notes processed today into a beautifully written daily journal entry via AI.
5. **Interactive Analytics Dashboard**: Visualizes your vault's ingestion activity and content distribution directly in the web UI.
6. **Resilient Queueing System**: Files dropped simultaneously are processed sequentially (1-by-1) preventing memory exhaustion or LLM overload.
7. **Automated Vault Scaffolding**: Click a single button in the web dashboard to instantly generate a robust PARA folder structure and system files (MOCs, registries).
8. **Fail-Safe Integrity & Attachment Linking**: Non-markdown files (PDFs, HTML, Python scripts) are preserved and linked. Collisions are handled gracefully with incremented filenames.

---

## Directory & Vault Structure

Hermes generates and expects the following strict hierarchy within your Obsidian Vault:

```text
D:\Obsidian\User_Vault\
├── 00_Inbox/                  <- Drop your raw files here. Chokidar watches this folder.
├── 00_MOC/                    <- Map of Content files (moc_projects, moc_people, etc.)
├── 01_Projects/
│   ├── Active/                <- Target for 'project', 'plan'
│   ├── Incubator/
│   └── Archive/
├── 02_Areas/
│   ├── People/                <- Target for 'person'
│   ├── Organizations/         <- Target for 'organization'
│   ├── Places/                <- Target for 'place'
│   └── Entities/              <- Target for 'entity'
├── 03_Knowledge/
│   ├── Concepts/              <- Target for 'concept'
│   ├── Topics/                <- Default fallback (research, note, tutorial, etc.)
│   ├── References/            <- Target for 'whitepaper', 'specification'
│   └── Documents/             <- Target for 'article', 'essay', 'script'
├── 04_Journal/
│   ├── Daily/                 <- Target for 'journal'
│   ├── Meetings/              <- Target for 'meeting'
│   └── Events/                <- Target for 'event'
├── 05_Ideas/
│   ├── Inbox/                 <- Target for 'idea'
│   ├── Developing/
│   └── Archive/
├── 06_Archive/
│   └── Other/                 <- Target for 'archive'
└── 99_System/
    ├── _processing_registry.json <- Audit log of all categorized files
    ├── _keep_raw/inbox/          <- SHA256 hashed exact copies of original files
    └── templates/
```

---

## Installation & Setup

### Requirements
- **Windows 10/11, Linux (Ubuntu/Debian), or macOS**
- **Node.js** (v18+ recommended)
- *(No need for external LLM apps! The installer handles downloading the required engine and models)*

### Recommended Model
The installer automatically downloads the **Hermes-3-Llama-3.2-3B.Q4_K_M** model. It's incredibly fast (even on CPUs) and executes JSON-schema instructions flawlessly.

### Setup Instructions (Windows)

1. **Extract the Pipeline**: Extract the downloaded ZIP to a dedicated folder (e.g., `C:\Hermes-Pipeline`).
2. **Install & Download**: Double-click `install.bat`. 
    - This script will install necessary Node.js packages.
    - It will automatically download the `llama.cpp` Windows CPU Server and the `Hermes-3` AI model (~2GB) into the `/llm/` directory. *(Note: If you already have the model or engine downloaded in the `/llm/` folder, the installer is smart enough to detect them and instantly skip the download phase).*
3. **Launch**: Double-click `start.bat`. 
    - This will spin up the local AI server in a secondary terminal window.
    - It will automatically launch the Hermes Web Dashboard (`http://localhost:3000`) in your browser.

### Setup Instructions (Linux / macOS)

1. **Extract the Pipeline**: Unzip the repository into your preferred directory.
2. **Make Scripts Executable**: Open your terminal in the directory and run:
   ```bash
   chmod +x install.sh start.sh
   ```
3. **Install & Download**: Run `./install.sh`.
    - This installs Node.js packages and uses `unzip` to automatically fetch the correct `llama.cpp` binary and AI model for your platform. *(Note: Just like on Windows, if the models are already present in `/llm/`, the download is skipped).*
4. **Launch**: Run `./start.sh`.
    - The LLM server will start in the background (logs in `/llm/server.log`).
    - The Node backend will start, and the dashboard will be available at `http://localhost:3000`.

### Troubleshooting: GitHub API Rate Limit

If you receive a `GitHub API Error` or `API rate limit exceeded` during the `install.bat` step, it means GitHub has temporarily blocked automated downloads from your IP. 

**Manual Workaround:**
1. Manually download the `llama.cpp` binary for your OS from the [official GitHub releases](https://github.com/ggerganov/llama.cpp/releases) (look for `win-avx2-x64.zip` or `win-cpu-x64.zip` on Windows).
2. Extract the archive and copy **only** the `llama-server.exe` file.
3. Paste it into the `llm/bin/` folder inside your project directory (create the folder if it doesn't exist).
4. (Optional) Place your `.gguf` model in `llm/models/`.
5. Run `install.bat` again. The script will detect the files and instantly skip the download phase.

---

## Usage Guide

1. **Open the Dashboard**: Go to `http://localhost:3000`.
2. **Configure Settings**:
    - Enter the **absolute path** to your Obsidian Vault (e.g., `D:\Obsidian\User_Vault`).
    - The LLM Server URL defaults to `http://127.0.0.1:8080` (standard for `llama.cpp`).
    - Click **Save Settings**.
3. **Initialize the Vault (First Time Only)**:
    - If you are starting fresh, click **Initialize Vault Structure**. This will instantly generate the entire PARA folder tree and internal JSON registries required by Hermes.
4. **Start the Pipeline**:
    - Click **Start Pipeline**. The watcher indicator will turn green.
5. **Drop Files**:
    - Open your file explorer and save any text-based file (`.md`, `.txt`, `.csv`, `.json`, `.html`, `.py`, `.js`, etc.) or **PDF** file directly into `00_Inbox`.
    - Watch the Web Dashboard Activity Log as the file is detected, sent to the LLM, categorized, and moved.
    - **For PDF and Non-Markdown Files**: The system will automatically create a companion Markdown card in the destination folder containing the YAML frontmatter, a summary, and an Obsidian link (`![[file_name]]`) to the original file, which is copied alongside it.

---

## Architecture Details

- **Frontend**: React (Vite) + Tailwind CSS + Lucide Icons.
- **Backend**: Express + Node.js.
- **Supported File Types**:
  - **Text**: `.md`, `.txt`, `.csv`, `.rtf`, `.html`, `.json`, `.xml`, `.yaml`, `.yml`, `.py`, `.js`, `.ts`.
  - **Binary/Document**: `.pdf` (text layer extracted dynamically via `pdf-parse`).
- **Attachment Linker Engine**: Non-markdown files are preserved in their original format. A companion `.md` note is generated to house the Zettelkasten metadata and seamlessly embed the attachment into the Obsidian vault.
- **File Watcher**: `chokidar` with stability thresholds to prevent reading files that are currently downloading or syncing.
- **Error Resilience**:
    - **Collision Prevention**: Automatically increments file names (e.g., `Document 1.md`) for both markdown cards and original attachments if duplicates exist in the destination.
    - **JSON Parsing**: Implements regex-based fallback extraction if the LLM outputs malformed JSON or markdown blocks.
    - **File Locks**: Catch blocks for `EPERM`, `EBUSY`, and `EXDEV` (Cross-device links) ensure the pipeline gracefully handles locked files or moving files across different hard drives.
    - **Timeout Limits**: Implements a 120-second timeout on Axios requests. If the CPU gets bogged down and the LLM halts, the file processor will abort and safely log the error rather than permanently hanging the queue.
    - **Empty Files**: 0-byte files are ignored automatically.
