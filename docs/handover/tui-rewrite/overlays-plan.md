# Overlays & Terminal Teardown Plan

_Status: draft. Follows the Lifecycle Plan (LC-1a through LC-5c). Waiting for review before execution._

---

## Goal

Make the Solid Results screen actually usable for follow-up analysis by porting the three overlays from the Ink TUI (insights drill-down, raw events timeline, ask-follow-up), and fix the terminal teardown so the shell doesn't leak Kitty keyboard escape sequences after the TUI exits.

Today's dry-run surfaced two pain points:

1. The Results screen's summary says `Insights available: LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree` but there is no way to open them. `ResultsOverlay = "insights" | "rawEvents" | "ask"` exists in `context/navigation.tsx` and `overlay()` / `setOverlay()` are already wired — but nothing drives them.
2. After `ctrl+c` / `ctrl+q`, the next keystroke in the shell prints raw Kitty-keyboard-protocol fragments (e.g. `7;5u` for `ctrl+k`). `CliRenderer.destroy()` is never called, so the alternate-screen + Kitty-keyboard mode we enabled on startup is not reset.

---

## Critical path (what the user gets)

1. **Clean exit** — `ctrl+q` on Main or `ctrl+c` anywhere triggers LC-2a's shutdown, which calls `CliRenderer.destroy()` before `process.exit`. No leftover escape codes in the parent shell.
2. **From Results, press `e`** → raw events timeline overlay opens on top of the report. `esc` dismisses.
3. **From Results, press `i`** → insights overlay opens with a list of trace insights. Arrow keys navigate, `enter` expands the selected insight's analysis, `esc` closes the detail, second `esc` dismisses the overlay.
4. **From Results, press `a`** → ask-follow-up panel opens with a text input and a history of prior Q&A for this report. User types a question, `enter` submits, answer streams back. `esc` dismisses.
5. **Modeline** — when on Results (no overlay), the modeline shows `/insights  /events  /ask` alongside the existing `/restart /save /copy` hints.

---

## Tasks

### TT-1: Terminal teardown fix

**Goal:** On `initiateShutdown()`, call `CliRenderer.destroy()` before `process.exit` so Kitty keyboard and alternate-screen modes reset.

**Files:**
- Modify `apps/cli-solid/src/tui.ts` — capture the renderer returned by `@opentui/solid`'s `render()` (or access it via `useRenderer()` inside a small bootstrap effect) and register a shutdown cleanup that calls `renderer.destroy()`.
- Modify `apps/cli-solid/src/context/runtime.tsx` OR create a dedicated `lifecycle/renderer-cleanup.ts` — register the `destroy()` call via `registerCleanupHandler()` from the LC-2a shutdown controller.

**Key design:** The renderer must be destroyed BEFORE `AtomRegistry.dispose()` so the terminal-write path is still live when the reset sequences are emitted. That means the renderer-destroy handler must be registered AFTER the registry-dispose handler, because LC-2a's shutdown runs handlers in reverse registration order.

Concrete approach (simpler than weaving through `tui.ts`):
- In `apps/cli-solid/src/context/runtime.tsx`, after `setAtomRegistry`, get the renderer via `useRenderer()` and register a cleanup that calls `renderer.destroy()`. Register it AFTER the registry-dispose handler so it runs FIRST during teardown.

Alternative (cleaner): Expose a tiny helper in `lifecycle/renderer-cleanup.ts`:

```ts
import type { CliRenderer } from "@opentui/core";
import { registerCleanupHandler } from "./shutdown";

export const registerRendererCleanup = (renderer: CliRenderer): (() => void) =>
  registerCleanupHandler(() => {
    renderer.destroy();
  });
```

Then call it once from a top-level Solid effect that has access to `useRenderer()`.

**Acceptance:** After `ctrl+q` or `ctrl+c`, the parent shell accepts `ctrl+k` (or any Kitty-disambiguated key) without printing `7;5u` / similar fragments. Manual verification only — cannot be unit-tested because it depends on real stdout.

**Blocked by:** nothing.

---

### OV-1a: Raw events overlay component

**Goal:** Read-only timeline of `ExecutedPerfPlan.events`, scrollable, rendered on top of the Results screen.

**Files:**
- Create `apps/cli-solid/src/renderables/overlay-container.tsx` — reusable wrapper with a dimmed background and centered panel (used by all three overlays). Accepts `title` and `children`.
- Create `apps/cli-solid/src/routes/results/raw-events-overlay.tsx` — reads `executedPlan.events`, renders each event as a row with timestamp, tag, and short summary. Up/down scrolls if the list exceeds visible height.

