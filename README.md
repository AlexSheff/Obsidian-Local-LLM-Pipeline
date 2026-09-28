# Obsidian Local LLM Pipeline (v5.0)

An automated, **Vault-Agnostic**, **100% offline** intelligence pipeline and knowledge workspace for **Obsidian** powered by a local dual-model engine (`Jev Decision Router` + `Primary Generative LLM`) via `llama.cpp`.

Designed to run on **any PC and any Obsidian Vault without hardcoded projects or paths**, with strict resource bounds (optimized for 16 GB RAM / 4–6 CPU threads). It dynamically discovers your vault's hierarchy on disk, classifies and routes documents using two-tier logprob + LLM routing, organizes tags using a bounded **Orthogonal Multi-Level Tag Taxonomy (L0–L7)**, prunes empty directories automatically after moves, and provides a **Local AI Knowledge Chat & File Agent** to search, plan, create, edit, and move notes directly from the workspace.

---

## Key Capabilities in v5.0

### 1. 100% Dynamic, Vault-Agnostic Architecture (Zero Hardcoding)
- **On-the-Fly Structure Discovery (`discoverVaultStructure` & `loadProjectsRegistry`)**: Connects to any local Obsidian Vault directory and automatically discovers existing category folders, project roots (`01_Projects/*`), and active tags directly from disk.
- **Automatic Bilingual Phonetic Aliases**: Dynamically generates Latin/Cyrillic transliterations and stem aliases for every project folder discovered in your vault.
- **Semantic Guardrails (`validateAndSanitizeRoute` & `preserveMeaningfulTitle`)**: Prevents models from misrouting general knowledge notes, meeting agendas, or ideas into unrelated project folders, and preserves series numbers and explicit project codes in note titles.
- **Automatic Empty Folder Pruning (`pruneEmptyDirectories` & `pruneEmptyParentDirs`)**: Every file move, rename, triage resolution, duplicate cleanup, or batch refinement automatically cleans up empty parent directories (including folders containing only OS metadata junk such as `.DS_Store` or `Thumbs.db`).

### 2. Orthogonal Multi-Level Tag Taxonomy (`L0–L7`) & Instant Tag Manager
Instead of turning every word in a note into a flat tag, the pipeline enforces a high-signal **Orthogonal Faceted Taxonomy** (bounded to max depth 3 and 5–9 tags per note) where each tag answers a distinct question:

| Level / Axis | Prefix | Core Question | Canonical Examples |
| :--- | :--- | :--- | :--- |
| **L0 — Infrastructure** | *(root)* | Infrastructure, methodology, or standard? | `#system`, `#meta`, `#knowledge`, `#method`, `#protocol`, `#architecture`, `#reference` |
| **L1 — Object Type** | `type/` | What kind of object is this? | `#type/project`, `#type/research`, `#type/whitepaper`, `#type/scenario`, `#type/idea`, `#type/task`, `#type/meeting`, `#type/concept`, `#type/protocol`, `#type/reference`, `#type/tool` |
| **L2 — Domain** | `domain/` | Which subject domain does it belong to? | `#domain/AI`, `#domain/AI/agents`, `#domain/AI/LLM`, `#domain/semantics`, `#domain/hypergraph`, `#domain/knowledge-management`, `#domain/software`, `#domain/philosophy`, `#domain/film`, `#domain/transmedia`, `#domain/business`, `#domain/economy` |
| **L3 — Project / Research** | `project/`, `research/` | Which project or research stream? | Dynamically populated from Vault (`#project/<FolderName>`) + `#project/Hermes`, `#project/Obsidian-LLM-Pipeline`, `#project/Neuromicon`, `#research/semantic-hypergraph`, `#research/JeV-response` |
| **L4 — Subsystem / Concept** | `system/`, `concept/` | What function or concept does it implement? | `#system/agent-orchestration`, `#system/routing`, `#system/classification`, `#system/tagging`, `#concept/World-1149`, `#concept/Protocol-Contact` |
| **L5 — Status** | `status/` | What state is the work in? | `#status/idea`, `#status/research`, `#status/design`, `#status/prototype`, `#status/active`, `#status/testing`, `#status/paused`, `#status/completed`, `#status/archived` |
| **L6 — Priority** | `priority/` | How critical is it? | `#priority/P0` (Critical), `#priority/P1` (Current), `#priority/P2` (Next), `#priority/P3` (Backlog) |
| **L7 — Work Stage** | `stage/` | Where in the lifecycle is this material? | `#stage/question`, `#stage/discovery`, `#stage/research`, `#stage/model`, `#stage/design`, `#stage/implementation`, `#stage/validation`, `#stage/deployment`, `#stage/measurement` |
| **Epistemic Axis** | `knowledge/` | What is the epistemic nature of this knowledge? | `#knowledge/fact`, `#knowledge/observation`, `#knowledge/hypothesis`, `#knowledge/model`, `#knowledge/theory`, `#knowledge/assumption`, `#knowledge/decision`, `#knowledge/evidence`, `#knowledge/specification` |
| **Relation Axis** | `relation/` | How does it relate to other entities? | `#relation/dependency`, `#relation/component`, `#relation/alternative`, `#relation/extension`, `#relation/integration`, `#relation/conflict` |

