# Review: LC-2a — Shutdown Controller Module

## Verdict: APPROVE

### Verification

- **tsc**: `bunx tsc --noEmit` passes clean (no errors in shutdown.ts; no other LC files affected).
- **Tests**: 12 pass, 0 fail, 18 assertions.
- **Self-contained**: shutdown.ts has zero imports — uses only Node `process` globals. No existing files modified.

### Findings

- [Minor] Explanatory comments on lines 39 and 50 of shutdown.ts ("Process may already be dead", "Swallow — cleanup must not throw") violate the "no comments unless it's a hack" rule from CLAUDE.md. Remove them — the empty catch block is self-explanatory in a shutdown context. (shutdown.ts:39, shutdown.ts:50)

- [Minor] `cleanupHandlers` (Set) and `registrationOrder` (Array) are kept in parallel but `cleanupHandlers` is never iterated. It's only used for `.delete()` in unregister and `.clear()` in teardown — both of which could be done on the array alone. The Set adds no value since unregister already does a linear `.indexOf` scan on the array. Consider dropping the Set and using only the array. (shutdown.ts:8, shutdown.ts:10)

### Suggestions (non-blocking)

- Add one test with an async cleanup handler (a handler that returns a Promise that resolves after a tick). All current test handlers are synchronous, so the `await handler()` path on line 49 is only exercised trivially. The code is correct, but an explicit async test would document the contract.

- Consider a test for the force-exit timer behavior. For example: register a handler that never resolves, mock `setTimeout`, and verify `process.exit(1)` is called. This is the most important safety net in the module and currently has no direct coverage. Understood this is tricky with timer mocking — non-blocking.

- The idempotency gap between `shuttingDown = true` (line 64) and `shutdownPromise = ...` (line 66) is safe due to single-threaded JS, but assigning `shutdownPromise` first (before setting `shuttingDown`) would make the intent clearer:
  ```ts
  shuttingDown = true;
  shutdownPromise = (async () => { ... })();
  return shutdownPromise;
  ```
  Currently this is already the structure, so no change needed — just confirming the ordering is correct.