**Event rows:**
- `ToolCall` — `[HH:MM:SS] tool name  args`
- `ToolResult` — `[HH:MM:SS] ← name  Nb / tokens  OK|ERR`
- `StepStarted` / `StepCompleted` — `[HH:MM:SS] step N: title`
- `AgentText` / `AgentThinking` — `[HH:MM:SS] say/think  {truncated first line}`
- `RunFinished` — `[HH:MM:SS] finished status=...`

Reuse `formatToolCall` and `truncateSingleLine` from existing testing-helpers.

**Acceptance:** Component renders the events list. Scrolling works. No data fetching — reads from props. `pnpm typecheck` green.

**Blocked by:** nothing.

---

### OV-1b: Wire raw events overlay into Results

**Goal:** `e` on Results opens the overlay; `esc` dismisses.

**Files:**
- Modify `apps/cli-solid/src/routes/results/results-screen.tsx` — read `overlay()` from `useNavigation()`, render `<RawEventsOverlay>` when `overlay() === "rawEvents"`, pass `executedPlan`. Add `useKeyboard` handler that routes `esc` to `setOverlay(undefined)` when overlay is active.
- Modify `apps/cli-solid/src/commands/register-results.ts` — add `events` command with `keybind: "e"`, calls `setOverlay("rawEvents")`. Also update `register-global.ts` so the `esc` command is disabled when `overlay() !== undefined` (it already has this check — verify).

**Acceptance:** `e` opens, `esc` closes, underlying Results content still visible below / dimmed behind. `bun test` passes.

**Blocked by:** OV-1a.

---

### OV-2a: Insights overlay component

**Goal:** Two-mode overlay — list view of insight names, detail view with full analysis.

**Files:**
- Create `apps/cli-solid/src/routes/results/insights-overlay.tsx`

**Data source:** `PerfReport.insights` is a `readonly InsightReference[]` with `{ insightName, title, summary, ... }`. The detailed analysis lives in `PerfReport.insightDetails[]` with `{ insightName, title, summary, analysis, estimatedSavings, externalResources }`. Confirmed in `packages/shared/src/models.ts` lines 449 and 513.

**UX:**
- List mode: numbered list of `insightDetails`, arrow keys navigate, `enter` opens detail.
- Detail mode: shows `title`, `summary`, full `analysis` (scrollable if long), `estimatedSavings`, `externalResources` as clickable-looking URLs. `esc` returns to list.
- Top-level `esc` in list mode closes the overlay.

**Acceptance:** Both modes render. Navigation works. No external data fetching — all from props. `bun test` passes.

**Blocked by:** nothing (can run in parallel with OV-1a).

---

### OV-2b: Wire insights overlay into Results

**Goal:** `i` on Results opens the overlay.

**Files:**
- Modify `results-screen.tsx` — add `<InsightsOverlay>` match for `overlay() === "insights"`.
- Modify `register-results.ts` — add `insights` command with `keybind: "i"`.

**Acceptance:** `i` opens, nested esc handling works (detail → list → dismiss). `bun test` passes.

**Blocked by:** OV-2a.

---

### OV-3a: Ask-panel component (UI only)

**Goal:** The panel UI — text input at bottom, scrollable Q&A history above, pending/error states.

**Files:**
- Create `apps/cli-solid/src/routes/results/ask-panel.tsx`

**Props:**
- `history: readonly AskResult[]` — prior Q&A pairs
- `pending: boolean` — true while a question is in flight
- `error: string | undefined`
- `onSubmit: (question: string) => void`

Reuse the existing `Input` renderable for the text field. On submit, call `onSubmit(value)` and clear the input.

**Acceptance:** Component renders. Submit callback fires. No atom wiring yet. `bun test` passes.

**Blocked by:** nothing (parallel with OV-1a, OV-2a).

---

### OV-3b: `askReportFn` atom wiring

**Goal:** Make the existing `askReportFn` atom from `apps/cli/src/data/ask-report-atom.ts` available to the Solid TUI.

**Files:**
- Move `apps/cli/src/data/ask-report-atom.ts` to `packages/perf-agent-cli/src/data/ask-report-atom.ts` (co-located with `executeFn`, `recentReportsAtom`, etc.). If that package doesn't exist yet, put it in a new `packages/perf-agent-cli/ask-report.ts` — check import path conventions in the Solid TUI (`@neuve/perf-agent-cli/data/execution-atom`) to match.
- Update any Ink-side imports to point to the new location so the Ink app keeps compiling until P6 deletes it.

**Note:** This is purely a relocation. Zero behavior change. If the atom is already in a shared package, skip this and use it directly.

