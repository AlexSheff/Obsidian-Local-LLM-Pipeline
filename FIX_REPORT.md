# Obsidian-Local-LLM-Pipeline (v5.3.0) — Fix Report & Verification Evidence

## Executive Summary
Every Critical, High, and Medium defect identified in the release-blocking review of `main` (`v5.3.0`) has been remediated and verified against automated regression tests and a disposable copy of `demo_obsidian_vault`.

---

## Defect Remediation Details

### Defect 1: `src/server/validation.ts` — Realpath Symlink-Safe Path Validation & Loopback Endpoints
- **Original Failure Reproduction:**
  - Creating a symbolic link `<vault>/00_Inbox/evil_symlink.md -> /outside/passwords.txt` or directory symlink `<vault>/01_Projects/escaped -> /outside` allowed file operations outside the vault boundary.
  - Creating a dangling symlink `<vault>/00_Inbox/dangling.md -> /outside/does_not_exist_yet.md` bypassed `fs.existsSync` checks.
  - Passing `llamaUrl: "https://remote-llm.example.com"` in `ConfigSchema` or `DecisionTestSchema` succeeded without error.
- **Root Cause:**
  - `isPathInsideVault` used lexical `path.resolve` without `fs.lstatSync` symlink inspection or `fs.realpathSync` canonicalization on existing ancestors.
  - Endpoint schemas lacked a loopback hostname validator.
- **Exact Implementation Change:**
  - `src/server/validation.ts` (lines 34–126): Rewrote `isPathInsideVault` with 3-stage validation:
    1. Lexical relative path check against `resolvedVault`.
    2. Ancestor chain `fs.lstatSync` + `fs.readlinkSync` traversal to detect and block both live and dangling symlinks pointing outside `realVault`.
    3. Canonical `fs.realpathSync` resolution on the target (or deepest existing ancestor directory + remaining segments for non-existent paths), with Windows lowercase normalization.
  - `src/server/validation.ts` (lines 132–149, 243–265, 310–326): Implemented `isLocalEndpoint()` allowing only `localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1`, and `[::1]` unless `allowRemoteEndpoints: true` is explicitly configured.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R9`, `R10`, `R15`, `R17`, `R20`
  - `tests/validation.test.ts`: `rejects symlinks pointing outside the vault`, `enforces local offline endpoints by default`.
- **Test Execution Result:**
  - `PASS` — Verified in `tests/security-regressions.test.ts` and `tests/validation.test.ts`.

---

### Defect 2: `server.ts` Fast Route — Atomic Collision-Safe Writes & Source Preservation
- **Original Failure Reproduction:**
  - When `decisionMode` was `fast_routing` and a note `Winter.md` was routed to `03_Knowledge/Poems/Winter.md` where a different `Winter.md` already existed, `fsPromises.writeFile` overwrote the existing destination file and unlinked the source file.
- **Root Cause:**
  - Fast-routing branches in `refineFile` and `processFile` wrote directly to `destPath` without checking `fs.existsSync(destPath)`, writing to a `.tmp` file, or verifying the written destination before unlinking the source.
- **Exact Implementation Change:**
  - `server.ts` (`refineFile` lines 1118–1168, `processFile` lines 1680–1830):
    - Added destination collision resolution: compares normalized body content if destination exists; appends incremental numeric suffixes (`Title 1.md`, `Title 2.md`) when content differs.
    - Writes to `${finalDestPath}.tmp.${Date.now()}` and atomically renames to `finalDestPath`.
    - Verifies destination persistence (`fs.existsSync(finalDestPath)` and `stat.size > 0`) and records snapshot move (`options.snapshot.recordMove`) before unlinking source.
    - Archives raw original to `99_System/_keep_raw/inbox` and preserves source on any error.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R22: Fast Route never overwrites existing destination note with the same name`.
- **Test Execution Result:**
  - `PASS` — Existing destination file preserved intact; incoming note written atomically to `Winter 1.md`.

---