- **Strict Garbage-Tag Filtering (`isValidSemanticTag`)**: Automatically strips non-word alphanumeric codes (`#01G23`, `#w3x06`, `#a3ps9`), numeric IDs, and folder prefixes (`#01_Projects`) across YAML frontmatter parsing, extraction, and saving.
- **1-Click Interactive UI Controls**:
  - **Quick Remove (`×`)**: Click `×` on any tag in the note editor to immediately remove it from the file.
  - **Interactive L0–L7 Taxonomy Picker**: Toggle tags across any orthogonal axis in 1 click or add custom tags to your vault's taxonomy (`99_System/tag_taxonomy.json`).
  - **1-Click Redefine (`Redefine Tags L0–L7`)**: Replaces noisy legacy tags on a single note—or across the entire Vault (`Normalize All Tags L0–L7`)—with a clean orthogonal tag set backed by automatic undo snapshots.

### 3. Local AI Knowledge Chat & File Agent (`Jev + LLM Tandem`)
- **Full-Vault Semantic Search (RAG)**: Finds relevant notes across your vault using bilingual stem matching and injects grounded context into the local LLM.
- **Natural-Language File Management**: Ask the local chat assistant to **find notes**, **draft project roadmaps**, **create new Markdown notes** in target PARA folders, **append/edit sections** in the currently open note, or **move files** between folders—all with automatic snapshot backups.
- **Live Tandem Verification (`Verify Jev + LLM`)**: Tests both the Jev Decision Router (Port 1234) and Primary LLM (Port 8080) in 1 click and gracefully falls back when either server is offline.

### 4. Smart Ambiguity Triage with AI Rethink & Auto-Resolve
- **Distinct Multi-Candidate Proposals**: Ambiguous notes (`confidence < threshold`) are queued with 3 distinct candidate folders.
- **AI Rethink on "No" (`rethinkTriageAlternativeForNote`)**: Clicking **"No, Propose Alternative"** instructs the engine to exclude rejected folders, re-evaluate the note's content against remaining vault directories via Jev + semantic rules, and propose a smart alternative.
- **1-Click Auto-Resolve (`Auto-Resolve All`)**: Automatically resolves single items or the entire triage queue into the best-matching vault folders and prunes empty directories.

### 5. Dynamic Semantic Hypergraph (DSH) & Calibration Gate
- **Three Logprob Primitives (`noul`, `score`, `choice`)**: Computes 3-uniform semantic hyperedges (`99_System/hypergraph/edges.jsonl`) and Oracle state predictions (`ticks.jsonl`) using typed logprob evaluations.
- **Structured LLM Generation & Quarantine (`C1` & `C8`)**: Enforces JSON schema validation with safe quarantine to `00_Inbox/Review/` on malformed outputs and HTTP 400 context-overflow automatic retry with compact prompts.
- **Security & Crash Resilience (`R1`–`R8`)**: Loopback host binding (`127.0.0.1`), strict vault boundary checks (`isPathInsideVault`), global Express and process exception handlers, and continuous `stdout`/`stderr` pipe draining for `llama-server` child processes.

---

## Unified 3-Tab Workspace