**Acceptance:** Both Ink and Solid import the atom without breakage. `pnpm typecheck` green across the monorepo.

**Blocked by:** nothing.

---

### OV-3c: Wire ask panel into Results

**Goal:** `a` on Results opens the panel, submitted question triggers `askReportFn`, answer streams back and renders.

**Files:**
- Modify `results-screen.tsx`:
  - Use `useAtom(askReportFn, { mode: "promiseExit" })` via the existing effect-atom adapter
  - Local signals for `history`, `pending`, `error`
  - On submit, push optimistic pending Q&A, trigger the atom, on success push answer into history
- Modify `register-results.ts` — add `ask` command with `keybind: "a"`.

**Acceptance:** User types a question, sees pending state, answer appears. Multiple questions accumulate in history within the same session. Errors render with a retry hint. `bun test` passes.

**Blocked by:** OV-3a, OV-3b.

---

### OV-4: Modeline hints for overlays

**Goal:** When on Results with no overlay, the modeline lists the overlay keys: `/insights /events /ask`.

**Files:**
- No changes needed if commands are registered with `hidden: false` — the modeline auto-picks up visible commands.

**Verification task:** confirm that `insights`, `events`, `ask` commands from OV-1b/2b/3c don't set `hidden: true`, so they show in the modeline automatically. Adjust naming if the current modeline gets too busy.

**Acceptance:** Visual verification during manual dry-run.

**Blocked by:** OV-1b, OV-2b, OV-3c.

---

## Parallel execution strategy

```
Wave 0 (single):    TT-1        (terminal teardown — unblocks clean dry-runs)
Wave 1 (parallel):  OV-1a, OV-2a, OV-3a, OV-3b    (self-contained components + atom relocation)
Wave 2 (parallel):  OV-1b, OV-2b, OV-3c           (wire into Results — all touch results-screen.tsx, must run sequentially per no-worktree rule)
Wave 3 (verify):    OV-4
```

**Correction on Wave 2**: OV-1b, OV-2b, and OV-3c all modify `results-screen.tsx` and `register-results.ts`. They cannot run in parallel on the same working tree. Run them sequentially in order: OV-1b → OV-2b → OV-3c.

Revised:

```
Wave 0:            TT-1
Wave 1 (parallel): OV-1a, OV-2a, OV-3a, OV-3b
Wave 2 (serial):   OV-1b → OV-2b → OV-3c
Wave 3:            OV-4
```

---

## Risks

1. **`renderer.destroy()` timing** — calling it before `AtomRegistry.dispose()` may break if any atom cleanup tries to render. Registering it as the first cleanup handler means it runs last in LC-2a's reverse-order sequence. Mitigation: test both orderings during TT-1 implementation.

2. **Overlay stacking** — the dialog stack (`DialogProvider`) in app.tsx owns `esc` routing. Overlays are NOT dialogs — they use `navigation.overlay()`. Verify the existing `useKeyboard` handler in `app.tsx` routes `esc` correctly when an overlay is active (the `options.overlay() === undefined` predicate in `register-global.ts:42` suggests it does — confirm during OV-1b).

3. **Ask atom streaming timing** — `askReportFn` streams and folds text. In Solid, we need to subscribe to the pending atom state to show the spinner, not just await the promise. The `mode: "promiseExit"` pattern the Ink TUI uses maps to our `atomFnToPromise` adapter — verify it handles in-flight state for Show-when gating.

4. **Large insight text wrapping** — `analysis` can be multi-kilobyte. OpenTUI `<text>` doesn't auto-wrap by default. The insights detail view must chunk content into lines before rendering, or use a scrollable container.

5. **`askReportFn` atom relocation (OV-3b)** — if the atom is tightly coupled to Ink-specific layers in its current location, moving it may cascade imports. Check before promising a clean relocation.

---

## Definition of done

- `ctrl+q` and `ctrl+c` leave the shell clean (no escape-code fragments).
- From Results: `e` opens events, `i` opens insights with drill-down, `a` opens ask-panel with streaming answers.
- Modeline lists all three overlay keys when on Results.
- All existing 559 cli-solid tests still pass.
- Manual dry-run walks through: run analysis → press `i` → expand insight → `esc` back → press `a` → ask "what slowed LCP?" → see answer → press `e` → browse events → `esc` → `ctrl+q` → shell is clean.

---

## After this lands

Move on to **P6 cutover** from the original plan: delete `apps/cli/` entirely, flip `perf-agent` binary exclusively to `cli-solid`, update CLAUDE.md references, remove `expect` remnants.