### Defect 3: `src/server/snapshot.ts` — Conflict-Aware Rollback & Verified Manifests
- **Original Failure Reproduction:**
  - Editing a note after `session.backup(notePath)` and then calling `restoreSnapshotSession(vaultPath, sessionId)` overwrote the newer edits without creating a backup.
  - Editing a moved note after `session.recordMove(from, to)` and rolling back unlinked the moved note without preserving the post-move edits.
- **Root Cause:**
  - `restoreSnapshotSession` unconditionally copied snapshot files over destination files and unlinked moved files without comparing SHA-256 hashes or validating paths.
- **Exact Implementation Change:**
  - `src/server/snapshot.ts` (lines 30–281):
    - Added `computeSha256` during `backup()` and persisted `_manifest.json` and `_moved_manifest.json` atomically via `.tmp` files.
    - Enforced `isPathInsideVault` on all backup, move, and restore paths.
    - Added conflict detection in `restoreSnapshotSession`: if `currentHash !== backupHash`, saves `.conflict.<ts>.bak` (or `.snapshot.<ts>.bak` when `preserveNewerInPlace: true`) and records the conflict in `result.conflicts`.
    - Verified `fs.existsSync(origAbs)` and compared `origHash` vs `movedHash` before unlinking moved files during rollback.
    - Replaced silent `catch` blocks with structured error reporting in `result.errors`.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R12`, `R16`, `R18`
  - `tests/snapshot.test.ts`: Snapshot backup and restore suite.
- **Test Execution Result:**
  - `PASS` — Zero newer edits lost; conflict backups created and verified.

---

### Defect 4: `src/server/decisionModel.ts` — Removal of Automatic Option A Fallback & Artificial 100% Confidence
- **Original Failure Reproduction:**
  - Calling `parseDecisionResponse` with a response lacking `logprobs` and containing `"I don't know"` or `"Unclear"` returned `chosen.letter = 'A'` and `confidence = 1.0`.
- **Root Cause:**
  - `parseDecisionResponse` defaulted `chosenIndex = 0` (`Option A`) and assigned `probability = 1.0` whenever `top_logprobs` was absent.
- **Exact Implementation Change:**
  - `src/server/decisionModel.ts` (lines 189–248):
    - Restricted fallback matching to valid option letters only.
    - Capped uncalibrated valid letter matches at `confidence: 0.5` with `calibrated: false`.
    - Returned explicit uncertain state (`letter: '?'`, `option: 'Invalid or Ambiguous Model Response'`, `confidence: 0.0`, `calibrated: false`) when output does not match a valid option.
  - `src/server/llm/hierarchicalRouter.ts` (lines 110–190): Guarded index lookup when `letter === '?'` and required `calibrated && confidence >= threshold` for high-confidence routing.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R11: parseDecisionResponse never fabricates 100% confidence when logprobs are missing or output is invalid`
  - `tests/decisionModel.test.ts`: 8 unit tests covering calibrated and uncalibrated responses.
- **Test Execution Result:**
  - `PASS` — Uncalibrated valid responses return `0.5` (`calibrated: false`); invalid responses return `'?'` with `0.0` confidence.

---

### Defect 5: `server.ts` Queue — Persistent Job Storage, Retry Recovery & Graceful Shutdown
- **Original Failure Reproduction:**
  - Jobs waiting for retry in an in-memory `setTimeout` were lost if the process restarted before the timer fired.
- **Root Cause:**
  - Retry backoff was not persisted in `_queue_state.json`, and `SIGINT`/`SIGTERM` handlers were absent.
