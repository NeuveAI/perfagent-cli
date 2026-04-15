# Current Ink TUI — Feature & Pain-Point Inventory

_Audit date: 2026-04-15. Scope: `apps/cli/` (the Ink terminal UI that ships as `@neuve/perf-agent-cli`). This doc is descriptive; no rewrite shape is proposed here._

## 0. Top-level shape

- Entry: `apps/cli/src/program.tsx:16-40` renders `<App>` inside `RegistryProvider` (effect-atom) and `QueryClientProvider` (React Query). Writes the alt-screen sequence on start, flushes analytics on exit.
- `<App>` (`apps/cli/src/components/app.tsx:30`): owns the global keyboard layer, selects a screen from a `Data.TaggedEnum` (`Screen`), and always renders a `<Modeline>` strip at the bottom.
- Layout: a single `<Box flexDirection="column" width="100%" height={rows}>` with `<Box flexGrow={1}>{renderScreen()}</Box>` above `<Modeline>` (`app.tsx:170-175`).
- State sources coexist in four systems:
  1. **Zustand** stores under `apps/cli/src/stores/` — navigation, plan execution, global preferences, per-project preferences.
  2. **Effect Atom** under `apps/cli/src/data/` — agent provider, verbose flag, recent reports, execute/ask/saveFlow mutation fns.
  3. **React Query** under `apps/cli/src/hooks/` — git state, listening ports, remote branches, installed browsers, agents, models, update check, saved flows, detected projects.
  4. **Local component `useState`** — screen-internal UI (overlay open, highlights, scroll offsets, etc.).

## 1. Screens

All screens live under `apps/cli/src/components/screens/`. Entry points are in `app.tsx:117-167`. `esc` handling is routed from `app.tsx:86-88` (`screen !== "Main" && overlay === undefined`) into `goBack()` (`app.tsx:45-66`), unless a screen intercepts `key.escape` in its own `useInput`.

### 1.1 Main (`main-menu-screen.tsx`, 380 LOC)

- **Props:** `gitState: GitState | undefined` (`main-menu-screen.tsx:32-34`).
- **Owns:** prompt input, `@`-context picker, flow suggestions, history scrollback, "Last run" banner, "Changes detected" banner.
- **Entry points:** default screen via `Screen.Main()` in `app.tsx:166`.
- **Exit:** `enter` submits to `CookieSyncConfirm`/`PortPicker`/`Testing` through `screenForTestingOrPortPicker` (`main-menu-screen.tsx:124-161`, `use-navigation.ts:40-50`). Never observes `esc` (the app-level guard ignores `esc` on Main — see `app.tsx:86`).
- **Key handlers (local):** `useInput` at `main-menu-screen.tsx:176-254` — `ctrl+k` toggles cookies, `tab` accepts a suggestion, `↑/↓` navigates instruction history (single-line only), `→/←` cycles suggestions, picker mode owns its own `↑/↓/ctrl+n/p/enter/tab/backspace` subset.
- **Overlays hosted:** the `@`-context picker (`ContextPicker`) rendered inside a `RuledBox` (`main-menu-screen.tsx:353-367`).
- **Pain points:**
  - Banner renders `<Text color={... ? COLORS.GREEN : COLORS.RED}>` and `{... ? figures.tick : figures.cross}` — JSX-attr ternaries in `main-menu-screen.tsx:269-270`, flagged in task-62-review-1.md finding "[MAJOR] JSX ternaries".
  - Same file hosts a `hostPathFromUrl` helper at `:38-44` that duplicates `recent-reports-picker-screen.tsx:24-31` (`formatManifestUrl`) and `packages/supervisor/src/report-storage.ts:98-104` (`safeHostPath`). Flagged as `[MINOR] Duplicated helper logic` in the review.
  - IIFE `(() => { ... })()` inside JSX at `main-menu-screen.tsx:285-308` to compute banner stats — inline side-computation hides logic.
  - Instruction-history navigation only works on single-line input (`main-menu-screen.tsx:171`, `:212-219`), silently inert while multi-line.
  - Manual `AsyncResult.isSuccess(recentReportsResult) && recentReportsResult.value.length > 0` to derive `latestManifest` (`main-menu-screen.tsx:49-53`). Not a builder — contradicts CLAUDE.md `AsyncResult.builder` rule.

### 1.2 Testing (`testing-screen.tsx`, 866 LOC)

- **Props:** `changesFor, instruction, savedFlow?, cookieBrowserKeys?, baseUrls?, devServerHints?` (`testing-screen.tsx:44-51`).
- **Owns:** live execution stream, agent tool-call rendering, expanded scroll view, cancel confirmation.
- **Entry:** from `Main → PortPicker → Testing` or `Main → CookieSyncConfirm → Testing` or direct via `screenForTestingOrPortPicker` when a URL is inferred (`use-navigation.ts:47-50`).
- **Exit:** on execution complete, auto-redirects to `Results` (`testing-screen.tsx:615-620`). `esc` opens a cancel-confirmation (`testing-screen.tsx:671-686`), `enter`/`y` stops the run, `n`/`esc` dismisses. `ctrl+o` toggles expanded, `ctrl+n` toggles notifications.
- **Overlays hosted:** inline cancel-confirmation pseudo-modal (`testing-screen.tsx:838-845`); `expanded` mode that replaces the tool feed with a scrollable "all steps + all tools" list driven by `useScrollableList` (`testing-screen.tsx:547-560, 689-718`).
- **Pain points:**
  - Flat "expanded rows" are reconstructed from scratch on every event update because `expandedRows` is a plain local `React.ReactElement[]` recomputed per render (`testing-screen.tsx:455-545`). React Compiler doesn't memoize across event batches; every stream update re-walks the events.
  - `collectToolCalls`/`markLastCallRunning`/`findStepEventRange` are local helpers that re-scan the full event list per render (`testing-screen.tsx:178-285`). 60+ LOC of pure event-walking embedded in a view.
  - Two near-identical rendering paths: the collapsed steps list (`testing-screen.tsx:746-833`) and the expanded rows builder (`testing-screen.tsx:455-545`) both repeat four branches (active/passed/failed/skipped/default). 100+ LOC duplicated.
  - `parseRawInput` uses `as Record<string, unknown>` cast at `:90, :95` — a direct `no type casts (as)` violation.
  - Elapsed-time interval runs at 1s (`TESTING_TIMER_UPDATE_INTERVAL_MS`) and triggers a re-render of the whole stream tree (`testing-screen.tsx:627-634`).
  - `screenshotPathsAtom` is flagged as `HACK: atom is read by testing-screen.tsx but never populated` (`execution-atom.ts:32-33`). Dead reactive wiring.

### 1.3 Watch (`watch-screen.tsx`, 383 LOC)

