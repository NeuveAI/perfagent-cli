# Lifecycle Plan — TUI Lifecycle Management & UX Improvements

_Status: active plan. Follows the Harness Port (HP-1 through HP-5)._

---

## Goal

Make the Solid TUI production-ready by adding human-readable error display, graceful shutdown with full process cleanup, bootup health checks, stale session cleanup, and session history with a `/resume` command. These five phases eliminate the UX issues found during dry-run testing so the TUI is ready for the P6 Ink deletion.

---

## Critical path (what users experience)

1. **Startup** — TUI launches, kills any stale `chrome-devtools-mcp` zombies from previous runs, runs health checks (agent backend reachable, chrome-devtools-mcp resolvable), shows a brief spinner during checks, then displays Main screen.
2. **Happy path** — unchanged from HP-5: Main → CookieSync → PortPicker → Testing → Results.
3. **Error path** — when Testing fails, the user sees a human-readable error with an actionable hint and a "retry" option (not just "esc to go back").
4. **Quit** — `q` on Main screen or ctrl+c anywhere triggers cleanup: dispose AtomRegistry, kill child processes, exit alternate screen. No zombie processes.
5. **Resume** — `/resume` on Main screen shows recent sessions with instruction + timestamp + status. Selecting one re-submits the instruction.

---

## Tasks

### LC-1a: Error Parser Utility

**Goal:** Parse Effect Cause structures into human-readable `{ title, message, hint }` objects.

**Files:**
- Create `apps/cli-solid/src/utils/parse-execution-error.ts`
- Create `apps/cli-solid/tests/utils/parse-execution-error.test.ts`

**Pattern-matches on `_tag`:**
- `AcpSessionCreateError` with "Connection closed" → "Session failed — a previous browser session may be stale"
- `DevToolsConnectionError` → "Browser connection failed"
- `DevToolsToolError` → "Browser tool error"
- `ExecutionError` → unwrap `.reason` and recurse
- `AcpProviderNotInstalledError` → use `.message` directly
- `AcpProviderUnauthenticatedError` → use `.message` directly
- `AcpStreamError` → "Agent stream error"
- Fallback: truncated `String(cause)` at 500 chars

**Acceptance:** All known error tags produce human-readable output. Tests pass. `pnpm typecheck` green.

**Blocked by:** nothing

---

### LC-1b: Error Display Component + Retry Action

**Goal:** Replace the raw error dump in Testing screen with structured error display + retry.

**Files:**
- Create `apps/cli-solid/src/renderables/error-display.tsx`
- Modify `apps/cli-solid/src/routes/testing/testing-screen.tsx` — replace `String(exit.cause)` with `parseExecutionError`, add `r` key for retry
- Modify `apps/cli-solid/src/commands/register-testing.ts` — add retry command

**Acceptance:** Errors show human-readable messages. `r` retries from error state. `pnpm typecheck` green.

**Blocked by:** LC-1a

---

### LC-2a: Shutdown Controller Module

**Goal:** Centralized shutdown controller managing the cleanup sequence.

**Files:**
- Create `apps/cli-solid/src/lifecycle/shutdown.ts` — registers SIGINT/SIGTERM, tracks child PIDs, disposes AtomRegistry, writes/deletes lockfile
- Create `apps/cli-solid/tests/lifecycle/shutdown.test.ts`

**Key design:** Module-scoped singleton (not a Solid context) — signal handlers must work before and after the Solid render tree.

**Acceptance:** Idempotent shutdown. Child process tracking works. Tests pass.

**Blocked by:** nothing

---

### LC-2b: Wire Shutdown into TUI + Add `q` to Quit

**Goal:** Replace `exitOnCtrlC: true` with manual handling through shutdown controller.

**Files:**
- Modify `apps/cli-solid/src/tui.ts` — `exitOnCtrlC: false`, register shutdown handler before render
- Modify `apps/cli-solid/src/context/runtime.tsx` — register AtomRegistry with shutdown controller
- Modify `apps/cli-solid/src/commands/register-global.ts` — add `q` quit command (Main only) + `ctrl+c` handler

**Acceptance:** ctrl+c triggers clean shutdown. `q` on Main exits cleanly. No zombie processes.

