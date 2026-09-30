# Obsidian Local LLM Pipeline (v4.0 — Full-Meaning Semantic Clustering & Clean `#Tag` Engine)

**100% Offline, Privacy-First Knowledge Base Organizer, Full-Meaning Semantic Clustering Engine, Clean `#Tag` Project Router, and Dual-Model AI Pipeline (`Jev 1234` + `Primary LLM 8080`) for Obsidian Vaults.**

Built for knowledge workers, researchers, and creators who want their Obsidian Vault organized automatically by **full document meaning** and **clean atomic `#tags`** without sending a single byte of data to the cloud.

---

## Key Capabilities

### 1. Full-Meaning Semantic Knowledge Clustering (`2. Semantic Clusters & #Tags`)
- **Beyond Filename & Title Matching**: Groups documents by **complete semantic meaning** across the entire note body using **TF-IDF document vectors**, **bilingual RU/EN morphological stemming**, **cross-lingual concept anchors**, and **project/domain signatures**.
- **Cross-Language Meaning Discovery**: Connects Russian and English notes about the same subject even when their titles have zero words in common (e.g., *"Заметки со вторничного созвона по архитектуре"* and *"Hermes Multi-Agent Memory and Free API Routing"*).
- **Discovered Semantic Bridges**: Automatically surfaces hidden conceptual links between documents across different folders with similarity scores and shared concepts.
- **1-Click Cluster `#Tag` Application & Folder Routing**: Apply a cluster's curated `#tags` (plus your own custom `#tags`) to all member documents and route misplaced files into their target project or knowledge folder in one click, backed by instant snapshot Undo.

### 2. 100% Clean Atomic `#Tag` System (Zero `/` Slashes)
- **Human-Friendly Atomic `#Tags`**: All tags across the system, YAML frontmatter, project profiles, and LLM prompts use clean, readable atomic format — `#Hermes`, `#Neuromicon`, `#World-1149`, `#UUCPFF`, `#AI`, `#agents`, `#LLM`, `#research`, `#active` — never cluttered `#system/...` or `#type/...` slash hierarchies.
- **Automatic Legacy Slash Cleanup**: Any legacy prefixed tag (such as `#project/Hermes`, `#type/spec`, or `#domain/ai`) is automatically stripped to its canonical atomic `#tag` (`#Hermes`, `#spec`, `#AI`).
- **Import Your Own `#Tags` from File**: Upload any `.md`, `.txt`, or `.json` file (such as `project-hashtags-expanded.md`) or import directly from your connected Obsidian Vault.
- **Project `#Tag` Profiles & Directory Routing**: Assign clean `#tags` to projects (`Hermes`, `Neuromicon`, `UUCPFF`, or any custom project) so matching notes automatically receive the project `#tag` and route to `01_Projects/<ProjectName>`.

### 3. Uncluttered, User-Friendly 4-Workspace Interface
Designed around progressive disclosure, clean typographic hierarchy, and zero visual clutter:
1. **`1. Vault & Notes`**: Search, filter by `#tag` or language, edit Markdown & YAML frontmatter, curate clean `#tags` in 1 click, and collaborate with the **Local Vault AI Assistant** (which can read, summarize, retag, rename, and move notes on command).
2. **`2. Semantic Clusters & #Tags`**:
   - **Semantic Clusters**: Inspect full-meaning document clusters, open any member note directly in the editor, add custom `#tags` to an entire cluster, and organize files in 1 click.
   - **Project `#Tags`**: Manage project tag profiles, preview file routing (`Dry-Run Preview`), and apply project routing across the vault.
   - **Import & `#Tag` Catalog**: Import/export `.md` and `.json` tag files and manage the L0–L7 clean `#tag` catalog (`Status`, `Type`, `Domain`, `Project`, `Tech`, `Method`, `Scale`, `Audience`).
3. **`3. Pipeline & Audits`**:
   - **1-Click Full Auto-Pipeline**: Runs project discovery → ghost cleanup → exact deduplication → clean `#tag` classification & folder routing → empty folder pruning → Dual-Model (`Jev + LLM`) enrichment.
   - **Audit Tools**: Ambiguity Triage Queue, Project & Directory Audit (`DirectoryRevisor`), 3-Layer Duplicate Cleaner, and Dynamic Semantic Hypergraph (DSH).
4. **`4. Local LLM Engine`**: Download, configure, and monitor local `.gguf` models (`llama-server` on ports `1234` and `8080`) with hardware-aware presets (`Balanced 16GB RAM`, `Solo 7B`, `Custom`).

---

## Quick Start

### Prerequisites
- **Node.js** `v18+` (recommended `v20+`)
- *(Optional)* Local `llama.cpp` (`llama-server`) binary and `.gguf` models in `./llm/models` for local neural inference. The deterministic semantic clustering, clean `#tag` engine, and project router work immediately even when local LLM servers are offline.

### Installation & Launch
```bash
# 1. Install dependencies
npm install

# 2. Start the application (runs on http://localhost:3000)
npm run dev
```

### Try Immediately with the 1-Click Sample Vault
Don't want to connect your personal Obsidian Vault right away?
1. Open `http://localhost:3000`.
2. Click **`1-Click Sample Vault`** in the onboarding banner.
3. Switch to **`2. Semantic Clusters & #Tags`** to see how Russian and English notes with completely different titles are clustered by full meaning, or test importing your own `.md` tag file in **`3. Import & #Tag Catalog`**.

---

## Importing Your Custom `#Tags` (`project-hashtags-expanded.md`)

You can import your own Markdown file with clean hashtags in **`2. Semantic Clusters & #Tags` → `3. Import & #Tag Catalog`**:

```markdown
# My Clean Project & Knowledge Tags

### Hermes
Folder: 01_Projects/Hermes
Aliases: Hermes, Гермес, Hermes Agent
```text
#Hermes
#agent-orchestration
#multi-agent
#memory
#routing
#local-LLM
#free-API
```

### Neuromicon
Folder: 01_Projects/Neuromicon
Aliases: Neuromicon, Нейромикон, World-1149, Мир 1149
```text
#Neuromicon
#World-1149
#Protocol-Contact
#24+1
#Defragmentation
#E=M×C²
#transmedia
#ARG
```
```

---

## REST API Overview

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/vault/clusters` | `GET` | Analyzes full document meaning across the vault and returns semantic clusters & cross-note bridges. |
| `/api/vault/clusters/apply` | `POST` | Applies clean cluster `#tags` (plus optional `extraTags`) and routes cluster notes to target folders with snapshot backup. |
| `/api/tags/taxonomy` | `GET / POST` | Retrieves or updates the clean `#tag` catalog, project profiles, and routing rules. |
| `/api/tags/taxonomy/import` | `POST` | Imports clean `#tags` and project profiles from Markdown, plain text, JSON, or a vault file. |
| `/api/tags/taxonomy/export` | `GET` | Exports the active clean `#tag` taxonomy as `.md` or `.json`. |
| `/api/vault/tags/classify-and-route` | `POST` | Batch-curates clean `#tags` and routes vault notes to project/PARA folders (`dryRun` supported). |
| `/api/snapshots/rollback` | `POST` | Rolls back any cluster or routing batch operation using its `snapshotId`. |

---

## Verification & Testing

Run the automated test suite and TypeScript build check:
```bash
npx vitest run
npm run build
```

---

## License
Apache-2.0
