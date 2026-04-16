# Review: LC-4 — Stale Session Cleanup + Lockfile

## Verdict: APPROVE

## Verification

- `bunx tsc --noEmit` — PASS (exit 0, no output).
- `bun test tests/lifecycle/` — PASS (31 tests pass, 0 fail, 53 expect() calls across 2 files, 5.88s).
- `installSignalHandlers()` is called before `render()` in `src/tui.ts:9` (unchanged by LC-4, owned by LC-2b).
- `writeLockfile` is only called inside `installSignalHandlers()` in production code (verified via grep); no other file writes the lockfile.
- `deleteLockfile` is called in the shutdown sequence (`src/lifecycle/shutdown.ts:94`) and in `_resetForTesting` (`src/lifecycle/shutdown.ts:127`), plus inside `cleanupStaleLockfile` (`src/lifecycle/health-checks.ts:132`).
- `runHealthChecks` calls `cleanupStaleLockfile()` BEFORE `killStaleMcpProcesses()` (`src/lifecycle/health-checks.ts:139-140`), matching the plan.
- `process.kill(pid, 0)` is used correctly for liveness probing (`src/lifecycle/health-checks.ts:120`).
- `cleanupStaleLockfile` guards against killing the current process (`src/lifecycle/health-checks.ts:114-116`).
- Test hygiene: `shutdown.test.ts` has global `beforeEach(_resetForTesting)` and `afterEach(unlinkSync lockfile)`; `health-checks.test.ts` has `afterEach(removeLockfile)` inside the `cleanupStaleLockfile` describe. No leftover `.perf-agent/tui.lock` on disk after the run (only the empty directory remains, which is acceptable).
- Code style: arrow functions, `import * as fs`/`import * as path`, kebab-case filenames, no stray comments.

## Findings

None that block merge.

## Suggestions (non-blocking)

- **Corrupt lockfile not self-healing** (`src/lifecycle/health-checks.ts:109-112`) — If the lockfile contains non-numeric content, `readLockfile()` returns `undefined`, and `cleanupStaleLockfile` early-returns `{ cleaned: false }` without deleting the corrupt file. Every subsequent startup will keep the corrupt file around, and the test on `tests/lifecycle/health-checks.test.ts:91-98` even asserts `{ cleaned: false }` without checking whether the file remains. Consider deleting the lockfile in `readLockfile`'s parse-failure branch or in `cleanupStaleLockfile` when the PID can't be parsed, so a single startup heals the state.
- **EPERM treated as "dead"** (`src/lifecycle/health-checks.ts:118-124`) — `process.kill(pid, 0)` throws for both ESRCH (no such process) and EPERM (process exists but is owned by another user). The current code catches both and treats them as "dead", then attempts `SIGTERM` which will also throw EPERM and be silently swallowed. Result: `cleaned: true, killedPid: undefined` when the process is actually alive. Edge case for multi-user systems; unlikely to bite real users but worth noting.
- **Race between two simultaneous TUI starts** — If two instances read an empty lockfile and both call `writeLockfile`, the last writer wins and the other instance's PID is lost. The spec-noted minor concern — acceptable for a single-user TUI but worth documenting. An atomic `O_EXCL` create would prevent it, but the upside is marginal.
- **Dead-process SIGTERM is skipped, but lockfile delete is not** (`src/lifecycle/health-checks.ts:126-132`) — The code already gates SIGTERM on `alive`, which is correct. Minor nit: `cleanupStaleLockfile` always deletes the lockfile if `previousPid !== undefined` and `!== process.pid`, even when the PID is unparseable (which can't happen due to early return). No actual bug; flagging only to confirm the logic was considered.
- **Empty-catch style** (`src/lifecycle/shutdown.ts:19, 25, 33, 63, 73, 128`) — Multiple `catch {}` blocks. Intentional (best-effort cleanup), but consider an inline comment like `// HACK: best-effort cleanup — must not throw during shutdown` on at least one to signal intent per the repo's "comments only for hacks" rule. Non-blocking.
- **`runHealthChecks` tests don't stub external processes** (`tests/lifecycle/health-checks.test.ts:101-132`) — These tests invoke the real `pgrep` and real `npx chrome-devtools-mcp --version` on every run. Slow and environment-dependent. Not introduced by LC-4 (LC-3a), but the added `cleanupStaleLockfile` call at startup means these tests also touch `.perf-agent/tui.lock` silently. Fine for now.