- **Props:** `changesFor, instruction, cookieBrowserKeys?, baseUrl?` (`watch-screen.tsx:28-33`).
- **Owns:** file-watcher lifecycle, per-run step rendering, idle-spinner cycling, last-run summary, stop-confirmation.
- **Entry:** `ctrl+w` from Main (`app.tsx:98-106`, gated on `gitState.isGitRepo`).
- **Exit:** `esc` opens stop-confirmation; `enter`/`y` kills the fiber and returns to Main. `ctrl+n` toggles notifications.
- **Overlays hosted:** inline stop-confirmation (`watch-screen.tsx:373-380`).
- **Pain points:**
  - Four redundant status-icon branches duplicated from Testing (`watch-screen.tsx:286-361`).
  - `phase` is a string union `"polling" | "settling" | "assessing" | "running" | "idle" | "error"` — not a tagged union; phase-label derived from a nested IIFE `phaseLabel = (() => { switch ... })()` at `:210-225`.
  - Runs `layerCli` a second time under the hook via `Effect.runFork(program.pipe(Effect.provide(layerCli(...))))` at `:128-141` — this is the pattern CLAUDE.md flags as "don't use `ManagedRuntime` when you are already inside Effect code" (we're outside Effect here, but it means the watch-run boots its own layer stack separate from `cliAtomRuntime`).
  - No way to see the full per-run result — on `RunCompleted`, we collapse back to an idle spinner with a "Last: passed/failed" chip. Cannot open the `PerfReport` the run produced.

### 1.4 Results (`results-screen.tsx`, **1691 LOC — largest file**)

- **Props:** `report: PerfReport, videoUrl?: string` (`results-screen.tsx:44-47`).
- **Owns:** copy-to-clipboard, restart run, save flow, post-to-PR, insight drill-in, raw-events drill-in, console/network toggles, ask-panel.
- **Entry:** auto-redirect from `Testing` (`testing-screen.tsx:615-620`), explicit selection from `RecentReportsPicker` (`recent-reports-picker-screen.tsx:62-66`).
- **Exit:** `esc` via app-level → `goBack()` clears executed plan (`app.tsx:54-58`) and returns to Main. When an overlay is open, that overlay's `esc` handler closes the overlay first (see §2).
- **Overlays hosted:** insight drill-in (`i`), raw-events drill-in (`ctrl+o`), ask panel (`a`), inline console/network expanders (`c`, `n`).
- **Key handlers (local):** `useInput` at `results-screen.tsx:188-292` — `y` copy, `p` post PR (guarded on `Option.isSome(report.pullRequest)`), `s` save flow, `r` restart, `a` ask, `c` console, `n` network, `i` insights, `ctrl+o` raw events. When `askOpen`/`showRawEvents`/`showInsights`, the handler short-circuits and only services the overlay keys.
- **Pain points:**
  - 1691 LOC. Hosts ~15 subcomponents: `PerfMetricsTable`, `PerfMetricsTableSnapshot`, `PerfMetricsTableRow`, `TraceInsightsList`, `RegressionsPanel`, `RegressionRow`, `ConsoleCapturesPanel`, `ConsoleCaptureBlock`, `ConsoleEntryRow`, `NetworkCapturesPanel`, `NetworkCaptureBlock`, `NetworkRequestRow`, `InsightDetailsPanel`, `RawEventsView`, `AskPanel`, `AskHistoryEntryView`. These are all inlined.
  - Overlay open-state is duplicated across three `useState` flags (`showInsights`, `showRawEvents`, `askOpen` at `:56-64`) AND the Zustand navigation store's `overlay: ResultsOverlay | undefined` (`use-navigation.ts:55, 60`). Each `open*` helper writes both (`results-screen.tsx:70-120`). Flagged by the review as unauthorized scope creep in task-62 (`task-62-review-1.md:35`) — the refactor was bundled into the recent-reports task without permission.
  - `RawEventsView` early-returns the entire screen at `:303-316`, replacing the main content with `<RawEventsView>`. `InsightDetailsPanel` and `AskPanel` render inline and scroll alongside the report body.
  - Derived `hasRawEvents` is computed twice, once in `results-screen.tsx:180-186` and again in `modeline.tsx:146-159` — both walk `report.events`/`consoleCaptures`/`networkCaptures`. If the walks disagree, the `ctrl+o` hint and the `ctrl+o` gate can drift. This is the "hints drift from keybindings" class of bug (§6).
  - Raw-events and insights share a `RawLine[]` lines array (`:1220-1229, :1078-1085, :1265-1269`) — every render re-builds the line array, re-wraps text, and re-slices. No memoization.
  - Insight row keys are `` `insight-row-${index}` `` (`:1119`), raw row keys are `` `raw-row-${index}` `` (`:1312`). These stable-by-position keys caused a reported flicker bug — commit `02da3111 feat(cli): harden RawEventsView against scroll crashes with error boundary and defensive guards` shipped an `<ErrorBoundary>` wrap (`:304`) as the workaround.
  - `formatToolInput` does `try { JSON.parse }` (`:1557-1574`) — a raw `try/catch`, contra CLAUDE.md "avoid try/catch".
  - Ask panel streams an agent response but cannot be cancelled; the commit message for `bff1522d` explicitly notes "Follow-ups deferred: cancel-on-esc for in-flight streams, scroll inside answer history, in-situ error surface".
  - Status bar at `:142-150` uses a `{ text: string; color: string }` local state for one-shot copy feedback; no timeout to clear it, stays on screen until any other keypress triggers a re-render.
  - JSX ternary `isFailed ? COLORS.RED : isSkipped ? COLORS.YELLOW : COLORS.GREEN` at `results-screen.tsx:408-409` — nested ternaries, CLAUDE.md violation.

### 1.5 SavedFlowPicker (`saved-flow-picker-screen.tsx`, 141 LOC)

- **Props:** none.
- **Owns:** scrollable list of saved flows from `useSavedFlows()`, selection → `screenForTestingOrPortPicker`.
- **Entry:** `ctrl+r` on Main (`app.tsx:92-94`).
- **Exit:** `esc` → `Screen.Main()` (`saved-flow-picker-screen.tsx:78-80`); `enter` selects and navigates.
- **Pain points:**
  - Uses React Query (`useSavedFlows`) but invalidation only happens manually. After `saveFlowFn` fires on Results, `["saved-flows"]` is never invalidated — stale list until restart. Same class as the recent-reports stale-atom bug (§4).
  - Bumps up against the "never uses `AsyncResult.builder`" rule only softly because it uses React Query, not atoms.

### 1.6 RecentReportsPicker (`recent-reports-picker-screen.tsx`, 164 LOC — new this round)

- **Props:** none.
- **Owns:** list of `ReportManifest[]` from `recentReportsAtom`, selection → `loadReportFn` → `Screen.Results({ report })`.
- **Entry:** `ctrl+f` on Main, **gated on `hasRecentReports`** (`app.tsx:95-97`).
- **Exit:** `esc` → `Screen.Main()` (`recent-reports-picker-screen.tsx:79-81`); `enter` triggers load mutation, on success navigates to Results.
- **Pain points (from task-62-review-1.md):**
  - `recentReportsAtom` is read-once (`apps/cli/src/data/recent-reports-atom.ts:8-19`). `execute-atom.ts:102` saves a new report but never invalidates the atom. First-ever run never exposes the `ctrl+f` affordance until restart (`task-62-review-1.md:39`).
  - JSX ternary at `:89` (plural suffix), `:119-120` (status icon/color), `:130-131, :133` (pointer/text color) — direct CLAUDE.md violations called out in review.
  - Manual `AsyncResult.isSuccess(reportsResult) ? .value : []` + `!AsyncResult.isSuccess(...)` + `AsyncResult.isFailure(loadResult) ? .cause : undefined` at `:40-43` — violates "Always use `AsyncResult.builder(...)`".
  - Error fallback renders the generic string "Failed to open report. Choose another or press esc." (`:159`) — the actual `loadFailure` cause is discarded (`task-62-review-1.md:47`).
  - Magic numbers live at file top (`:17-22`) instead of `constants.ts` (review `[MINOR] Magic numbers in component files`).

### 1.7 PortPicker (`port-picker-screen.tsx`, 441 LOC)

- **Props:** `changesFor, instruction, savedFlow?, cookieBrowserKeys?` (`:17-22`).
- **Owns:** multi-select listening-ports list (`useListeningPorts`), detected-projects list (`useDetectedProjects`), custom-URL inline input, search bar, skip option.
- **Entry:** from `Main` when no URL in instruction and no CLI base URL and no selected cookie sync (`use-navigation.ts:47-50`). From `CookieSyncConfirm` via `screenForTestingOrPortPicker` (`cookie-sync-confirm-screen.tsx:74-82`).
- **Exit:** `esc` via app-level → Main. `enter` confirms selection → `Testing` with `baseUrls` + `devServerHints` (`:150-180`). `/` toggles search, `space` toggles a port, `n` clears selection (absent — actually only in `CookieSyncConfirm`).
- **Pain points:**
  - Three overlapping "modes" tracked as separate booleans (`isSearching`, `isEnteringCustomUrl`, and the implicit "navigating list" mode). The `useInput` handler at `:261-301` branches through them sequentially. No unified state machine.
  - `isPortOrUrl` helper at `:43-60` does fragile regex port extraction; doesn't handle IPv6 or HTTPS with `://[::1]:3000`.
  - Default seed set for `selectedPorts` reads from `lastBaseUrl` via ad-hoc regex (`:88-93`).

### 1.8 CookieSyncConfirm (`cookie-sync-confirm-screen.tsx`, 180 LOC)

- **Props:** `changesFor?, instruction?, savedFlow?` (`:17-21`).
- **Owns:** list of `DetectedBrowser[]` from `useInstalledBrowsers`, checkbox-multi-select, default-browser auto-seed.
- **Entry:** from Main (`main-menu-screen.tsx:159` when no URL/cookies/baseUrls) or from `ctrl+k` on Main when cookies are empty (`main-menu-screen.tsx:221-230`).
- **Exit:** `esc` → Main. `enter` → `screenForTestingOrPortPicker` with selected keys (`:61-86`). `space` toggles, `a` select-all, `n` clears.
- **Pain points:**
  - Keybinding `n` clears the selection (`:109-111`) — no visible affordance for this in the modeline; "silent no-op"-adjacent bug class (user doesn't know they can press `n`). Modeline only lists `↑↓, space, a, esc, enter` (`modeline.tsx:84-91`).
  - `defaultsInitialized = useRef(false)` pattern at `:35` to seed default browsers once; brittle if the browsers list changes mid-render.

### 1.9 SelectPr (`pr-picker-screen.tsx`, 229 LOC)

- **Props:** none.
- **Owns:** `useRemoteBranches()` result, filter (`recent/all/open/draft/merged/no-pr`), search, checkout confirmation modal.
- **Entry:** `ctrl+p` on Main (`app.tsx:89-91`, gated on `gitState.isGitRepo`).
- **Exit:** `esc` → Main. `enter` checks out selected branch via `checkoutBranch` and returns to Main; on failure surfaces `checkoutError` inline.
- **Pain points:**
  - Two `useInput` handlers — one primary (`:79-103`), one guarded by `isActive: confirmBranch !== null` (`:105-118`). Order matters; split feels accidental.
  - Uses JSX ternaries: `{isActive ? \`[${filter}]\` : filter}` (`:142-145`), PR-status color ternaries `branch.prStatus === "open" ? COLORS.GREEN : branch.prStatus === "merged" ? COLORS.PURPLE : COLORS.DIM` (`:186-193`). CLAUDE.md violations.
  - `confirmBranch !== null` — use of `null` contra CLAUDE.md "never use null". Also `filteredBranches[highlightedIndex]` can be `undefined`, but the guard is inconsistent with the stated style of `Option`/`undefined`.
  - JSX ternary `{checkoutError ? (...) : null}` and `{confirmBranch ? (...) : null}` at `:206, :212`.

### 1.10 AgentPicker (`agent-picker-screen.tsx`, 245 LOC)

- **Props:** none.
- **Owns:** agent list (`useAvailableAgents`), model list (`useConfigOptions`), selection writes `agentProviderAtom` + `usePreferencesStore.setAgentBackend`/`setModelPreference`.
- **Entry:** `ctrl+a` on Main (`app.tsx:107-109`).
- **Exit:** `esc` → Main. `enter` commits and → Main.
- **Pain points:**
  - Skip-disabled-rows navigation is hand-rolled in `useInput` (`:161-172`), not inside `useScrollableList` — inconsistent with every other list screen.
  - Nested ternary for row color: `item.isDisabled ? COLORS.DIM : isHighlighted ? COLORS.PRIMARY : COLORS.TEXT` (`:221-225`). CLAUDE.md violation.
  - Model list is flattened from `select` options with group support via `getModelOptions` at `:33-44` — there's no group-header rendering; groups are silently collapsed into a flat list.

## 2. Overlays

The term "overlay" refers to per-screen drill-in views that want to intercept `esc` before the app-level `esc→goBack` handler fires. The navigation store exposes:

```ts
// use-navigation.ts:55
export type ResultsOverlay = "insights" | "rawEvents" | "ask";

// use-navigation.ts:57-64
overlay: ResultsOverlay | undefined;
setOverlay: (overlay: ResultsOverlay | undefined) => void;
```

Gate in `app.tsx:86`:

```ts
if (key.escape && screen._tag !== "Main" && overlay === undefined) {
  goBack();
}
```

### 2.1 Insights drill-in (`i` on Results)

- **Gate:** `hasInsightDetails` (`results-screen.tsx:179, :287-291`).
- **`esc` capture:** local `useInput` at `:228-230` short-circuits when `showInsights` is true and calls `closeInsights()` — which clears BOTH the local `showInsights` boolean AND the store's `overlay`.
- **Modeline:** `modeline.tsx:117-124` switches to `[↑↓ scroll, pgup/pgdn page, i close, esc close]` based on `overlay === "insights"`.
- **Known quirks:**
  - Scroll offset is clamped per render (`results-screen.tsx:1084`). Rapid keypresses reset to origin when `details` array re-slices (no memo on `buildInsightPanelLines`).
  - `InsightDetailsPanel` still renders its inline header above the scroll region (`:1091-1100`) — the drill-in is not truly modal; the underlying report body keeps rendering.

### 2.2 Raw-events drill-in (`ctrl+o` on Results)

- **Gate:** `hasRawEvents = hasConsole || hasNetwork || hasInsightDetails || hasToolEvents` (`results-screen.tsx:186`).
- **`esc` capture:** local `useInput` at `:200-203` returns early when `showRawEvents` is true.
- **Early-return pattern:** `results-screen.tsx:303-316` returns `<ErrorBoundary label="Raw-events view"><RawEventsView .../></ErrorBoundary>` instead of the main report, making this the only drill-in that hides the report body (the rest overlay inline).
- **Modeline:** `modeline.tsx:125-131` switches to `[↑↓ scroll, pgup/pgdn page, ctrl+o close, esc close]`.
- **Known quirks:**
  - The `ErrorBoundary` wrap was added after a scroll-crash bug (commit `02da3111 feat(cli): harden RawEventsView against scroll crashes`). Root cause (unstable keys + stale offsets) is masked, not fixed.
  - The raw view re-builds the full line array on every keypress (`:1256-1263`).

### 2.3 Ask panel (`a` on Results)

- **Gate:** always available on Results (`results-screen.tsx:274-278`).
- **`esc` capture:** local `useInput` at `:191-197` — when `askOpen`, only `esc` is handled (close).
- **Modeline:** `modeline.tsx:133-138` switches to `[enter submit, esc close]`.
- **Known quirks:**
  - Agent stream cannot be cancelled (author's own commit note on `bff1522d`). Pressing `esc` closes the visual input but the fiber keeps running.
  - `askHistory` is component-local (`:65`). Navigating away loses the whole Q&A.
  - No scroll within answer history — answers accumulate and push the report body off-screen.

### 2.4 Why this `overlay: ResultsOverlay | undefined` exists

Per `task-62-review-1.md:35`, the "[MAJOR] Unauthorized scope creep" entry documents that this field was introduced during task-62 to fix a real bug: before, `esc` closed the overlay AND popped the screen back to Main in a single keystroke because only the app-level handler consumed `esc`. The store now gates the app-level handler so overlay-local handlers get first dibs. The review's complaint is that it was bundled in without permission, not that the design is wrong.

## 3. Keybinding matrix

### 3.1 App-level (`apps/cli/src/components/app.tsx:74-110`)

| Key | Gate | Action | Modeline affordance |
|---|---|---|---|
| `ctrl+l` | always | `clearInkDisplay()` + force re-render | **none** (silent) |
| `ctrl+u` | `updateAvailable` | exit + `runUpdateCommand(latestVersion)` | yes, right-aligned keybind when update available (`modeline.tsx:193-203`) |
| `esc` | `screen !== "Main" && overlay === undefined` | `goBack()` | yes, per-screen |
| `ctrl+p` | `screen === "Main" && gitState.isGitRepo` | → SelectPr | yes (`modeline.tsx:54`) |
| `ctrl+r` | `screen === "Main"` | → SavedFlowPicker | yes (`modeline.tsx:47`) |
| `ctrl+f` | `screen === "Main" && hasRecentReports` | → RecentReportsPicker | yes, guarded identically (`modeline.tsx:49-51`) |
| `ctrl+w` | `screen === "Main" && gitState.isGitRepo` | → Watch | yes (`modeline.tsx:53`) |
| `ctrl+a` | `screen === "Main"` | → AgentPicker | yes (`modeline.tsx:40`) |

**Silent app-level keys:** `ctrl+l` has no modeline hint anywhere. Not necessarily a bug (refresh is a reveal-the-trick-for-power-users kind of binding), but worth noting.

### 3.2 Main (`main-menu-screen.tsx:176-254`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `ctrl+k` | always on Main | toggle cookies sync (clear if set, else → CookieSyncConfirm) | yes (`modeline.tsx:42-46`) |
| `tab` | `showSuggestion && currentSuggestion` | accept suggestion | partial — placeholder shows `[tab]` (`:342`), not in modeline |
| `↑/↓` (single-line only) | `instructionHistory.length > 0` | instruction history back/forward | **no** modeline hint |
| `↑/↓` (picker open) | `picker.pickerOpen` | navigate filtered context options | **no** modeline hint |
| `ctrl+n/ctrl+p` (picker open) | picker open | same as `↑/↓` | no |
| `→/←` | `showSuggestion` | cycle flow suggestions | conditional: `showCycleHint` gates a line of text (`:350`), not a modeline hint |
| `@` (trigger char) | empty input | opens context picker | inline hint `"@ add context"` at `:370-372` |
| `enter` | always | submit prompt | implicit |

**Silent-no-op risks:** the instruction-history `↑/↓` only fires on single-line input (`isSingleLine = !value.includes("\n")` at `:171`); users who pasted multi-line input lose the affordance without explanation.

### 3.3 Results (`results-screen.tsx:188-292`)

Normal mode:

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `y` | always | copy report to clipboard | yes (`modeline.tsx:139`) |
| `p` | `Option.isSome(report.pullRequest)` | post PR comment | yes, guarded (`modeline.tsx:140-142`) |
| `s` | always | save flow | yes (`modeline.tsx:143`) |
| `r` | always | restart flow | yes (`modeline.tsx:144`) |
| `a` | always | open ask panel | yes (`modeline.tsx:145`) |
| `c` | `hasConsoleCaptures` | toggle console expander | yes, guarded (`modeline.tsx:160-162`) |
| `n` | `hasNetworkCaptures` | toggle network expander | yes, guarded (`modeline.tsx:163-165`) |
| `i` | `hasInsightDetails` | open insights overlay | yes, guarded (`modeline.tsx:166-168`) |
| `ctrl+o` | `hasRawEvents` | open raw-events overlay | yes, guarded (`modeline.tsx:169-171`) |

The gates are re-computed independently in the screen and in the modeline — §6 explains the drift risk.

In overlays (`askOpen`/`showRawEvents`/`showInsights`) the handler short-circuits (`:191-197`, `:199-225`, `:227-253`).

### 3.4 Testing (`testing-screen.tsx:636-687`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `ctrl+o` | always | toggle expanded | yes (`modeline.tsx:105`) |
| `ctrl+n` | always | toggle notifications | yes (`modeline.tsx:104`) |
| `↑/↓/j/k/pgup/pgdn/ctrl+u/ctrl+d` | `expanded` | scroll via `useScrollableList.handleNavigation` | **no** modeline hint in expanded mode |
| `esc` | `isExecuting` | open cancel confirmation | yes (`modeline.tsx:106`, shows `"esc collapse"` or `"cancel"`) |
| `esc` | after failure | go to main | yes (same) |
| `enter`/`y` | `showCancelConfirmation` | stop run | inline text `:840-843` |
| `esc`/`n` | `showCancelConfirmation` | dismiss | inline text |

### 3.5 Watch (`watch-screen.tsx:184-205`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `ctrl+n` | always | toggle notifications | yes (`modeline.tsx:112`) |
| `esc` | always | open stop-confirmation | yes (`modeline.tsx:113`) |
| `enter`/`y` | `showStopConfirmation` | stop and go to Main | inline text `:374-378` |
| `esc`/`n` | `showStopConfirmation` | dismiss | inline text |

### 3.6 CookieSyncConfirm (`cookie-sync-confirm-screen.tsx:88-120`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k/ctrl+n/ctrl+p` | not `isLoading` | navigate | yes (`modeline.tsx:86`) |
| `space` | `itemCount > 0` | toggle current browser | yes (`modeline.tsx:87`) |
| `a` | always | select all | yes (`modeline.tsx:88`) |
| `n` | always | clear selection | **no** modeline affordance — **silent** |
| `enter` | always | confirm → next screen | yes (`modeline.tsx:90`) |
| `esc` | always | → Main | yes (`modeline.tsx:89`) |

### 3.7 PortPicker (`port-picker-screen.tsx:261-301`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k/ctrl+n/ctrl+p` | not searching/custom | navigate | yes |
| `/` | not searching/custom | enter search | yes (`modeline.tsx:96`) |
| `space` | not searching | toggle current port / open custom URL input | yes (`modeline.tsx:95`) |
| `enter` | not searching | confirm selection | yes |
| `esc` | in search | exit search mode | inline |
| `esc` | in custom URL | cancel custom URL | inline |
| `esc` | at top level | app-level → Main | yes |

### 3.8 RecentReportsPicker (`recent-reports-picker-screen.tsx:69-82`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k` | not loading | navigate | yes (`modeline.tsx:73-77`) |
| `enter` | not loading | load + → Results | yes |
| `esc` | always | → Main | yes |

### 3.9 SelectPr (`pr-picker-screen.tsx:79-118`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k/ctrl+n/ctrl+p` | not searching | navigate | yes |
| `→/←` | not searching | cycle filter (recent/all/open/draft/merged/no-pr) | yes (`modeline.tsx:61`) |
| `/` | not searching | open search | yes (`modeline.tsx:62`) |
| `enter` | not searching | checkout | yes |
| `y` | `confirmBranch != null` | confirm checkout | inline only |
| `n`/`esc` | `confirmBranch != null` | dismiss | inline only |

### 3.10 AgentPicker (`agent-picker-screen.tsx:157-182`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k/ctrl+n/ctrl+p` | always | navigate (skipping disabled) | yes |
| `enter` | always | select | yes |
| `esc` | always | → Main | yes |

### 3.11 SavedFlowPicker (`saved-flow-picker-screen.tsx:67-81`)

| Key | Gate | Action | Affordance |
|---|---|---|---|
| `↑/↓/j/k/ctrl+n/ctrl+p` | always | navigate | yes |
| `enter` | always | select | yes |
| `esc` | always | → Main | yes |

### 3.12 Silent no-op / undocumented bindings (summary)

- `ctrl+l` (app level, clear screen) — no affordance anywhere. Low-risk.
- `n` on CookieSyncConfirm (clear selection) — no affordance. Medium-risk, user-facing.
- Instruction-history `↑/↓` on Main — only fires when `value` has no `\n`. Silent when multi-line.
- Scroll keys in Testing expanded mode — no modeline change. Hidden.
- Tool-call counters / plan details in Testing — no way to drill into a finished tool call; data is there but no key is bound.

## 4. Data layer

### 4.1 Zustand stores (`apps/cli/src/stores/`)

| Store | LOC | Fields | Lifecycle | Refresh? |
|---|---|---|---|---|
| `use-navigation.ts` | 74 | `screen`, `previousScreen`, `overlay` | Process-scoped (no persistence) | Mutable via `setScreen`/`navigateTo`/`setOverlay`. |
| `use-plan-execution-store.ts` | 18 | `executedPlan`, `expanded` | Process-scoped | `setExecutedPlan(undefined)` is called manually on every back-navigation from Results (`app.tsx:55`, `results-screen.tsx:161`, `testing-screen.tsx:623`). |
| `use-preferences.ts` | 80 | `agentBackend`, `verbose`, `browserMode`, `browserHeaded`, `browserProfile`, `cdpUrl`, `autoSaveFlows`, `notifications`, `instructionHistory`, `modelPreferences`, `cliBaseUrls` | Persisted via `zustand/middleware/persist` keyed `prompt-history` backed by supervisor storage (`:69-78`). Only `agentBackend`, `instructionHistory`, `notifications`, `modelPreferences` are serialized (`partialize` at `:72-77`). | Atomic setters; no invalidation. |
| `use-project-preferences.ts` | 35 | `browserMode`, `cookieBrowserKeys`, `lastBaseUrl` | Persisted via supervisor `projectPreferencesStorage` keyed per-repo | Atomic setters. |

### 4.2 Effect Atoms (`apps/cli/src/data/`)

| Atom | Shape | LOC | Refresh semantics |
|---|---|---|---|
| `runtime.ts` / `agentProviderAtom` | `Atom.make<Option<AgentBackend>>(Option.none())` | 15 | Mutated by `useAtomSet` in `app.tsx:41-43` and `agent-picker-screen.tsx:145` |
| `runtime.ts` / `verboseAtom` | `Atom.make(false)` | — | Seeded in `program.tsx:27`; no refresh |
| `runtime.ts` / `cliAtomRuntime` | `Atom.runtime(...).pipe(Atom.keepAlive)` | — | Constructed from `layerCli({ verbose, agent })` on first access; `keepAlive` retains it across screens |
| `recent-reports-atom.ts` / `recentReportsAtom` | `cliAtomRuntime.atom(listManifests)` | 39 | **Read once, never invalidates.** `execution-atom.ts:102` saves reports but doesn't notify. Known bug — `task-62-review-1.md:39`. |
| `recent-reports-atom.ts` / `loadReportFn` | `cliAtomRuntime.fn` returning `PerfReport` | — | Triggered by user `enter` on picker |
| `execution-atom.ts` / `screenshotPathsAtom` | `Atom.make<readonly string[]>([])` | 161 | **Dead** — never populated (`:32-33` HACK comment) |
| `execution-atom.ts` / `executeFn` | `cliAtomRuntime.fn<ExecuteInput>()` | — | One shot per Testing-screen mount; interrupted via `Atom.Interrupt` on unmount (`testing-screen.tsx:593-595`) |
| `ask-report-atom.ts` / `askReportFn` | `cliAtomRuntime.fn` returning `AskResult` | 262 | One shot per submit; no cancellation plumbing |
| `flow-storage-atom.ts` / `saveFlowFn` | `cliAtomRuntime.fn` returning `SavedFlow` | 22 | One shot; no invalidation of `useSavedFlows` React Query cache or related atom |
| `config-options.ts` / `agentConfigOptionsAtom` | `Atom.make<Record<AgentBackend, AcpConfigOption[]>>` | 15 | Seeded from `useConfigOptions` hook in `agent-picker-screen.tsx:72-79`; also mutated via `executeFn.onConfigOptions` callback (`testing-screen.tsx:585-590`) |
| `github-mutations.ts` / `usePostPrComment` | React Query mutation (not an atom) | 17 | — |

**Atoms that never refresh after mutation:** `recentReportsAtom` (see above). This is the single biggest data-consistency bug identified in the most recent review round.

### 4.3 React Query hooks (`apps/cli/src/hooks/`)

| Hook | Key | Stale / refetch | Invalidation |
|---|---|---|---|
| `use-git-state.ts` | `["git-state"]` | No explicit stale time | `queryClient.invalidateQueries({ queryKey: ["git-state"] })` after branch checkout (`main-menu-screen.tsx:140`, `pr-picker-screen.tsx:63`) |
| `use-listening-ports.ts` | `["listening-ports"]` | `refetchInterval: 5000` (`LISTENING_PORTS_REFETCH_INTERVAL_MS`) | Polled |
| `use-detected-projects.ts` | `["detected-projects"]` | `staleTime: Infinity` | Never refreshes |
| `use-remote-branches.ts` | `["remote-branches"]` | Default | No explicit invalidation |
| `use-installed-browsers.ts` | `["installed-browsers"]` | Default | No explicit invalidation |
| `use-available-agents.ts` | `["available-agents"]` | `staleTime: 30_000` | No invalidation |
| `use-config-options.ts` | `["config-options", agent]` | `staleTime: 60_000`, `retry: false` | No invalidation |
| `use-update-check.ts` | `["update-check"]` | `staleTime: 3_600_000`, `retry: false`, `refetchOnWindowFocus: false` | Never |
| `use-saved-flows.ts` | `["saved-flows"]` | Default | **Never invalidated after `saveFlowFn`** — parallel stale-read bug to `recentReportsAtom` |
| `use-mount-effect.ts` | — | Utility only (one-shot effect) | — |
| `use-scrollable-list.ts` | — | Utility only | — |
| `use-stdout-dimensions.ts` | — | Utility only | — |
| `use-context-picker.ts` | — | Composite hook wrapping Query + local state | — |

### 4.4 Cross-cutting concerns

- Three state systems (Zustand, Atom, Query) describing overlapping concerns. Example: `agentBackend` lives in both `usePreferencesStore.agentBackend` AND `agentProviderAtom`; `useEffect` in `app.tsx:41-43` mirrors one to the other. Drift is possible if one write path skips the other.
- Every Atom function re-provides `NodeServices.layer` separately (`ask-report-atom.ts:260`, `recent-reports-atom.ts:17`, `flow-storage-atom.ts:20`, `execution-atom.ts:159`) even though `cliAtomRuntime` already builds a layer via `layerCli`. Smell.
- `usePlanExecutionStore.setExecutedPlan(undefined)` is called in three places on back-navigation. A rewrite should bind this to screen leave automatically.

## 5. Rendering patterns — virtual lists

Every scrollable list in the app is built on top of `useScrollableList` (`apps/cli/src/hooks/use-scrollable-list.ts`, 53 LOC) + manual `.slice(scrollOffset, scrollOffset + visibleCount)` at the render site.

**`useScrollableList` API:**
```ts
// :17-53
const { highlightedIndex, setHighlightedIndex, scrollOffset, handleNavigation } =
  useScrollableList({ itemCount, visibleCount, initialIndex });
```
- `scrollOffset` auto-centers the highlight within `visibleCount` (`:30-35`).
- `handleNavigation(input, key)` consumes `↓/j/ctrl+n` and `↑/k/ctrl+p`; returns `true` if it handled the key.
- Contains `useCallback` and `useMemo` — violates the React Compiler rule in CLAUDE.md.

**Call sites:**
- `testing-screen.tsx:548-560` — expanded tool-call scrollback. Items: `React.ReactElement[]` reconstructed every render; visibleCount derived from `terminalRows - EXPANDED_VIEWPORT_OVERHEAD`. Snap-to-bottom on first expand via `wasExpandedRef` + `useEffect` (`:554-560`).
- `port-picker-screen.tsx:129-133` — port list with extra "Custom URL" + "Skip" pseudo-rows.
- `pr-picker-screen.tsx:39-43` — branch list.
- `saved-flow-picker-screen.tsx:57-60` — flow list.
- `recent-reports-picker-screen.tsx:45-48` — manifest list.
- `agent-picker-screen.tsx:133-137` — agents + models; has `initialIndex: firstEnabledIndex >= 0 ? firstEnabledIndex : 0` to skip the "─── Model ───" header.
- `results-screen.tsx` insight panel (`:1078-1089`) and raw-events view (`:1264-1273`) — scroll offset is a plain `useState<number>` (not the hook), clamped on render.

**Known virtual-list pitfalls:**
- **Key stability:** Most list rows use a domain id as the key (`flow.slug`, `branch.name`, `manifest.absolutePath`, `step.id`, `browser.key`). But the deeply nested result views use index-based keys (`` `raw-row-${index}` `` at `results-screen.tsx:1312`, `` `insight-row-${index}` `` at `:1119`, `` `answer-${lineIndex}` `` at `:1684`), which is exactly what caused the scroll-crash hardening in commit `02da3111` (added `<ErrorBoundary label="Raw-events view">`). The underlying key-stability issue is still there — the boundary just catches the crash.
- **Re-render flicker on scroll:** Insight panel and raw-events re-build the whole `RawLine[]` array on every keypress (`results-screen.tsx:1078`, `:1256`). `wrapPlain` is called in a loop per render. No memoization — React Compiler can't optimize across the `useStdoutDimensions` call + the `scrollOffset` prop.
- **Highlight hiccups:** When `itemCount` shrinks (e.g. a filter reducing `filteredEntries`), `useScrollableList` clamps `highlightedIndex` via the sync update at `:24-28`, but this happens inside render — setState-during-render pattern. Ink renders this ok but it's not idiomatic.
- **Expanded Testing view scrolls per event:** every tool-call event reconstructs the full `expandedRows` array in the component body (`testing-screen.tsx:455-545`), passed as `itemCount={expandedRows.length}`. With hundreds of tool calls, we re-render the whole thing per frame.

**Recent key-stability fix:** the commit `02da3111 feat(cli): harden RawEventsView against scroll crashes with error boundary and defensive guards` added `Number.isFinite` guards on `scrollOffset` (`:1267`) and the `<ErrorBoundary>` wrap (`:304-316`). This did not fix the root cause; it masked the symptoms.

## 6. Modeline & hint discipline

Modeline source: `apps/cli/src/components/ui/modeline.tsx` (265 LOC). Hints come from `useHintSegments(screen, gitState, overlay)` at `:20-178`, a single `switch(screen._tag)` returning a `HintSegment[]`.

**Segment shape** (`hint-bar.tsx:3-8`):
```ts
{ key: string; label: string; color?: string; cta?: boolean }
```
- `cta: true` → rendered large on the left (action pill).
- `cta: false` (or absent) → rendered muted on the right (keybind hint).

**Layout math** at `:206-225`:
- Measures left actions, right keybinds. Truncates left actions from the end (`actions = actions.slice(0, -1)`) until everything fits within `columns - 2`. So narrow terminals silently drop the trailing actions.

**Conditionals in the Main case (`:34-57`):**
- Agent label from `agentProviderAtom`.
- Cookie label from `useProjectPreferencesStore.cookieBrowserKeys.length`.
- `ctrl+r` always shown.
- `ctrl+f` shown only if `hasRecentReports` (derived from `recentReportsAtom`). This binds the key-gate and the affordance to the same derivation — good practice.
- `ctrl+w`, `ctrl+p` shown only if `gitState?.isGitRepo`. Same pattern.

**Conditionals in the Results case (`:116-174`):**
- Three overlay cases at the top return early with overlay-specific hints — this is the "per-mode overlay hint mechanism". Only these three drill-in overlays know their own hints.
- When no overlay is open, hints iterate `hasConsole/hasNetwork/hasInsightDetails/hasToolEvents` independently and push `c`/`n`/`i`/`ctrl+o` conditionally.

**Hint/gate drift risks ("silent no-op" bugs):**
1. `results-screen.tsx:180-186` computes `hasRawEvents = hasConsole || hasNetwork || hasInsightDetails || hasToolEvents`. `modeline.tsx:146-159` recomputes the same from scratch. If one file updates the predicate (e.g., add a new event type that should show in raw-events) and the other doesn't, the key works without a hint (or vice versa).
2. `CookieSyncConfirm` binds `n` (clear selection) without a modeline segment. Real silent no-op by our definition.
3. `ctrl+l` app-level has no hint.
4. Main `↑/↓` history nav has no hint; works only when `!value.includes("\n")`.
5. Main `→/←` cycle hint is conditional (`showCycleHint` at `main-menu-screen.tsx:173` gates a line of text, not a modeline entry).
6. Scroll keys in Testing's `expanded` mode have no modeline segment.

**The per-mode overlay hint mechanism today:** the `overlay` prop in `useHintSegments(screen, gitState, overlay)` is read from `useNavigationStore.overlay` (`modeline.tsx:189`). When Results' local `showInsights`/`showRawEvents`/`askOpen` go `true`, their helper also calls `setOverlay("insights" | "rawEvents" | "ask")` (`results-screen.tsx:70-120`), causing the modeline to switch. This is the mechanism added in the task-62 refactor (review-1 finding 4). Two sources of truth for overlay state (local `useState` + store `overlay`) have to stay in sync — every `open*`/`close*` helper writes both.

## 7. Streaming / async UX

Agent-run streaming happens in `testing-screen.tsx` and is persisted via `usePlanExecutionStore.setExecutedPlan(plan)` (set by `testing-screen.tsx:617`). Watch mode has its own stream in `watch-screen.tsx:64-115` using `WatchEvent` tagged unions instead of `ExecutedPerfPlan`.

**Components involved:**
- `testing-screen.tsx` — primary streaming view. Renders collapsed steps (current step + ≤5 tool calls) or expanded scrollable view (all steps + all tools).
- `usePlanExecutionStore` — holds current `ExecutedPerfPlan` and `expanded` flag.
- `executeFn` (atom) — stream subscriber that feeds `onUpdate(executedPlan)` into local state (`execution-atom.ts:58-90`).
- `ToolCallBlock` (`testing-screen.tsx:287-310`) — renders a single tool call line.
- `TextShimmer` (`text-shimmer.tsx`) — animated gradient effect used as "the agent is working" signal on active step labels and on the modeline divider during Testing/Watch (`modeline.tsx:229-236`).
- `watch-screen.tsx` — separate renderer with its own phase enum (`polling/settling/assessing/running/idle/error`).
- Screenshots are `<Static>` items in Testing (`:696-702`) so they don't redraw every frame.

**UX shortcomings:**
- Agent messages (text chunks) are NOT rendered in Testing. Only `ToolCall`/`ToolResult`/`ToolProgress` events get UI. Any `AgentMessageChunk` is silently consumed.
- Ask panel streams text into `askHistory` at completion only (`results-screen.tsx:89-92`) — the agent's streaming chunks accumulate into a single string but aren't shown incrementally; the user sees "Asking..." until the whole stream finishes.
- Cancelling a Testing run: `esc` opens a confirmation modal (`:639-650`). Confirming triggers `triggerExecute(Atom.Interrupt)` via the atom fn cleanup, but there's no per-step cancel or per-tool-call cancel.
- Cancelling the Ask panel: not possible — close hides the UI but the fiber keeps running (explicitly deferred by the author in the commit message for `bff1522d`).
- Tool-call arguments are truncated at `TESTING_ARG_PREVIEW_MAX_CHARS = 80` chars (`constants.ts:6`). No way to expand a single tool call in Testing to see the full arg/result.
- No pause/resume. No "show me the JSON of what the agent just did" shortcut during a run.
- Re-render flicker: each event mutates `executedPlan`, which changes `expandedRows.length`, which changes `useScrollableList` inputs. Every event triggers a scroll recompute (`expandedScroll.setHighlightedIndex(...)` in the "snap to bottom" effect at `testing-screen.tsx:554-560`).
- Watch screen doesn't show the report after a run completes — only a "Last: passed/failed" chip and truncated step list. The executed plan is available (`watchEvent.executedPlan`) but there's no path from Watch → Results, so the user can't inspect metrics/insights.

## 8. Error rendering

Three distinct error-rendering paths:

### 8.1 `ErrorBoundary` (`apps/cli/src/components/ui/error-boundary.tsx`, 50 LOC)

Classic React class-component boundary. Used once, around `<RawEventsView>` (`results-screen.tsx:303-315`), label `"Raw-events view"`. Catches everything; renders a small "component crashed — press esc to return" panel.

### 8.2 `ErrorMessage` (`apps/cli/src/components/ui/error-message.tsx`, 66 LOC)

Renders a structured error with `displayName`/`_tag`/`message` and a "Report at GitHub" footer for defects. Consumed only by `testing-screen.tsx:848-862` via `AsyncResult.builder(executionResult).onError(...).onDefect(...).orNull()`. This is the **only place** in the codebase that uses the `AsyncResult.builder` pattern the CLAUDE.md rules mandate.

### 8.3 `InlineError` (`error-message.tsx:52-67`)

Single-line red text. Used by `main-menu-screen.tsx:377` for form-validation errors on submit.

### 8.4 Ad-hoc error surfaces

- `pr-picker-screen.tsx:206-210` — `checkoutError` rendered as a red `<Text>` block.
- `results-screen.tsx:459-461` — "Failed to post to PR" chip on mutation error.
- `results-screen.tsx:474-478` — "Failed to save flow" chip on atom failure.
- `results-screen.tsx:1660` — ask-panel error chip.
- `recent-reports-picker-screen.tsx:157-161` — generic "Failed to open report" chip, **drops the actual `loadFailure` cause** (review finding `:47`).
- `watch-screen.tsx:365-371` — `lastError` string.

**Inconsistencies:**
- Only Testing uses `AsyncResult.builder`. Every other mutation atom (`saveFlowFn`, `loadReportFn`, `askReportFn`) uses manual `AsyncResult.isSuccess`/`AsyncResult.isFailure` checks (explicitly called out in `task-62-review-1.md:47`).
- `ErrorBoundary` is used exactly once. There's no blanket app-level error boundary at `app.tsx`; any unhandled render error anywhere else crashes Ink.
- `ErrorMessage` takes a `{ _tag, displayName?, message }` duck-typed object, not the Effect error classes directly. Each caller has to manually shape the object (see `testing-screen.tsx:854-860`).
- `recent-reports-picker-screen.tsx:157-161` hardcodes a sentence; the real `ReportLoadError` already carries `filename` and `cause` (review finding `:47`).

## 9. Theming & colors

Source: `apps/cli/src/components/theme-context.tsx` (57 LOC). Two exports:
- `theme` — CSS-like string map (`primary`, `error`, `textMuted`, etc.) used by components that pass raw color names to Ink.
- `COLORS` — enum mapping semantic slot names (`TEXT`, `GREEN`, `YELLOW`, ...) to `theme` values.

`useColors()` returns the same `COLORS` constant from any component. There is no provider; it's a global.

`NO_COLOR` env var blanks all colors (`:18`).

**Visual primitives:**
- `Logo` (`logo.tsx`, 21 LOC) — "✗✓ Perf Agent vX.Y.Z" line.
- `Spinner` (`spinner.tsx`, 20 LOC) — wraps `ink-spinner` with optional message.
- `TextShimmer` (`text-shimmer.tsx`, 48 LOC) — hand-rolled gradient animation via `setInterval` + `lerpColor`. Used on active step labels and the modeline divider during Testing/Watch. **Uses `setInterval` inside render, keyed by `startedRef`** — non-standard React pattern.
- `figures` (npm package) — shared glyph set (`tick`, `cross`, `pointer`, `bullet`, `arrowRight`, `warning`, `ellipsis`, `checkboxOn/Off`, `lineVertical`, `circle`). Every status marker in the app comes from here; no inline unicode.
- `RuledBox` (`ruled-box.tsx`, 42 LOC) — decorative bordered container.
- `ScreenHeading` (`screen-heading.tsx`, 28 LOC) — title + subtitle primitive.
- `HintBar` (`hint-bar.tsx`, 29 LOC) — right-side keybind render.
- `SearchBar` (`search-bar.tsx`, 33 LOC) — input primitive for filter modes.
- `FileLink` (`file-link.tsx`, 22 LOC) — OSC 8 clickable file link.
- `Image` (`image.tsx`, 33 LOC) — inline image support when `supports-inline-images.ts` says the terminal can do it.
- `Input` (`input.tsx`, 287 LOC) — hand-rolled multiline text input with word-boundary navigation, history callbacks, cursor rendering via `picocolors`. Does NOT use `ink-text-input` / `ink-textarea`.

## 10. Testing

**There are zero UI component tests.** Everything under `apps/cli/tests/` is utility-level (browser-client, ci-reporter, extract-close-artifacts, step-elapsed, update, watch-notifications, init, mcp-subcommand, etc.). No `render()` from `ink-testing-library`, no `useInput` fixtures, no visual snapshot.

Verified via:
```
apps/cli/tests/*.ts (15 files) → grep render/ink-testing/useInput/<App → 0 matches
```

Manual QA relies on the CLI's dry-run mode (not inspected here) and `pnpm --filter @neuve/perf-agent-cli build` as a compile check.

## 11. Pain points & anti-patterns — concentrated

| # | Pain | Cite | Category |
|---|---|---|---|
| 1 | `results-screen.tsx` is 1691 LOC hosting ~15 subcomponents, 3 overlays, 6 inline features (copy/post/save/restart/ask/expand×2). Any touch is a merge conflict. | `results-screen.tsx:1-1692` | Size / maintainability |
| 2 | Overlay state duplicated: local `useState` + store `overlay` union. Every `open*`/`close*` helper must write both. | `results-screen.tsx:70-120`, `use-navigation.ts:55-74` | State duplication |
| 3 | `recentReportsAtom` is read-once, never invalidates after `reportStorage.saveSafe` in `execute-atom.ts:102`. First-ever run never exposes `ctrl+f` until restart. | `recent-reports-atom.ts:8-19`, `task-62-review-1.md:39` | Atom freshness |
| 4 | `useSavedFlows` React Query never invalidates after `saveFlowFn`. Same stale-read class. | `use-saved-flows.ts`, `flow-storage-atom.ts` | Query freshness |
| 5 | CLAUDE.md "no JSX ternaries" is pervasively violated. `recent-reports-picker-screen.tsx:89, 119-120, 130-131, 133`; `main-menu-screen.tsx:269-270`; `pr-picker-screen.tsx:142-145, 186-193, 206, 212`; `results-screen.tsx:408-409`; `agent-picker-screen.tsx:221-225`. | multiple | Style / review burden |
| 6 | Manual `AsyncResult.isSuccess`/`isFailure` checks everywhere; only Testing uses `AsyncResult.builder`. | `results-screen.tsx:125-126`, `recent-reports-picker-screen.tsx:40-43`, `main-menu-screen.tsx:49-53`, `app.tsx:37-38`, `modeline.tsx:31-32` | CLAUDE.md violation |
| 7 | Hint/gate drift between `results-screen.tsx:180-186` and `modeline.tsx:146-159` — both recompute `hasRawEvents` independently. Silent no-op bugs when the two predicates diverge. | cited | Architecture |
| 8 | Silent-no-op keys: `n` on CookieSyncConfirm (`cookie-sync-confirm-screen.tsx:109-111`), instruction history `↑/↓` multi-line gate (`main-menu-screen.tsx:171, 212-219`), Testing expanded-scroll keys (no modeline hint). | cited | UX |
| 9 | Duplicate host-path helpers: `main-menu-screen.tsx:38-44`, `recent-reports-picker-screen.tsx:24-31`, `packages/supervisor/src/report-storage.ts:98-104`. Called out as `[MINOR]` in review. | cited | Duplication |
| 10 | `useScrollableList` uses `useCallback` + `useMemo` — violates React Compiler rule. | `use-scrollable-list.ts:1, 30, 37` | CLAUDE.md violation |
| 11 | `RawEventsView` and `InsightDetailsPanel` rebuild their entire line arrays on every keypress (no memoization possible through React Compiler because of inline `useColors`/`useStdoutDimensions` reads). | `results-screen.tsx:1078, 1256` | Perf |
| 12 | Index-based React keys in scrollable views (`raw-row-${index}`, `insight-row-${index}`, `answer-${lineIndex}`). Scroll-crash bug masked by `<ErrorBoundary>` wrap added in `02da3111`. | `results-screen.tsx:1119, 1312, 1684`, `ErrorBoundary` at `:304` | Correctness |
| 13 | `as` cast at `testing-screen.tsx:90, 95` (`parseRawInput`) — CLAUDE.md violation ("No type casts"). | cited | CLAUDE.md violation |
| 14 | Ask-panel fiber cannot be cancelled; commit message admits deferral. | `results-screen.tsx:77-82, 84-96`, commit `bff1522d` | UX |
| 15 | Watch screen drops the `PerfReport` after a run completes — no way to see metrics/insights for a watch run. | `watch-screen.tsx:88-100, 269-284` | UX |
| 16 | `ErrorBoundary` is used once (`results-screen.tsx:304`); the rest of the app has no render-error safety net. | cited | Robustness |
| 17 | `screenshotPathsAtom` is read but never written. Documented `HACK`. | `execution-atom.ts:32-33` | Dead code |
| 18 | Analytics errors silently swallowed via `Effect.catchCause(() => Effect.void)` with `HACK` comment. Deliberate but worth tracking. | `execution-atom.ts:154-156` | — |
| 19 | Testing + Watch duplicate ~100 LOC of step-render branching (active/passed/failed/skipped/default). | `testing-screen.tsx:746-833`, `watch-screen.tsx:286-361` | Duplication |
| 20 | Main menu's banner uses an inline IIFE for stat math. Readability. | `main-menu-screen.tsx:285-308` | Style |
| 21 | `TextShimmer` starts a global `setInterval` inside render (`startedRef` guard) — non-idiomatic, no teardown. | `text-shimmer.tsx:22-32` | Robustness |
| 22 | Elapsed-time 1-second interval triggers a whole-tree re-render during Testing (including deep tool-call rows). | `testing-screen.tsx:627-634` | Perf |
| 23 | `agentBackend` is mirrored between `usePreferencesStore.agentBackend` and `agentProviderAtom` via `useEffect` in `app.tsx:41-43`. Drift surface. | cited | State duplication |

## 12. LOC by area

| Area | File | LOC |
|---|---|---|
| **Screens** | `results-screen.tsx` | **1691** |
| | `testing-screen.tsx` | 866 |
| | `port-picker-screen.tsx` | 441 |
| | `watch-screen.tsx` | 383 |
| | `main-menu-screen.tsx` | 380 |
| | `agent-picker-screen.tsx` | 245 |
| | `pr-picker-screen.tsx` | 229 |
| | `cookie-sync-confirm-screen.tsx` | 180 |
| | `recent-reports-picker-screen.tsx` | 164 |
| | `saved-flow-picker-screen.tsx` | 141 |
| | **Screens total** | **4720** |
| **App shell** | `app.tsx` | 176 |
| | `program.tsx` | 40 |
| **UI primitives** | `input.tsx` | 287 |
| | `modeline.tsx` | 265 |
| | `context-picker.tsx` | 107 |
| | `error-message.tsx` | 66 |
| | `theme-context.tsx` | 57 |
| | `error-boundary.tsx` | 50 |
| | `text-shimmer.tsx` | 48 |
| | `ruled-box.tsx` | 42 |
| | `image.tsx` | 33 |
| | `search-bar.tsx` | 33 |
| | `hint-bar.tsx` | 29 |
| | `screen-heading.tsx` | 28 |
| | `file-link.tsx` | 22 |
| | `logo.tsx` | 21 |
| | `spinner.tsx` | 20 |
| | **UI total** | **1108** |
| **Zustand stores** | `use-navigation.ts` | 74 |
| | `use-preferences.ts` | 80 |
| | `use-project-preferences.ts` | 35 |
| | `use-plan-execution-store.ts` | 18 |
| | **Stores total** | **207** |
| **Effect atoms** | `ask-report-atom.ts` | 262 |
| | `execution-atom.ts` | 161 |
| | `recent-reports-atom.ts` | 39 |
| | `flow-storage-atom.ts` | 22 |
| | `github-mutations.ts` | 17 |
| | `config-options.ts` | 15 |
| | `runtime.ts` | 15 |
| | **Atoms total** | **531** |
| **React Query hooks + utilities** | `use-listening-ports.ts` | 225 |
| | `use-context-picker.ts` | 120 |
| | `use-update-check.ts` | 55 |
| | `use-scrollable-list.ts` | 53 |
| | `use-installed-browsers.ts` | 48 |
| | `use-git-state.ts` | 47 |
| | `use-config-options.ts` | 30 |
| | `use-available-agents.ts` | 26 |
| | `use-stdout-dimensions.ts` | 25 |
| | `use-saved-flows.ts` | 22 |
| | `use-mount-effect.ts` | 10 |
| | `use-detected-projects.ts` | 9 |
| | `use-remote-branches.ts` | 9 |
| | **Hooks total** | **679** |

**Grand total inside `apps/cli/src/components/` + `/stores/` + `/data/` + `/hooks/`: ~7.25k LOC** (plus `constants.ts`, `utils/*`, CLI commands, which are out of direct TUI scope).

## 13. Feature preservation checklist

A rewrite MUST preserve every capability below unless the user explicitly drops it. Grouped by surface.

**Main menu**
- Describe-what-to-test prompt input (multiline, with persisted history accessible by ↑/↓ on single-line).
- Inline test-suggestion placeholder with `tab` to accept, `→/←` to cycle.
- `@`-triggered context picker: pick working-tree, any local branch, any remote PR branch, or a specific commit.
- Visible context chip above input showing the active context (`@branch (description)`).
- "Changes detected" banner with file counts + ±added/removed when `gitState.hasUntestedChanges`.
- "Last run: url · time · status" banner when recent reports exist.
- Cookie-sync toggle (`ctrl+k`): clear if set, else open CookieSyncConfirm.
- Agent picker (`ctrl+a`) — pick agent backend and model.
- PR picker (`ctrl+p`) — browse/filter/checkout a branch.
- Watch mode (`ctrl+w`) — start file-watching flow.
- Saved-flow picker (`ctrl+r`).
- Past-runs picker (`ctrl+f`, gated on reports existing).
- Auto-transition to CookieSyncConfirm when no URL & no cookies yet; auto-transition to PortPicker when no URL and no CLI base-urls.

**CookieSyncConfirm**
- List detected browsers (Chrome, Firefox, Safari, Arc, Chrome Canary, …).
- Seed default-browser selection.
- Multi-select with `space`; `a` select-all; `n` clear-all.
- On confirm, persist cookie-browser keys to project preferences.

**PortPicker**
- List actively listening dev-server ports (periodic refetch every 5s).
- List detected projects (framework guess + cwd + default port) not already running.
- Multi-select ports with checkbox state.
- Free-form custom URL input.
- Skip option (no base URL).
- Filter/search `/`.
- Seed selection from `lastBaseUrl`.
- Propagate selected URLs and detected `devServerHints` (project path + dev command) to Testing.

**Testing**
- Live streamed agent session with tool calls, tool results, tool progress.
- Collapsed view: active step + last 5 tool calls (with running indicator, tokens/bytes streaming).
- Expanded view (`ctrl+o`): scrollable list of all steps + all tool calls, tool input/result previews, scroll keys (`↑↓/j/k/pgup/pgdn/ctrl+u/ctrl+d`), snap-to-bottom on first expand.
- Screenshot rendering inline (via `<Static>`).
- Cancel-confirmation on `esc` (`enter/y` stop, `esc/n` dismiss).
- `ctrl+n` toggle OS notifications.
- Auto-navigate to Results on completion.
- On failure, show `ErrorMessage` with tag/displayName/message; `esc` goes to Main.
- Analytics: `analysis:started`, `analysis:completed`, `analysis:failed`, `analysis:cancelled`.

**Watch**
- File-watching loop with phases (polling, settling, change-detected, assessing, running, idle, error).
- Idle-spinner cycling between spinner and "no testable changes" hint.
- Per-run step list during active run.
- Last-result chip (passed/failed) + run count.
- Stop-confirmation on `esc`.
- `ctrl+n` toggle notifications.
- Desktop notifications on run completion / error (when enabled).

**Results**
- Status (passed/failed) + icon + message fallbacks for "no tools ran" and "tools ran but no trace".
- CWV metrics table per captured URL: LCP, FCP, CLS, INP, TTFB with value/target/classification.
- Trace insight names list.
- Regressions panel (critical/warning/info).
- Console captures panel — summary (total/errors/warnings/info) + expandable full list via `c`.
- Network captures panel — summary + expandable list via `n`.
- Insight-details drill-in (`i`): scrollable per-insight cards with header, summary, analysis, savings, external resources.
- Raw-events drill-in (`ctrl+o`): scrollable dump of tool events, console, network, insight details in one long flat list.
- Ask panel (`a`): agent Q&A over the loaded report, Q&A history in-panel.
- Copy report to clipboard (`y`).
- Post summary to PR (`p`, when `report.pullRequest` is present).
- Save as reusable flow (`s`).
- Restart (`r`): re-run with same context + instruction.
- Per-step status list with elapsed time.
- Total elapsed time.
- Report summary text (when present).
- Video URL (when captured).
- Screenshot images (when captured).

**SavedFlowPicker**
- Scrollable list of saved flows with title/step-count/description.
- Select → re-run with saved flow's instruction + cookie hints.

**RecentReportsPicker**
- Scrollable list of persisted `ReportManifest`s (url, branch, status icon, relative time).
- Select → load `PerfReport` from disk → Results.
- Error surface when load fails (currently generic; spec said "inline cause").

**PR Picker**
- Fetch remote branches with associated PR metadata.
- Filters: recent, all, open, draft, merged, no-pr.
- Search `/`.
- Select → `checkoutBranch(cwd, name)` and return to Main.
- Error surface when checkout fails (uncommitted changes, etc.).
- Cached via React Query (`["remote-branches"]`).

**AgentPicker**
- List all known agent backends, mark which are installed.
- Pick agent → writes to `agentProviderAtom` + preferences store.
- Per-agent model list (from ACP `fetchConfigOptions`) flattened from groups.
- Mark current model with tick; sublabels for descriptions / not-installed.

**Global**
- `ctrl+l` clear-and-repaint.
- `ctrl+u` update CLI when a newer version is available.
- Update-check banner in modeline.
- Alt-screen enter/exit on process start/end.
- `NO_COLOR` honored across all colors.
- OSC 8 clickable file links in terminals that support it.
- Inline images in terminals that support it.
- Analytics opt-in/opt-out handled at supervisor layer.

## 14. What's actually good (non-obvious)

Items a rewrite should deliberately preserve. Citing code so the rationale isn't hand-wavy.

- **Screen is a `Data.TaggedEnum`.** `use-navigation.ts:9-38` makes every screen a discriminated-union variant with its own prop bag. Cheap, exhaustive-safe, self-documenting. Switch over `.` _tag` in `app.tsx:117` narrows props. Keep this.
- **App-level `esc` + `overlay` gate.** `app.tsx:86` short-circuits app-level back-nav when a screen overlay is active, letting the screen own its `esc`. Once you have drill-ins, this pattern is necessary. Keep it but make the "two sources of truth" (local + store) into one source.
- **`AsyncResult.builder` on Testing's error surface.** `testing-screen.tsx:848-862` is the right shape — separate `onError`/`onDefect` branches feeding into `<ErrorMessage>`. Extend this pattern everywhere.
- **Per-screen `useInput` with guard booleans.** Each overlay branches through its own gate and only falls through when the gate is false. `results-screen.tsx:191-253` is readable — messy but correct.
- **Alt-screen + mouse-disable sequences on start/exit.** `program.tsx:21-22, 38`. Clean teardown; no leftover junk in the user's scrollback.
- **`NO_COLOR` respected.** `theme-context.tsx:18-38`. Zero color strings get passed when `NO_COLOR` is set.
- **`figures` for all status glyphs.** No inline Unicode scattered around; one import per file. Easy to swap globally (including terminals that don't handle Nerd fonts).
- **Branded IDs preserved across UI.** `PlanId`, `StepId`, `BrowserKey` stay branded all the way into React props. Keeps the UI type-safe against mixing IDs.
- **`Effect.fn` / `Effect.annotateLogs({ fn })` in every atom.** `ask-report-atom.ts:259`, `recent-reports-atom.ts:16`, `execution-atom.ts:141`. Structured logs with consistent span names — great for the `.perf-agent/logs.md` debug workflow.
- **Analytics baked into the atom layer, not the UI.** `execution-atom.ts:56, 121, 151`. UI doesn't know about analytics; atoms do. Keep this separation.
- **CI / headless handling is a separate command (`commands/watch.ts`), not a UI mode.** Keeps the TUI focused on TTY sessions and avoids a third "mode".
- **Cancellation via `Atom.Interrupt` in atom cleanup.** `testing-screen.tsx:593-595` cleanly kills the fiber on unmount. The Ink-unmount-then-kill lifecycle works reliably across screen transitions.
- **`useScrollableList` returns a uniform API.** Despite its React Compiler violations, the hook's shape (`highlightedIndex`, `scrollOffset`, `handleNavigation`) is consistent across every list screen. A rewrite should keep the interface and replace the implementation.
- **`ExecutedPerfPlan`/`PerfReport` as getter-rich schema classes.** `report.uniqueInsightNames`, `report.stepStatuses`, `report.toPlainText` (cited in `results-screen.tsx:133, 173, 405`). UI consumes derived state; it doesn't compute it. This aligns with the CLAUDE.md "Prefer Getters on Existing Domain Models" rule and a rewrite should keep leaning on it.
- **`TextShimmer` on the modeline divider during Testing/Watch.** `modeline.tsx:229-236`. Subtle but effective "something is happening" signal without taking screen real estate. Minor but worth preserving.
- **Dev-server auto-detection with `devServerHints` passed through to agent.** `port-picker-screen.tsx:135-148`. The agent can run the dev command itself. Real product value; the current UX flow is okay.
- **Update nudge is non-intrusive** — a small right-aligned CTA (`modeline.tsx:193-203`) that's easy to ignore but visible. `ctrl+u` exits the TUI cleanly and hands off to the update command rather than trying to do an in-process swap.

