# Obsidian Local LLM Pipeline

An automated, **Zero-Config**, 100% offline intelligence pipeline for **Obsidian** powered by local LLMs via `llama.cpp`.

This system operates completely on your local machine with strict resource bounds (optimized for 16 GB RAM / 6 CPU cores). It ingests, analyzes, and categorizes raw files into a structured PARA knowledge vault, runs recursive project audits, and builds a **Dynamic Semantic Hypergraph (DSH)** using local decision model primitives without external cloud APIs.

---

## What's New in v4.0: Dynamic Semantic Hypergraph (DSH)

v4.0 introduces the **Dynamic Semantic Hypergraph (DSH)** layer powered by the local quantized model `Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf`. All semantic relations and state forecasts are computed using typed logprob evaluations rather than autoregressive text generation, enabling fast, hallucination-free decision graphs on CPU.

### 1. Three Core Decision Primitives (Zero-Text Logprob Logic)
- **Noul (`noul`)**: `(state, question) -> p(Yes) ∈ [0, 1]`. Evaluates hybridization — whether two tokens can form a logical semantic relation.
- **Score (`score`)**: `(state, question, scale) -> rating ∈ [1, 5]`. Evaluates selection — the semantic bond strength of a triplet.
- **Choice (`choice`)**: `(state, question, options[≤26]) -> bestCandidate + distribution`. Evaluates Oracle state transitions and predicts emerging graph relations.

### 2. 3-Uniform Semantic Knowledge Hypergraph
- **Tokens (Vertices)**: Extracted semantic units (concepts, projects, aliases, wikilinks) stored idempotently in `99_System/hypergraph/tokens.jsonl`.
- **Hyperedges**: 3-uniform triples `(a, b, c)` with weights $w \in [0, 1]$ stored in `99_System/hypergraph/edges.jsonl`. Binary relations are modeled as `(a, b, 'связано-с')`.
- **Candidate Pre-Filter**: Protects CPU execution by scoping candidate pairs to shared note paragraphs/sections and capping candidates per note (`maxCandidatesPerNote: 15`).
- **EMA Weight Updates**: Reinforces connection weights upon recurrent co-occurrence using Exponential Moving Average ($\alpha = 0.3$): $w_{new} = 0.3 \cdot w_{sample} + 0.7 \cdot w_{prev}$.

### 3. Oracle Engine: Predicting $H_{t+1}$
- Analyzes existing graph clusters to discover candidate relations between community neighbors.
- Employs the `choice` primitive across $\le 26$ candidates to forecast missing or emergent links.
- High-probability predictions ($p \ge 0.5$) are saved as `pending` hyperedges (`evidence.type: "oracle"`).
- State transitions and execution ticks are versioned in `99_System/hypergraph/ticks.jsonl`.

### 4. Human-in-the-Loop Triage Bridge & Auto-Stop Guard
- Integrates with the C7 Review & Triage workflow. Users confirm or reject pending hyperedge proposals with 1 click.
- Decisions are logged to `99_System/index/feedback.jsonl` for continuous calibration.
- **Safety Auto-Stop**: If the confirmation rate drops below 30% after 10 reviews, the Oracle auto-pauses to prevent graph contamination.

### 5. Observability, Resource Caps & Maintenance
- **Rate Limiter**: Shared semaphore queue (`maxConcurrent: 1`) preventing concurrent model thrashing.
- **Resource Limits**: Configurable per-run execution caps (`maxCallsPerRun: 2000`, `maxWallClockMsPerRun: 600000`).
- **Cost & Latency Tracking**: Call logs recorded in `99_System/hypergraph/cost_log.jsonl` with latency drift alerts.
- **Model Epoch Versioning**: Tracks model hashes in `model_manifest.json`. Changing model files transitions old edges to `stale` for lazy re-evaluation.
- **Garbage Collection**: `npm run hypergraph:gc` prunes zero-evidence edges and deprecated orphan tokens with automatic pre-deletion snapshots.
- **Automated Reporting**: `npm run hypergraph:report` produces comprehensive analytics in `99_System/hypergraph/_Report.md`.

---

## What's New in v3.5

1. **Language-Aware Naming & Tagging Enforcement**:
   - **Title Language Rule**: If note content is in Russian &rarr; document title is strictly in Russian. If in English &rarr; title is strictly in English.
   - **Post-Processing Protection (`enforceTitleLanguage`)**: Recovers native titles if a model translates Russian titles into English.
   - **Mandatory Language Tags (`#ru`, `#en`, `#ph`)**: Automatically detects prose and prepends language tags.

