# Harness Port Plan — End-to-End Trace Execution in the Solid TUI

_Status: active plan. After this lands, the Ink TUI gets deleted._

---

## Goal

Port the end-to-end trace execution harness so the Solid TUI can replace the Ink TUI entirely — a user submits an instruction, runs a full trace via any agent backend (Ollama/Gemma, Claude, etc.) with devtools-cli, sees live streaming progress, and views results.

---

## Critical path (exact user flow)

1. **Main menu** — user types instruction, presses `enter`
2. **Submit logic** decides next screen:
   - If `cookieBrowserKeys.length > 0` OR instruction contains a URL OR `cliBaseUrls` exists: skip to step 4
   - Otherwise: go to **CookieSyncConfirm**
3. **CookieSyncConfirm** — user selects browsers, presses `enter`. Calls `screenForTestingOrPortPicker()`:
   - If `baseUrls` provided OR instruction contains URL: go to **Testing**
   - Otherwise: go to **PortPicker**
4. **PortPicker** — user selects ports or custom URLs, presses `enter`. Navigates to `Screen.Testing({...})`
5. **Testing screen** — triggers `executeFn`, streams live events via sync store. Collapsed view: active step + last N tool calls + elapsed time. On completion: auto-navigates to **Results**. On `esc`: cancel-confirmation dialog.
6. **Results screen** — shows pass/fail, CWV metrics, step list, summary. Keys: `y` copy, `s` save, `r` restart, `esc` back to Main.

---

## What already exists in cli-solid (P0/P1/P2)

- Provider stack: Runtime, Kv, Agent, Project, Sync, Toast, Dialog, InputFocus, Command
- Effect↔Solid adapter: `atomToAccessor`, `atomFnToPromise`, 16ms batch coalescer
- `AsyncResult.builder` for Solid JSX (`buildAsyncResult`)
- Replicated sync store with pure reducer handling ALL event types
- Unified command registry with keybind dispatch + input-focus gating
- Dialog stack, toast system, keybind parser
- Main menu with real data (git state, recent reports, agent provider)
- Persistent preferences via kv (same on-disk format as Ink TUI)
- 296 tests

---

## Tasks

### HP-1: Screen Router + Navigation State

**Goal:** Add screen routing so the TUI can navigate between screens.

**Files:**
- Create `apps/cli-solid/src/context/navigation.tsx` — Solid context with `createSignal<Screen>`. Tagged union `Screen` mirrors `apps/cli/src/stores/use-navigation.ts`. Provides `setScreen()`, `currentScreen()`, `screenForTestingOrPortPicker()`.
- Modify `apps/cli-solid/src/app.tsx` — Add `NavigationProvider`. Replace hardcoded `<MainScreen />` with `<Switch>`/`<Match>` on `currentScreen()._tag`.

**Port from:** `apps/cli/src/stores/use-navigation.ts` (Screen enum, helper), `apps/cli/src/components/app.tsx:112-168` (renderScreen switch)

**Acceptance:** Screen transitions work, `pnpm typecheck` green.

**Blocked by:** nothing

---

### HP-2: Wire Submit + CookieSyncConfirm + PortPicker

**Goal:** Make `enter` on Main navigate through the submit flow. Build simplified CookieSyncConfirm and PortPicker.

**Files:**
- Modify `apps/cli-solid/src/routes/main/main-screen.tsx` — Wire `handleSubmit` (port logic from `apps/cli/src/components/screens/main-menu-screen.tsx:117-154`)
- Modify `apps/cli-solid/src/commands/register-main.ts` — Wire `main.submit` to call submit function
- Create `apps/cli-solid/src/routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx` — Simplified port. List browsers via `createResource`, multi-select, confirm navigates forward.
- Create `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx` — Simplified port. Listening ports + detected projects + custom URL + skip. Confirm navigates to Testing.
- Create `apps/cli-solid/src/commands/register-cookie-sync.ts`
- Create `apps/cli-solid/src/commands/register-port-picker.ts`

**Port from:** `apps/cli/src/components/screens/cookie-sync-confirm-screen.tsx`, `apps/cli/src/components/screens/port-picker-screen.tsx`, `apps/cli/src/hooks/use-installed-browsers.ts`, `apps/cli/src/hooks/use-listening-ports.ts`, `apps/cli/src/hooks/use-detected-projects.ts`

