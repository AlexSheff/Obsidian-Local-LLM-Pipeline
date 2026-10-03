# Changelog

All notable changes to the **Obsidian Local LLM Pipeline** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [5.3.0] - 2026-10-03

### Critical Security & Data Integrity Remediations
- **Canonical Realpath Symlink Traversal Protection (`src/server/validation.ts`)**:
  - Implemented strict canonical `fs.realpathSync` path validation for target files and all intermediate ancestor directories.
  - Added detection of dangling/broken symbolic links pointing outside the vault boundary.
  - Enforced Windows drive letter normalization and lowercase path matching to prevent casing bypasses.
- **Fast-Route Collision Prevention & Atomic Writes (`server.ts`)**:
  - Eliminated dangerous direct `fs.writeFile` overwrites in both `refineFile` and `processFile`.
  - Added pre-routing destination collision checks and duplicate content normalization.
  - Implemented automated unique numerical suffix incrementing (`Title 1.md`, `Title 2.md`) for distinct content.
  - Enforced atomic writes via temporary files (`.tmp.<timestamp>`) with destination persistence verification prior to source cleanup.
  - Preserved original incoming notes on any failure.
- **Conflict-Aware Snapshot Rollback (`src/server/snapshot.ts`)**:
  - Implemented SHA-256 conflict detection prior to overwriting any target file during snapshot rollback.
  - Automatically creates `.conflict.<timestamp>.bak` backups of files modified after snapshot creation, or supports non-destructive preservation in place (`preserveNewerInPlace: true`).
  - Added strict path validation on `_moved_manifest.json` entries and disk verification of original files before unlinking moved files.
  - Removed silent `catch` blocks and enforced atomic persistence of snapshot manifests.
- **Uncalibrated Model Confidence Fallback Elimination (`src/server/decisionModel.ts`)**:
  - Removed arbitrary Option A fallback and eliminated artificial 1.0 confidence generation.
  - Output without logprobs is flagged `calibrated: false` and capped at conservative 0.5.
  - Invalid, unparseable, or ambiguous outputs return an explicit uncertain state (`letter: '?'`, `confidence: 0.0`).
- **Loopback-Only Local Model Endpoint Enactment (`src/server/validation.ts`)**:
  - Enforced that `llamaUrl` and `decisionModelUrl` default exclusively to local loopback addresses (`127.0.0.0/8`, `localhost`, `[::1]`, `0.0.0.0`).
  - Remote endpoints are strictly rejected by Zod schema validation unless `allowRemoteEndpoints: true` is explicitly authorized.
- **Crash Recovery & Queue Persistence (`server.ts`)**:
  - Persistent queue journaling (`99_System/_queue_state.json`) stores jobs and retry schedules (`nextRetryAt`) on disk.
  - `recoverQueueState()` restores pending tasks and retry counts after process termination.
  - `reconcileRegistryJournal()` consolidates uncommitted records from `_processing_registry_journal.jsonl` into `_processing_registry.json`.
- **Controlled Process Shutdown & Error Reporting (`server.ts`)**:
  - Added `gracefulShutdown` handlers for `SIGINT` and `SIGTERM`.
  - Upgraded `handleFatalCrash` to write to `emergency_crash_log.txt`, close active listeners, flush queues to disk, and exit with code 1.
  - Configuration errors in `loadConfigFromFile` and `POST /api/config` are actively reported rather than silently swallowed.
- **Release Consistency & Windows 10 Compatibility (`package.json`, `scripts/*.ts`, `README.md`, `CHANGELOG.md`)**:
  - Synchronized version `5.3.0` across `package.json`, `README.md`, and `CHANGELOG.md`.
  - Replaced POSIX-only `file://${process.argv[1]}` checks across all CLI scripts in `scripts/*.ts` with cross-platform `pathToFileURL(path.resolve(process.argv[1])).href` for Windows 10 compatibility.

### Added
- Comprehensive P0 security regression test suite (`tests/security-regressions.test.ts`, 23 regression tests; 127 total tests across 13 suites).
- Detailed audit documentation: `CODE_REVIEW.md`, `FIX_REPORT.md`, `RELEASE_CHECKLIST.md`.