2. **16 GB RAM & Disk I/O Throttling Protection**:
   - Built specifically to prevent Windows 100% RAM exhaustion and SSD thrashing.
   - Context window strictly bounded to `-c 2048` and threads locked to `-t 4`.

3. **Dual-Model Coordination**:
   - **Primary Model**: `Hermes-3-Llama-3.2-3B.Q4_K_M.gguf` (Port 8080: deep summarization, routing).
   - **Decision Model**: `Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf` (Port 1234: fast routing & hypergraph logic).

4. **Directory Revisor (Chaos Cleanup & Project Audits)**:
   - Recursive scanning up to 10 levels deep with ghost note detection and 1-click snapshot rollback.

---

## Hypergraph CLI Commands

| Command | Description |
| :--- | :--- |
| `npm run hypergraph:spike` | Benchmark Noul, Score, and Choice primitives on local hardware and record `spike_report.md`. |
| `npm run hypergraph:bootstrap -- --vault <path>` | Full initial vault pass: token extraction, DNA logic, and initial hypergraph generation. |
| `npm run hypergraph:report -- --vault <path>` | Compiles graph dimensions, primitive latency tables, and top hyperedges into `_Report.md`. |
| `npm run hypergraph:migrate -- --vault <path>` | Validates schema version, syncs model epochs, and applies TTL edge decay. |
| `npm run hypergraph:gc -- --vault <path>` | Prunes zero-evidence edges and orphan tokens after saving a snapshot backup. |

---

## Vault Architecture (PARA + Hypergraph)

```text
D:\Obsidian\User_Vault\
├── 00_Inbox/                  <- Drop incoming files here for automated routing
├── 00_MOC/                    <- Maps of Content
├── 01_Projects/               <- Active projects
├── 02_Areas/                  <- Long-term domains
├── 03_Knowledge/              <- Essays, Dialogues, Code, Poems
├── 04_Journal/                <- Daily logs
├── 05_Ideas/                  <- Raw brainstorming
├── 06_Archive/                <- Completed or obsolete notes
└── 99_System/
    ├── hypergraph/
    │   ├── tokens.jsonl       <- Canonical token registry
    │   ├── edges.jsonl        <- 3-uniform hyperedges with weights
    │   ├── note_tokens.jsonl  <- Inverted note-to-token index
    │   ├── ticks.jsonl        <- Oracle versioned prediction ticks
    │   ├── cost_log.jsonl     <- Decision primitive execution logs
    │   ├── model_manifest.json<- Model file hash and epoch metadata
    │   ├── config.json        <- Hypergraph thresholds and caps
    │   └── _Report.md         <- Comprehensive topology and latency report
    ├── index/
    │   └── feedback.jsonl     <- User confirmation and triage logs
    └── snapshots/             <- Safe backups for 1-click rollback
```

---

## Hardware Configuration (16 GB RAM Profile)

| Model File | Role | Port | Context (`-c`) | Threads (`-t`) | Est. RAM |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Hermes-3-Llama-3.2-3B.Q4_K_M.gguf` | Primary Router / Classifier | `8080` | `2048` | `4` | ~2.5 GB |
| `Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf` | Decision Model & DSH | `1234` | `2048` - `4096` | `4` | ~1.6 GB |
| `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` | Advanced Coder (Optional) | `8080` | `2048` | `4` | ~4.8 GB |

### Windows Launcher Script Example
```cmd
@echo off
title Start Local LLM Servers (16GB Balanced)
cd /d "D:\Obsidian\Alex\Vault\llm\models"

REM Start JEV Decision Server on port 1234
start "JEV Decision Server" llama-server.exe -m "Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf" --port 1234 -c 2048 -t 4 --host 127.0.0.1

REM Start Primary Hermes Model on port 8080
start "Primary Hermes Server" llama-server.exe -m "Hermes-3-Llama-3.2-3B.Q4_K_M.gguf" --port 8080 -c 2048 -t 4 --host 127.0.0.1
```

---

## Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AlexSheff/Obsidian-Local-LLM-Pipeline.git
   cd Obsidian-Local-LLM-Pipeline
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the application**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

4. **Run tests**:
   ```bash
   npm test
   ```
   Runs the full Vitest suite (84 tests passing across 11 test suites covering hypergraph primitives, DNA logic, Oracle predictions, tokens registry, language detection, frontmatter, directory revisor, and safety snapshots).

---

## Development & Verification

- `npm run lint` &mdash; TypeScript typecheck (`tsc --noEmit`).
- `npm test` &mdash; Execute full Vitest suite (84 tests).
- `npm run build` &mdash; Bundle frontend with Vite and compile Node.js server with esbuild.

---

## License

MIT License &copy; Alex Tokarev (Good Projects corp).
