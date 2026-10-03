# Obsidian-Local-LLM-Pipeline (v5.3.0) — Release Checklist

## Release Gate Status: **READY FOR RELEASE (ALL BLOCKERS RESOLVED & VERIFIED)**

---

## 1. Mandatory Code Remediation Gates

| # | Requirement | File(s) | Verification Test(s) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1.1** | Realpath-based symlink-safe path validation | `src/server/validation.ts` | `R9`, `R15`, `R17`, `validation.test.ts` | **PASS** |
| **1.2** | Enforce loopback-only model endpoints by default | `src/server/validation.ts` | `R10`, `R20`, `validation.test.ts` | **PASS** |
| **1.3** | Protect all filesystem operations including non-existent paths | `src/server/validation.ts`, `server.ts` | `R9`, `R15`, `R17`, `validation.test.ts` | **PASS** |
| **2.1** | Fast Route: Prevent destination overwrites | `server.ts` | `R22` | **PASS** |
| **2.2** | Fast Route: Atomic collision-safe writes (`.tmp` -> rename) | `server.ts` | `R22` | **PASS** |
| **2.3** | Fast Route: Verify destination persistence before deleting source | `server.ts` | `R22`, `hierarchicalRouting.test.ts` | **PASS** |
| **2.4** | Fast Route: Preserve source on all failures | `server.ts` | `R22`, `llm.test.ts` | **PASS** |
| **3.1** | Snapshot: Conflict-aware rollback (SHA-256 verification) | `src/server/snapshot.ts` | `R12`, `R16`, `R18` | **PASS** |
| **3.2** | Snapshot: No overwrites of newer files (`.conflict.<ts>.bak` / `preserveNewerInPlace`) | `src/server/snapshot.ts` | `R12`, `R16`, `R18` | **PASS** |
| **3.3** | Snapshot: Validate manifests and paths | `src/server/snapshot.ts` | `R12`, `R16`, `snapshot.test.ts` | **PASS** |
| **3.4** | Snapshot: Remove silent catch blocks | `src/server/snapshot.ts` | `R12`, `R16`, `snapshot.test.ts` | **PASS** |
| **3.5** | Snapshot: Verify moved-file identity & original restoration before deletion | `src/server/snapshot.ts` | `R16` | **PASS** |
| **4.1** | Decision Model: Remove automatic Option A fallback | `src/server/decisionModel.ts` | `R11`, `decisionModel.test.ts` | **PASS** |
| **4.2** | Decision Model: Invalid output returns explicit uncertain state (`letter: '?'`, `confidence: 0.0`) | `src/server/decisionModel.ts` | `R11`, `decisionModel.test.ts` | **PASS** |
| **4.3** | Decision Model: Never fabricate 100% confidence (`calibrated: false` capped at `0.5`) | `src/server/decisionModel.ts` | `R11`, `decisionModel.test.ts` | **PASS** |
| **5.1** | Queue: Persistent job storage (`99_System/_queue_state.json`) & crash recovery | `server.ts` | `R13` | **PASS** |
| **5.2** | Queue: Preserve retry state (`retryCount`, `nextRetryAt`) across restarts | `server.ts` | `R13` | **PASS** |
| **5.3** | Queue: Implement graceful shutdown (`SIGINT`, `SIGTERM`) | `server.ts` | `R13` | **PASS** |
| **6.1** | Registry: Registry update failure never silently ignored | `server.ts` | `R19` | **PASS** |
| **6.2** | Registry: Atomic recoverable registry updates & journal reconciliation | `server.ts` | `R19` | **PASS** |
| **6.3** | Registry: Source archival and registry persistence form a recoverable transaction | `server.ts` | `R19`, `hierarchicalRouting.test.ts` | **PASS** |
| **7.1** | Error Handling: Controlled shutdown on uncaughtException / unhandledRejection | `server.ts` | `R13` | **PASS** |
| **7.2** | Error Handling: Report configuration errors instead of silently ignoring them | `server.ts` | `R3`, `R10` | **PASS** |
| **8.1** | Release Consistency: Synchronize `package.json` (`5.3.0`), `README.md`, and `CHANGELOG.md` | `package.json`, `README.md`, `CHANGELOG.md` | `R14`, `R23` | **PASS** |
| **8.2** | Release Consistency: Windows 10 compatible scripts (`cross-env`, `pathToFileURL`, `.bat`) | `package.json`, `scripts/*.ts`, `start.bat`, `install.bat` | `R23` | **PASS** |

---

## 2. Mandatory Command & Scenario Verification Evidence

### 2.1 Build, Lint, Dependency & Test Execution
- [x] **`npm ci`**: Clean dependency installation verified (`added 395 packages, and audited 396 packages in 6s, found 0 vulnerabilities`).
- [x] **`npm run lint`**: `tsc --noEmit` passed with **0 errors**.
- [x] **`npm test`**: Vitest full suite passed — **13 test files passed, 127 tests passed, 0 failed**.
- [x] **`npm run build`**: Vite client build (`dist/index.html` + assets) and esbuild server bundle (`dist/server.cjs`, `167.2kb`) succeeded with **0 errors**.

### 2.2 Security & Edge-Case Scenario Verification
- [x] **Symlink Escape (Windows & Linux normalization)**: Verified via `R9`, `R15`, `R17`, and `tests/validation.test.ts` (live file symlinks, directory symlinks, non-existent nested targets inside symlinked directories, dangling symlinks, and Windows drive-letter normalization).
- [x] **Destination Collision**: Verified via `R22` (`Winter.md` preserved intact; colliding incoming note written atomically to `Winter 1.md`).
- [x] **Interrupted Writes & Rollback Conflicts**: Verified via `R12`, `R16`, and `R18` (SHA-256 mismatch detection, `.conflict.<ts>.bak` creation, `preserveNewerInPlace` option, and moved-file modification preservation).
- [x] **Process Termination & Queue Recovery**: Verified via `R13` and `R19` (`_queue_state.json` persistence with `retryCount` and `nextRetryAt`, `recoverQueueState()`, and `reconcileRegistryJournal()`).
- [x] **Offline Endpoint Restrictions**: Verified via `R10`, `R20`, and `tests/validation.test.ts` (`isLocalEndpoint` blocks remote URLs across `ConfigSchema` and `DecisionTestSchema` unless `allowRemoteEndpoints: true`).
- [x] **Disposable Copy of Real Obsidian Vault**: Verified via `R21` against an isolated temporary copy of `demo_obsidian_vault` (`tests/_temp_security_regressions/disposable_vault`); `git status` confirms `demo_obsidian_vault` is completely unmodified.