1. **1. Vault Workspace & AI Chat**: Browse and filter documents by folder, language, and tag; edit notes with the interactive **L0–L7 Orthogonal Tag Picker**; and collaborate with the **Local AI Chat & Vault Agent**.
2. **2. Unified Pipeline & Audits**: Configure your Vault path, initialize PARA directories, run the **Full Auto-Pipeline (Clean + Sort + Prune Empty)**, normalize vault tags, resolve **Ambiguity Triage**, audit folders with **Directory Revisor**, clean duplicates, and explore the **Semantic Hypergraph**.
3. **3. Dual-Model Engine (Jev + LLM)**: Monitor live `llama-server` RAM and context telemetry on ports `1234` and `8080`, switch 16 GB RAM-safe profiles, and generate `.bat` launcher scripts.

---

## Vault Architecture (PARA + Orthogonal Taxonomy + Hypergraph)

```text
<Your_Obsidian_Vault>/
├── 00_Inbox/                  <- Drop incoming files here for automated routing
│   ├── Processed/             <- Fallback processed notes
│   └── Review/                <- Quarantined notes with review_reason in frontmatter
├── 00_MOC/                    <- Maps of Content
├── 01_Projects/               <- Active projects (discovered dynamically from disk)
├── 02_Areas/                  <- Long-term areas of responsibility
├── 03_Knowledge/              <- Essays, Dialogues, Technical, Poems, Scripts
├── 04_Journal/                <- Daily logs & digests
├── 05_Ideas/                  <- Raw brainstorming & innovations
├── 06_Archive/                <- Completed or archived notes
└── 99_System/
    ├── projects.yaml          <- Auto-bootstrapped / customizable project registry
    ├── tag_taxonomy.json      <- Customizable L0–L7 Orthogonal Tag Taxonomy
    ├── hypergraph/
    │   ├── tokens.jsonl       <- Canonical token registry
    │   ├── edges.jsonl        <- 3-uniform hyperedges with EMA weights
    │   ├── note_tokens.jsonl  <- Inverted note-to-token index
    │   ├── ticks.jsonl        <- Oracle versioned prediction ticks
    │   ├── cost_log.jsonl     <- Decision primitive execution logs
    │   └── _Report.md         <- Comprehensive topology and latency report
    ├── index/
    │   ├── thresholds.json    <- Empirical calibration gate (tau, accuracy, coverage)
    │   └── feedback.jsonl     <- User confirmation and triage logs
    └── snapshots/             <- Safe backups for 1-click rollback
```

---

## Hardware Configuration (16 GB RAM Safe Profile)

| Model File | Role | Port | Context (`-c`) | Threads (`-t`) | Est. RAM |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Hermes-3-Llama-3.2-3B.Q4_K_M.gguf` | Primary Generative LLM & Chat Agent | `8080` | `2048` – `4096` | `4` | ~2.5 GB |
| `Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf` | Decision Router & DSH Logprob Engine | `1234` | `2048` | `4` | ~1.6 GB |
| `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` | Solo 7B Mode (Optional) | `8080` | `4096` | `4` | ~4.8 GB |

---

## CLI & Verification Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start full-stack Express + Vite development server on `http://127.0.0.1:3000`. |
| `npm run build` | Bundle frontend with Vite and compile Node.js server (`dist/server.cjs`). |
| `npm start` | Run compiled production server on `http://127.0.0.1:3000`. |
| `npm run lint` | Run TypeScript typecheck (`tsc --noEmit`). |
| `npm test` | Run the complete Vitest suite (**101 tests passing across 12 test suites**). |
| `npm run calibrate` | Evaluate empirical routing accuracy on vault notes and write `99_System/index/thresholds.json`. |
| `npm run hypergraph:bootstrap -- --vault <path>` | Full vault pass: token extraction, DNA logic, and hypergraph generation. |
| `npm run hypergraph:report -- --vault <path>` | Generate hypergraph analytics report in `99_System/hypergraph/_Report.md`. |
| `npm run hypergraph:gc -- --vault <path>` | Prune zero-evidence edges and orphan tokens with snapshot backup. |

---

## License

MIT License &copy; Alex Tokarev (Good Projects corp).