**Blocked by:** LC-2a

---

### LC-3a: Health Check Utilities

**Goal:** Async functions to verify prerequisites before entering the main TUI flow.

**Files:**
- Create `apps/cli-solid/src/lifecycle/health-checks.ts` — `checkOllamaRunning()`, `checkDevToolsMcpResolvable()`, `killStaleMcpProcesses()`, `runHealthChecks(agent)`
- Create `apps/cli-solid/tests/lifecycle/health-checks.test.ts`

**Acceptance:** Each check returns structured results. Stale process detection works.

**Blocked by:** nothing

---

### LC-3b: Startup Screen with Spinner

**Goal:** Show "checking prerequisites..." spinner while health checks run.

**Files:**
- Create `apps/cli-solid/src/routes/startup/startup-screen.tsx`
- Modify `apps/cli-solid/src/context/navigation.tsx` — add `Startup: {}` to Screen union, default to Startup
- Modify `apps/cli-solid/src/app.tsx` — add Match case, trigger health checks on mount

**Acceptance:** TUI starts with spinner. Friendly error if prerequisites fail. Auto-navigates to Main on success.

**Blocked by:** LC-3a, LC-2b

---

### LC-4: Stale Session Cleanup + Lockfile

**Goal:** Ensure no zombie processes survive across TUI restarts.

**Files:**
- Modify `apps/cli-solid/src/lifecycle/shutdown.ts` — write/delete PID lockfile at `.perf-agent/tui.lock`
- Modify `apps/cli-solid/src/lifecycle/health-checks.ts` — `cleanupStaleLockfile()` checks if PID is alive, kills if so

**Acceptance:** On startup, previous TUI instance's zombies are cleaned up. Lockfile lifecycle correct.

**Blocked by:** LC-2a, LC-3a

---

### LC-5a: Session Storage

**Goal:** Persist each execution as a session record.

**Files:**
- Create `apps/cli-solid/src/data/session-history.ts` — `SessionRecord` interface, `saveSession`, `listSessions`, `updateSession`
- Create `apps/cli-solid/tests/data/session-history.test.ts`

**Storage:** `.perf-agent/sessions/<timestamp>-<id>.json`, capped at 100 files.

**Blocked by:** nothing

---

### LC-5b: Wire Session Recording into Testing Screen

**Goal:** Automatically record sessions during execution.

**Files:**
- Modify `apps/cli-solid/src/routes/testing/testing-screen.tsx` — save session on start, update on success/failure/cancel

**Blocked by:** LC-5a

---

### LC-5c: Resume Command + Session Picker Screen

**Goal:** Add `/resume` command to browse and re-run previous sessions.

**Files:**
- Create `apps/cli-solid/src/routes/session-picker/session-picker-screen.tsx`
- Modify `apps/cli-solid/src/context/navigation.tsx` — add `SessionPicker: {}`
- Modify `apps/cli-solid/src/app.tsx` — add Match case
- Modify `apps/cli-solid/src/commands/register-main.ts` — wire `ctrl+r` to SessionPicker
- Create `apps/cli-solid/src/commands/register-session-picker.ts`

**Blocked by:** LC-5a, LC-5b, LC-3b

---

## Parallel execution strategy

```
Wave 1 (parallel): LC-1a, LC-2a, LC-3a, LC-5a
Wave 2 (parallel): LC-1b, LC-2b, LC-5b
Wave 3 (parallel): LC-3b, LC-4
Wave 4:            LC-5c
```

---

## Risks

1. **`exitOnCtrlC: false` in OpenTUI** — must register `process.on('SIGINT')` BEFORE `render()` as safety net
2. **Stale process detection cross-platform** — `pgrep`/`pkill` are POSIX; wrap in try/catch
3. **AtomRegistry dispose timing** — 3-second force-exit timer as safety net
4. **`q` keybind vs text input** — gated by `inputFocused` provider; only fires when input is blurred. May use `ctrl+q` instead.
5. **Health check latency** — 3-second timeout, run in parallel, show spinner

---

## After this lands

P6: delete `apps/cli/` entirely, flip the `perf-agent` binary to cli-solid.
