# Obsidian Local LLM Pipeline (v5.2 — Full-Meaning Semantic Clustering, Clean `#Tags` & Dynamic Semantic Hypergraph)

**100% Offline, Privacy-First Knowledge Base Organizer, Full-Meaning Semantic Clustering Engine, Clean `#Tag` Project Router, Dynamic Semantic Hypergraph (DSH), and Dual-Model AI Pipeline (`Jev 1234` + `Primary LLM 8080`) for Obsidian Vaults.**

Built for knowledge workers, researchers, and creators who want their Obsidian Vault organized automatically by **full document meaning**, **clean atomic `#tags`**, and **local neural inference** without sending a single byte of data to the cloud.

---

## Evolution & Version History
- **v5.2 (Current)**:
  - **Full-Meaning Semantic Knowledge Clustering (`src/server/semanticClustering.ts`)**: Groups documents by complete text meaning (TF-IDF document vectors + bilingual RU/EN morphological stemming + cross-lingual concept anchors + project/domain signatures), discovers **Semantic Bridges** across languages and folders, and applies cluster `#tags` + folder routing in 1 click.
  - **100% Clean Atomic `#Tag` System (`src/server/tags.ts`)**: Eliminated slash-prefixed tags (`#system/...`, `#type/...`, `#domain/...`, `#project/...`) in favor of clean atomic `#tags` (`#Hermes`, `#Neuromicon`, `#World-1149`, `#UUCPFF`, `#AI`, `#agents`, `#LLM`, `#research`, `#active`). Automatic stripping of legacy slash prefixes on import and refinement.
  - **Streamlined 4-Workspace UI**: Progressive disclosure, zero visual clutter, and direct cross-tab navigation between Semantic Clusters and the Vault Editor.
- **v5.1**:
  - **Custom `#Tag` File Import/Export & Project `#Tag` Profiles**: Import `.md`, `.txt`, and `.json` tag files (such as `project-hashtags-expanded.md`), bind associated `#tags` to projects, and route files to project/PARA folders with Dry-Run Preview and Snapshot Rollback.
  - **1-Click Sample Obsidian Vault**: Built-in `demo_obsidian_vault` for instant zero-config testing.
- **v5.0**:
  - **Dynamic Semantic Hypergraph (DSH — H0 to H7)**: Concept extraction, Semantic DNA fingerprinting (`dnaEngine.ts`), Oracle pairwise synthesis (`oracle.ts`), Triage Bridge with auto-stop guard (`triageBridge.ts`), cost/rate tracking, and garbage collection.
  - **Vault-Agnostic Dynamic Project Discovery & Hierarchical Routing**: Zero hardcoded project lists (`projectsRegistry.ts`), multi-step hierarchical decision routing (`hierarchicalRouter.ts`), Calibration Gate (`thresholds.json`), and P0 Security Hardening (`R1–R8`).

---

## Core Architecture & Capabilities

### 1. Full-Meaning Semantic Knowledge Clustering (`2. Semantic Clusters & #Tags`)
- **Beyond Filename & Title Matching**: Analyzes the **entire document body** using **TF-IDF term weighting**, **bilingual RU/EN morphological stemming**, **cross-lingual concept anchors**, and **project/domain signatures**.
- **Cross-Language Meaning Discovery**: Connects Russian and English notes about the same subject even when their titles share zero words (e.g., *"Заметки со вторничного созвона по архитектуре"* and *"Hermes Multi-Agent Memory and Free API Routing"*).
- **Discovered Semantic Bridges**: Automatically detects high-similarity conceptual links between documents across different folders and languages.
- **1-Click Cluster `#Tag` Application & Folder Routing**: Apply a cluster's curated `#tags` (plus custom `#tags` added directly on the cluster card) to all member documents and route misplaced files into their target project or knowledge folder, backed by automatic snapshot backup and 1-click Undo.

### 2. 100% Clean Atomic `#Tag` System & File Import
- **Clean Atomic `#Tags` (Zero `/` Slashes)**: All tags across YAML frontmatter, inline text, project profiles, and LLM prompts use clean atomic format (`#Hermes`, `#Neuromicon`, `#World-1149`, `#UUCPFF`, `#AI`, `#agents`, `#LLM`, `#research`, `#active`).
- **Import Your Own `#Tags` from File**: Upload any `.md`, `.txt`, or `.json` file (e.g., `project-hashtags-expanded.md`) or import directly from a file inside your connected Obsidian Vault.
- **Project `#Tag` Profiles & Directory Routing**: Assign clean `#tags` to projects (`Hermes`, `Neuromicon`, `UUCPFF`, or any discovered vault project) so notes matching those tags or concepts automatically receive `#ProjectName` and route to `01_Projects/<ProjectName>`.

### 3. Dual-Model Local AI Pipeline (`Jev 1234` + `Primary LLM 8080`)
- **Jev Decision Server (Port `1234`)**: Ultra-fast hierarchical classification (`hierarchicalRouter.ts`) using logprob confidence scoring (`chooseOne`) and calibrated thresholds (`calibration.ts`).
- **Primary LLM Server (Port `8080`)**: Extracts clean titles, summaries, and semantic `#tags` with strict anti-hallucination and project-hijack guardrails.
- **Deterministic Offline Fallback**: When local `llama-server` instances are offline, the deterministic semantic analyzer, project router, and clustering engine operate at 100% functionality with zero errors.

