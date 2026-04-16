# Review: LC-3a — Health Check Utilities

## Verdict: APPROVE

All three blocking findings from the initial review have been addressed in the patch.

### Resolved findings

- [Critical, resolved] `checkDevToolsMcpResolvable` process leak on timeout — Fixed: `proc.kill()` is now called inside the timeout handler (line 43) before rejecting, ensuring the spawned npx process is always cleaned up.

- [Major, resolved] Non-HACK comment in `killStaleMcpProcesses` — Fixed: the `// Process may already be dead` comment has been removed from the empty catch block (line 94-95).

- [Major, resolved] Timeout timer never cleared in `checkDevToolsMcpResolvable` — Fixed: `clearTimeout(timer!)` in a `finally` block (lines 60-62) ensures the timer is always cleaned up regardless of which promise wins the race.

### Remaining observations (non-blocking)

- [Minor] `killStaleMcpProcesses` pgrep pattern `"chrome-devtools-mcp"` is broad (health-checks.ts:75). Acceptable since LC-4 will add lockfile-based process tracking.

- [Minor] Tests are contract tests against live system state. Adequate for shape validation but no deterministic coverage of success vs failure branches.

### Verification

- `bunx tsc --noEmit`: passes clean
- `bun test tests/lifecycle/health-checks.test.ts`: 7/7 pass, 16 assertions
- No existing files modified
- Only import is `type { AgentBackend } from "@neuve/agent"` (correct)

### Suggestions (non-blocking)

- Consider `AbortSignal.timeout()` + `signal.addEventListener("abort", () => proc.kill())` as a cleaner alternative to the manual `Promise.race` + `setTimeout` pattern.

- The `runHealthChecks` test suite could add a non-`"claude"` non-`"local"` agent type (e.g. `"codex"`) to strengthen the exclusion assertion.
