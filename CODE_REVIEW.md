# Obsidian-Local-LLM-Pipeline: Comprehensive Code Review

## Executive Summary
A comprehensive security and production audit of the **Obsidian-Local-LLM-Pipeline** codebase was conducted across all source files, schemas, APIs, and background processes. All identified defects—spanning critical filesystem safety, symlink traversal escapes, data overwrite vulnerabilities, uncalibrated model decision fallbacks, in-memory queue task loss, and registry consistency—have been systematically reproduced, analyzed, and verified.

---

## Detailed Findings Matrix

| ID | Severity | File / Section | Issue & Root Cause | Impact |
|---|---|---|---|---|
| **CRIT-01** | **Critical** | `src/server/validation.ts:29–91` | Path validation previously relied solely on lexical path resolution without resolving filesystem symlinks via `realpath`. A symbolic link created inside a Vault pointing outside could allow reading, writing, or deleting files outside the Vault. | Arbitrary file read/write/traversal escape from the Vault boundary. |
| **CRIT-02** | **Critical** | `server.ts:1614–1720` | Fast Route wrote incoming notes using `fs.writeFile` directly to the target directory without checking for pre-existing files, and subsequently unlinked the inbox original without raw archiving. | Silent data loss: overwriting existing notes with identical titles and permanently losing both the overwritten file and the original inbox note. |
| **HIGH-01** | **High** | `src/server/snapshot.ts:81–238` | Snapshot rollback previously restored files directly without checking whether the destination was modified after the snapshot, overwriting newer user edits. | Destructive rollback leading to loss of newer manual edits. |
| **HIGH-02** | **High** | `src/server/decisionModel.ts:175–240` | When logprobs were absent or the model returned unparseable text, the single-letter extractor could falsely match arbitrary capital letters (e.g. English pronoun "I") or default to Option A with an artificial 100% confidence score. | Misclassification of notes with artificial 100% confidence, misleading the routing system. |
| **HIGH-03** | **High** | `server.ts:113–145` | Uncaught exceptions and unhandled promise rejections only wrote to a log without initiating a controlled shutdown, closing listeners, or flushing memory queues. | Orphaned background tasks, open sockets, and corrupted application state. |
| **HIGH-04** | **High** | `server.ts:2080–2135` | Failures during processing registry updates were logged without a recovery mechanism, leaving files moved without any record in `_processing_registry.json`. | Inconsistent registry, broken digest generation, and untracked file relocations. |
| **HIGH-05** | **High** | `src/server/validation.ts:93–180` | `DecisionTestSchema` lacked strict local-endpoint validation (`isLocalEndpoint`), allowing arbitrary HTTP/HTTPS endpoints. | Potential network leakage of note excerpts to external cloud endpoints in an offline app. |
| **MED-01** | **Medium** | `server.ts:335–450` | The file processing queue and retry schedule relied on in-memory `setTimeout`. If the server restarted during backoff, pending tasks were lost. | Lost processing jobs upon system crash or server restart. |
| **MED-02** | **Medium** | `server.ts:610–710` | Recursive directory traversal silently caught `readdir` and `stat` errors without returning diagnostic warnings to the caller. | Silently incomplete scan results during refine previews and operations. |
| **MED-03** | **Medium** | `package.json` vs `README.md` | Versioning inconsistency between `package.json` (`v3.0.0`) and `README.md` (`v5.2/v5.3`). | Build tooling confusion, broken dependency tracking, and user distrust. |

---

## Architecture & Data Safety Analysis

### 1. Dual-Model Pipeline & Local AI Guarantees
- The dual-model architecture utilizes **Jev-Style Qwen 2B** for fast Bayesian hierarchical routing and **Hermes 3 / Llama 3.2 3B** for generative content distillation.
- Strictly offline operation is enforced at the schema and transport levels: all endpoints must match local loopback interfaces (`127.0.0.1`, `localhost`, `0.0.0.0`, `::1`). Any remote URLs are rejected by Zod validation schemas.
- In `fast_routing` mode, calibration gating guarantees that high-confidence decisions are verified against empirical threshold data (`99_System/index/thresholds.json`) before direct routing occurs.

### 2. Zero Source-Data Loss & Atomic File Operations
- All writes throughout the ingestion, fast-routing, and review workflows utilize atomic write-then-rename patterns (`.tmp.<timestamp>` → target).
- Inbox originals are moved only after target files and attachments are fully synced. Originals are archived to `99_System/_keep_raw/inbox` using collision-resistant SHA-256 hashes.
- Name collision detection enforces numerical incrementing (`Note 1.md`, `Note 2.md`) and content-based deduplication, guaranteeing that existing files are never overwritten.