### 4. Dynamic Semantic Hypergraph (DSH — H0 to H7)
- **Concept & Token Registry (`tokensRegistry.ts`, `extractor.ts`)**: Extracts structural and conceptual tokens across the vault.
- **Semantic DNA Engine (`dnaEngine.ts`)**: Computes multi-dimensional semantic signatures for notes and clusters.
- **Oracle Synthesis & Triage Bridge (`oracle.ts`, `triageBridge.ts`)**: Proposes high-value cross-domain connections with human-in-the-loop confirmation and automatic pause if confirmation rate drops below 30%.

### 5. Vault Safety, Snapshot Rollback & Security (`R1–R8`)
- **Non-Destructive Snapshot Sessions (`snapshot.ts`)**: Every batch routing, cluster application, duplicate cleanup, or ghost purge creates a restorable snapshot in `99_System/_snapshots` with 1-click rollback.
- **Strict Path Traversal & Symlink Protection**: All file operations are verified via `isPathInsideVault` (`realpathSync` validation).
- **3-Layer Duplicate Cleaner & Empty Folder Pruner**: SHA-256 exact hash deduplication (merging unique tags before removal), normalized title collision detection, and automatic recursive empty directory cleanup.

---

## Uncluttered 4-Workspace Interface

1. **`1. Vault & Notes` (`KnowledgeExplorer.tsx`)**:
   - Search and filter notes by folder, language (`ru`/`en`), or clean `#tag`.
   - Edit Markdown content and YAML frontmatter, curate clean `#tags` in 1 click, or jump straight to `Clusters & #Tag Manager`.
   - Built-in **Local Vault AI Chat Assistant** (`KnowledgeChatPanel.tsx`) capable of searching, summarizing, creating, retagging, and moving notes.
2. **`2. Semantic Clusters & #Tags` (`TagTaxonomyWorkspace.tsx`)**:
   - **`1. Semantic Clusters`**: Inspect full-meaning document clusters, filter by concept or misplaced status, click any note title to open it directly in the editor, add custom `#tags` to a cluster, and organize files in 1 click.
   - **`2. Project #Tags`**: Manage project `#tag` profiles, preview routing changes (`Preview Routing`), and batch-route vault files.
   - **`3. Import & #Tag Catalog`**: Import/export `.md` and `.json` tag files and manage the unified L0–L7 clean `#tag` catalog.
3. **`3. Pipeline & Audits` (`PipelineWorkspace.tsx`)**:
   - **1-Click Full Auto-Pipeline**: Project sync → ghost cleanup → exact deduplication → clean `#tag` classification & routing → empty folder pruning → Dual-Model enrichment.
   - **5 Focused Audit Views**: *Pipeline & Live Logs*, *Ambiguity Triage*, *Project & Directory Audit*, *Duplicate Cleaner*, and *Semantic Hypergraph (DSH)*.
4. **`4. Local LLM Engine` (`LocalEngineWorkspace.tsx`)**:
   - Configure and launch local `llama-server` processes (`Jev 1234` and `Primary 8080`), select `.gguf` models, and apply RAM-aware hardware presets (`Balanced 16GB`, `Solo 7B`, `Custom`).

---

## Quick Start

### Windows (`install.bat` / `start.bat`) or Linux/macOS (`install.sh` / `start.sh`)
```bash
# Development mode (starts Express backend + Vite UI on http://localhost:3000)
npm install
npm run dev

# Production build & start
npm run build
npm run start
```

### CLI Scripts & Hypergraph Utilities
```bash
npm run test                  # Run full Vitest suite (13 test suites, 107 tests)
npm run lint                  # TypeScript strict typecheck (tsc --noEmit)
npm run calibrate             # Calibrate Jev decision thresholds
npm run hypergraph:bootstrap  # Bootstrap Dynamic Semantic Hypergraph index
npm run hypergraph:report     # Generate DSH health & connectivity report
npm run hypergraph:gc         # Run hypergraph garbage collection
```

---

## Importing Custom `#Tags` (`project-hashtags-expanded.md`)

Open **`2. Semantic Clusters & #Tags` → `3. Import & #Tag Catalog`** and upload a `.md`, `.txt`, or `.json` file (or import directly from your vault):

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

## REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/vault/clusters` | `GET` | Full-meaning semantic clustering & cross-note Semantic Bridges discovery. |
| `/api/vault/clusters/apply` | `POST` | Applies clean cluster `#tags` (plus optional `extraTags`) and routes cluster notes to target folders with snapshot backup. |
| `/api/tags/taxonomy` | `GET / POST` | Retrieves or updates the clean `#tag` catalog, project profiles, and routing rules. |
| `/api/tags/taxonomy/import` | `POST` | Imports clean `#tags` and project profiles from Markdown, plain text, JSON, or a vault file. |
| `/api/tags/taxonomy/export` | `GET` | Exports the active clean `#tag` taxonomy as `.md` or `.json`. |
| `/api/vault/tags/classify-and-route` | `POST` | Batch-curates clean `#tags` and routes vault notes to project/PARA folders (`dryRun` supported). |
| `/api/snapshots/rollback` | `POST` | Rolls back any cluster or routing batch operation using its `snapshotId`. |
| `/api/hypergraph/*` | `GET / POST` | Dynamic Semantic Hypergraph (DSH) status, bootstrap, oracle review, and maintenance endpoints. |

---

## License
MIT / Apache-2.0