- **Exact Implementation Change:**
  - `server.ts` (lines 145–175, 340–520):
    - Added `nextRetryAt` to `QueueItem` and persisted items in backoff to `99_System/_queue_state.json` via atomic write-then-rename.
    - Implemented `recoverQueueState()` to restore queued items, `retryCount`, and `nextRetryAt` schedules on startup.
    - Added `gracefulShutdown` handlers for `SIGINT` and `SIGTERM`.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R13: recoverQueueState restores persisted file queue tasks and retry counts after crash/restart`.
- **Test Execution Result:**
  - `PASS` — Persisted tasks and retry counts restored accurately.

---

### Defect 6: `server.ts` Registry — Atomic Recoverable Registry Updates & Transaction Integrity
- **Original Failure Reproduction:**
  - A failure during `_processing_registry.json` write after moving an inbox note was caught and ignored, leaving the moved file untracked.
- **Root Cause:**
  - No fallback append journal orstartup reconciliation existed, and source deletion proceeded even if registry persistence failed completely.
- **Exact Implementation Change:**
  - `server.ts` (lines 380–425, 1765–1830, 2040–2145):
    - Wrapped registry updates in `registryMutex` with atomic `.tmp` write-then-rename.
    - Added fallback append journaling to `99_System/_processing_registry_journal.jsonl`.
    - Aborts source unlinking if both primary registry and fallback journal writes fail, preserving the source note in `00_Inbox`.
    - Implemented `reconcileRegistryJournal(vaultPath)` to merge journal records into `_processing_registry.json`.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R19: reconcileRegistryJournal consolidates fallback journal records into main registry without data loss`.
- **Test Execution Result:**
  - `PASS` — Journal entries consolidated into `_processing_registry.json` and journal cleaned up atomically.

---

### Defect 7: `server.ts` Error Handling — Controlled Shutdown & Explicit Config Error Reporting
- **Original Failure Reproduction:**
  - Uncaught exceptions only appended to a log file without shutting down active sockets or flushing queue state.
  - Malformed `config.json` on startup was silently ignored without logging or exposing the error.
- **Root Cause:**
  - Passive global error handlers and empty `catch` blocks in `loadConfigFromFile`.
- **Exact Implementation Change:**
  - `server.ts` (lines 112–144): Implemented `handleFatalCrash(type, error)` to log to `emergency_crash_log.txt`, synchronously flush `_queue_state.json`, close `watcher` and `runningHttpServer`, stop child LLM servers, and exit with status `1`.
  - `server.ts` (lines 285–325): Updated `loadConfigFromFile` to report validation and parse errors to `console.error` and `configLoadError`.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R3`, `R10`, `R13`.
- **Test Execution Result:**
  - `PASS`.

---

### Defect 8: Release Consistency & Windows 10 Script Compatibility
- **Original Failure Reproduction:**
  - `package.json` version (`3.0.0`) did not match `README.md` (`v5.3`), `CHANGELOG.md` was missing, and `scripts/*.ts` used `if (import.meta.url === \`file://\${process.argv[1]}\`)` which fails on Windows 10 paths (`C:\...`).
- **Root Cause:**
  - Unsynchronized release metadata and non-portable `file://` string concatenation in CLI entrypoints.
- **Exact Implementation Change:**
  - Updated `package.json` to `"version": "5.3.0"`, synchronized `README.md`, and created `CHANGELOG.md`.
  - Updated all 7 scripts in `scripts/*.ts` to use `pathToFileURL(path.resolve(process.argv[1])).href`.
- **Regression Test:**
  - `tests/security-regressions.test.ts`: `R14` and `R23`.
- **Test Execution Result:**
  - `PASS`.

---

## Mandatory Verification Execution Log

| Command / Check | Execution Result | Details |
| :--- | :--- | :--- |
| `npm ci` | **PASS** | Clean deterministic installation from `package-lock.json` (`0 vulnerabilities`). |
| `npm run lint` | **PASS** | `tsc --noEmit` completed with `0 errors`. |
| `npm test` | **PASS** | `13 passed` test suites, `127 passed` tests (`0 failed`). |
| `npm run build` | **PASS** | Vite frontend bundle (`dist/index.html`, assets) + esbuild backend bundle (`dist/server.cjs`, 167.2kb) built cleanly. |
| Disposable Vault Test | **PASS** | Executed against disposable copy of `demo_obsidian_vault` in `R21` without modifying source vault. |
