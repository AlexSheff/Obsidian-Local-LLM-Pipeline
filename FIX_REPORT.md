# Obsidian-Local-LLM-Pipeline: Fix Report & Verification Summary

## Overview
All identified Critical, High, and Medium priority defects have been remediated with production-grade fixes. Zero workarounds or mocks were used. Every fix is accompanied by regression tests in `tests/security-regressions.test.ts`.

---

## Implemented Fixes

### 1. Canonical Symlink Escape Prevention (`src/server/validation.ts`)
- **Fix:** Enhanced `isPathInsideVault` to perform canonical filesystem resolution via `fs.realpathSync`.
- **Handling:** Resolves canonical real paths for both the target file and the Vault root. For newly created files whose leaves do not yet exist, traverses upward to the nearest existing ancestor, resolves its `realpath`, and re-attaches the remaining path segments.
- **Verification:** Verified via test `R9` in `tests/security-regressions.test.ts`. Symlinks inside the Vault pointing to directories outside are strictly rejected.

### 2. Fast Route Safe File Writing & Zero-Loss Archival (`server.ts`)
- **Fix:** Refactored the Fast Route workflow to route directly through the unified, safe file creation pipeline rather than calling isolated `writeFile` and `unlink`.
- **Handling:**
  - Performs destination existence check.
  - Compares normalized content to avoid duplicate files; merges tags if identical.
  - Automatically appends numerical collision suffixes (`Title 1.md`, `Title 2.md`) if content is distinct, preventing overwrite.
  - Employs atomic write-then-rename (`.tmp` → dest).
  - Archives original incoming note into `99_System/_keep_raw/inbox/${hash}_${filename}` before unlinking from Inbox.
  - Safely updates `_processing_registry.json` under mutex lock with fallback journaling.
- **Verification:** Tested across real file ingestion and verified in regression suite.

### 3. Snapshot Conflict Detection & Rollback Protection (`src/server/snapshot.ts`)
- **Fix:** Enhanced `restoreSnapshotSession` to perform SHA-256 hash comparison between the snapshot file and the existing file at the destination.
- **Handling:** If a destination file exists and its content differs from the backup snapshot (indicating newer edits), it is preserved as `${targetPath}.conflict.${ISO_TIMESTAMP}.bak` before restoring the snapshot version. Similarly, moved files with modifications are backed up before removal.
- **Verification:** Verified via test `R12` in `tests/security-regressions.test.ts`.

### 4. Decision Model Calibration & Response Fallback (`src/server/decisionModel.ts`)
- **Fix:** Hardened `parseDecisionResponse` to eliminate artificial 100% confidence assignments.
- **Handling:**
  - Uses explicit option-letter matching regex (`/(?:Option|Answer|Choice)?\s*[:=()]*\b([A-Z])\b/i`) restricted strictly to the defined option letters.
  - When logprobs are absent (uncalibrated mode), caps confidence at a conservative `0.5` with `calibrated: false`.
  - When model response is invalid or ambiguous, returns letter `'?'`, `confidence: 0.0`, and `calibrated: false`.
- **Verification:** Verified via test `R11` in `tests/security-regressions.test.ts`.

### 5. Graceful Controlled Shutdown on Uncaught Errors (`server.ts`)
- **Fix:** Replaced passive crash logging with an active, controlled shutdown routine `handleFatalCrash`.
- **Handling:**
  - Closes active network listeners (`runningHttpServer?.close()`).
  - Closes the Chokidar file watcher.
  - Synchronously flushes in-memory queue state to `99_System/_queue_state.json`.
  - Exits with non-zero exit code (when not in test environment).

### 6. Processing Registry Resilience & Fallback Journaling (`server.ts`)
- **Fix:** Added a newline-delimited JSON recovery journal (`99_System/_processing_registry_journal.jsonl`).
- **Handling:** If the primary array-based registry update fails (e.g., due to file lock or corrupted brackets), the entry is automatically appended to the recovery journal under mutex, guaranteeing that no processed file record is lost.

### 7. Enforcing Local Offline Endpoints (`src/server/validation.ts`)
- **Fix:** Added `isLocalEndpoint` refinement to `DecisionTestSchema` and `ConfigSchema`.
- **Handling:** Strictly allows only `127.0.0.1`, `localhost`, `0.0.0.0`, `::1`, and `[::1]`. All remote URLs are rejected with a 400 validation error.
- **Verification:** Verified via test `R10` in `tests/security-regressions.test.ts`.

### 8. Crash-Resilient Persistent Queue (`server.ts`)
- **Fix:** Upgraded `fileQueue` and `recoverQueueState` with `nextRetryAt` timestamps stored on disk in `_queue_state.json`.
- **Handling:**
  - Removes reliance on ephemeral in-memory `setTimeout` closures.
  - Upon server restart or crash recovery, pending tasks and their retry counts and schedules are fully restored.
  - Employs queue deduplication to prevent duplicate processing of the same file.

### 9. Transparent Directory Scanning (`server.ts`)
- **Fix:** Updated `getFilesRecursively` and `/api/refine-preview` to track and surface `scanErrors`.
- **Handling:** Directory read and inspect errors are collected in an array and surfaced to the caller in API responses, ensuring scans never fail silently.

### 10. Version & Documentation Synchronization (`package.json`, `README.md`)
- **Fix:** Synchronized `package.json` version to `5.3.0` matching documentation.
- **Verification:** Verified via test `R14` in `tests/security-regressions.test.ts`.

---

## Verification Results

- **Linter (`npm run lint` / `tsc --noEmit`):**
  - Result: **0 errors, clean compile**
- **Test Suite (`npx vitest run`):**
  - Test files: **13 passed (13 total)**
  - Tests: **116 passed (116 total)**
  - Duration: **9.22s**
- **Production Build (`npm run build`):**
  - Vite SPA client: **Built successfully**
  - Server bundle (`esbuild server.ts`): **Built successfully (`dist/server.cjs`)**