**Acceptance:** Full submit flow works (Main → CookieSync → PortPicker → Testing). `esc` backs out. Modeline correct per screen. `pnpm typecheck` green.

**Blocked by:** HP-1

---

### HP-3: Testing Screen (collapsed view + execution)

**Goal:** Build Testing screen that triggers `executeFn`, streams live progress, auto-navigates to Results.

**Files:**
- Create `apps/cli-solid/src/routes/testing/testing-screen.tsx` — On mount: `atomFnToPromise(executeFn)(input)`. Bridge events to sync store. Show collapsed view. Handle completion → Results navigation.
- Create `apps/cli-solid/src/routes/testing/collapsed-view.tsx` — Reads from sync store. Active step + last N tool calls + elapsed time.
- Create `apps/cli-solid/src/routes/testing/cancel-dialog.tsx` — Dialog stack entry. Confirm interrupts via `atomSet(executeFn, Atom.Interrupt)`.
- Create `apps/cli-solid/src/commands/register-testing.ts`

**Port from:** `apps/cli/src/components/screens/testing-screen.tsx`, `apps/cli/src/data/execution-atom.ts` (consumed unchanged)

**Key design:** Events feed into sync reducer (pre-indexed `steps[stepId].toolCalls[]`) instead of re-walking all events per render. Elapsed time is an isolated signal.

**Acceptance:** Submit reaches Testing, live streaming works, completion auto-navigates to Results, cancel works via dialog. `pnpm typecheck` green.

**Blocked by:** HP-1, HP-2

---

### HP-4: Minimal Results Screen

**Goal:** Results screen showing pass/fail, CWV metrics, step list, summary. No overlays (insights/raw-events/ask are future work).

**Files:**
- Create `apps/cli-solid/src/routes/results/results-screen.tsx` — Status, steps, summary, video URL.
- Create `apps/cli-solid/src/routes/results/metrics-table.tsx` — CWV metrics per URL.
- Create `apps/cli-solid/src/commands/register-results.ts` — `y` copy, `s` save, `r` restart, `esc` back. Stubs for overlay commands.

**Port from:** `apps/cli/src/components/screens/results-screen.tsx:49-645`

**Acceptance:** Results shows after Testing completes. `y` copies, `s` saves flow, `r` restarts, `esc` goes to Main. `pnpm typecheck` green.

**Blocked by:** HP-1, HP-3

---

### HP-5: Integration Wiring + Per-Screen Commands + Smoke Test

**Goal:** Wire everything end-to-end. Commands switch per screen. Run full smoke test.

**Files:**
- Modify `apps/cli-solid/src/app.tsx` — Command registrations gated per screen via `enabled: () => currentScreen()._tag === "X"`.
- Modify `apps/cli-solid/src/commands/register-global.ts` — Screen-aware `esc` back logic.

**Acceptance:** Full end-to-end flow: Main → (CookieSync) → (PortPicker) → Testing (streaming) → Results. Modeline correct per screen. Cancel works. No command leaks across screens. Manual smoke test against a real local dev server passes.

**Blocked by:** HP-1 through HP-4

---

## Risks

1. **`executeFn` bridge complexity.** Need both `atomFnToPromise` (trigger) and `atomToAccessor` (observe state). `onUpdate` callback must convert `ExecutedPerfPlan` diffs into SyncEvents. Approach: walk only NEW events (beyond previously-seen count), dispatch corresponding SyncEvents.

2. **`Atom.Interrupt` for cancellation.** Verify `atomSet(executeFn, Atom.Interrupt)` properly cancels the running fiber through `AtomRegistry.set`.

3. **Browser/port detection hooks.** Port as `createResource` wrappers (one-shot fetches, not subscriptions). Fastest for MVP.

4. **Command registration per-screen.** Gate with `enabled: () => currentScreen()._tag === "X"` so Main commands don't fire during Testing.

5. **`ChangesFor` construction.** For MVP, default to working-tree changes. Full branch/PR/commit variants come from the context picker (already stubbed).

---

## After this lands

Delete `apps/cli/` entirely. Remove React, Ink, zustand, @tanstack/react-query, @effect-atom/react deps. Flip the `perf-agent` binary to cli-solid. This is TUI-P6 (the final phase).
