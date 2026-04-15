# TUI Rewrite — Authoritative Scope (Path A: Bun + SolidJS + OpenTUI)

_Status: committed plan. Circle-back artifact. Self-contained; no conversation context required._

_Companion docs (required reading for any phase lead):_

- [`./opencode-tui-reference.md`](./opencode-tui-reference.md) — external research on sst/opencode's TUI. Pinned SHA `9640d88`.
- [`./current-tui-inventory.md`](./current-tui-inventory.md) — audit of our current Ink TUI. Screen-by-screen features + pain-point catalogue.
- [`../../../CLAUDE.md`](../../CLAUDE.md) — repo-wide rules. Still apply to the new TUI's data layer and to any Effect-TS surface area.
- [`/Users/vinicius/.claude/skills/team-orchestration/SKILL.md`](file:///Users/vinicius/.claude/skills/team-orchestration/SKILL.md) — role boundaries, seed prompts, diary, review gates.
- [`/Users/vinicius/.claude/skills/strict-critique/SKILL.md`](file:///Users/vinicius/.claude/skills/strict-critique/SKILL.md) — antagonistic review posture and merge gates.

_Review system prompt for every phase's reviewer:_ `docs/handover/tui-rewrite/review-system-prompt.md` (to be authored alongside TUI-P0). Until that file exists, phase-0's reviewer should reuse the template from `mcp-vertical-implementation/review-system-prompt.md` and add the phase-specific lane directives from §4 below.

---

## 1. Goal and non-goals

### Goal

Replace the Ink/React TUI in `apps/cli/` with an OpenTUI/SolidJS TUI running on Bun, keeping the Effect-TS supervisor + atoms as the data layer. The `perf-agent` binary (same name) must reach feature parity with the current TUI as defined by §13 of `current-tui-inventory.md`. Sharp interaction changes are permitted where opencode's patterns are strictly better (e.g. unified command registry, dialog stack, streaming-stable markdown) — feature parity does not mean pixel parity.

"Rewrite" here means **Path A — full stack migration** (see §11 of `opencode-tui-reference.md`):

- Drop React + Ink, `zustand`, `@tanstack/react-query` from the TUI layer.
- Adopt `@opentui/core` + `@opentui/solid` + `solid-js` for rendering and reactivity.
- Consume Effect atoms via a Solid adapter (built in TUI-P2) instead of `@effect-atom/react`.
- Switch the TUI process runtime from Node to Bun.

### Non-goals

- **Data layer is not being rewritten.** `@neuve/supervisor`, `@neuve/agent`, `@neuve/browser`, `@neuve/shared`, `@neuve/cookies` and the atoms under `apps/cli/src/data/` stay Effect-TS. Their public interfaces, errors, and log behavior are frozen for this rewrite. If a phase needs a supervisor change, surface it as an open question in §7 — do not fold it into the TUI work.
- **No on-disk format changes.** Report manifests, saved flows, preferences stores, `.perf-agent/` layout stay as-is. `reportStorage`, `flowStorage`, `projectPreferencesStorage`, `recentReportsAtom.listManifests` — all consumed unchanged.
- **Agent backends and MCP integration untouched.** The ACP/MCP contract our supervisor speaks to Claude Code, Codex, Copilot, Gemini, Cursor, OpenCode, Droid, Pi, Local is frozen.
- **CLI subcommands untouched.** `init`, `watch`, `mcp`, `update`, `add github-action`, `add skill`, `navigate`, `snapshot`, `screenshot`, `trace`, `trace-stop`, `insight`, `emulate`, `lighthouse`, `close` keep their current behavior and flags. Only the `tui` subcommand's renderer changes.
- **No CI/headless path changes.** `runHeadless` (invoked from `runHeadlessForTarget` in `apps/cli/src/index.tsx:130-152`) is preserved verbatim.
- **No Go/Bubbletea-style IPC split.** The TUI stays single-process like opencode's current setup.
- **No plugin SDK.** OpenCode's `TuiPluginRuntime` + slot registry is explicitly out of scope for v1 (see §11 of `opencode-tui-reference.md`).

### Prototyping caveat

The project is in prototyping. Sharp interaction changes are allowed when they (a) fix a cataloged pain point from `current-tui-inventory.md` §11 or (b) adopt an opencode pattern that strictly improves correctness (hint-drift elimination, unified keybinds, dialog stack). On-disk formats are the one hard line — they do not change without an explicit user decision in §7.

---

## 2. Target architecture

### Toolchain

- **Runtime:** Bun ≥ 1.1 (lockstep with opencode's `@lydell/node-pty` + `bun-pty` requirements).
- **Renderer:** `@opentui/core` 0.1.99 + `@opentui/solid` 0.1.99 (same versions opencode pins at SHA `9640d88` per `opencode-tui-reference.md` §1).
- **UI framework:** `solid-js` with JSX pragma `@jsxImportSource @opentui/solid` (see opencode `packages/opencode/src/cli/cmd/tui/app.tsx` at pinned SHA).
- **Workspace:** stay on pnpm for the monorepo root; add a `bun` workspace entry only for the new TUI app so Bun's dep resolver can see `@opentui/core`'s native addon. pnpm + Bun coexistence contract is settled in TUI-P0 (see risks §8).
- **Data layer:** unchanged — `effect` (catalog version), `@effect/platform-node`, `effect-atom` for the atom primitives underneath our Solid adapter.

### Process model

**Single Bun process.** Same as opencode post-PR #2685. The `perf-agent tui` binary forks a Bun entry file that:

1. Parses Commander options (existing code in `apps/cli/src/index.tsx:395-449` stays, just imports a new `renderApp` from `apps/cli-solid/`).
2. Constructs `layerCli({ verbose, agent })` once via `Atom.runtime(...).pipe(Atom.keepAlive)` (mirrors today's `cliAtomRuntime` at `apps/cli/src/data/runtime.ts`).
3. Mounts the Solid TUI inside `ErrorBoundary` → providers → app root, calling `@opentui/solid`'s render function.

Effect atoms stay **in-process**. No SSE boundary. Streaming events cross the Effect↔Solid line directly via the adapter built in TUI-P2. Fallback (out-of-process supervisor talking to the TUI over a local event stream) is explicitly NOT pursued unless the adapter in TUI-P2 fails its acceptance criteria — at which point the phase-4 lead surfaces it as a circle-back question before continuing.

### Rendering model

- 60 FPS full-redraw to the OpenTUI back buffer; Zig-side swap. See opencode `anomalyco/opentui/packages/core/src/renderer.ts` and opencode's `app.tsx` at pinned SHA for the `rendererConfig`/`targetFps: 60` pattern.
- No custom reconciler. We use `@opentui/solid` as-is. All escape hatches go through the imperative `renderer.*` API (selection, clear, terminal title, debug overlay).
- Layout is Flexbox via OpenTUI renderables (`<box>`, `<text>`, `<span>`, `<scrollbox>`, `<code>`, `<markdown>`, `<input>`).
- Streaming view uses `<scrollbox stickyScroll stickyStart="bottom">` with `<For>` rows — verbatim pattern from opencode `routes/session/index.tsx` lines ~1060-1178 at pinned SHA.
- Markdown/code output uses `<code filetype="markdown" streaming={true} ...>` and optionally the experimental `<markdown>` renderable behind a flag (see opencode `routes/session/index.tsx` ~1476-1508).

### State management

- **Per-view state:** plain `createSignal` / `createMemo`. No `useState`. No `useMemo`. No `useCallback`. Solid's fine-grained reactivity is the replacement.
- **Replicated / derived state from the data layer:** a Solid store (`createStore` + `produce` + `reconcile` + `batch`) fed by the Effect↔Solid adapter from TUI-P2. Modeled on opencode `context/sync.tsx` at pinned SHA — store shape keyed by IDs, binary-search insert for deltas, 16 ms batched flush on bursty event streams.
- **Persistent view preferences:** a `kv` abstraction (`kv.signal(key, default)`) backed by the same `zustand/middleware/persist` storage the current `use-preferences.ts` uses. The on-disk key (`prompt-history`) and the serialized fields (`agentBackend`, `instructionHistory`, `notifications`, `modelPreferences`) are preserved. The Zustand store class is deleted; only the storage adapter is reused (same filename key, same `partialize` fields).
- **No `zustand` in the Solid TUI.** No `@tanstack/react-query`. React Query calls are ported to either (a) plain Effect atoms returning `AsyncResult`, or (b) Solid `createResource` wrapping the existing supervisor functions. Decision per-hook in TUI-P2.
- **No `null` anywhere.** `Option` from Effect at the data boundary; `undefined` inside Solid signals.

### Unified command registry (opencode pattern, adopted verbatim)

Every navigation target, overlay toggle, slash command, and action binds its key, palette label, slash name, `enabled`/`hidden`/`suggested` flag, and `onSelect` handler in a single registered object. Reference: opencode `context/keybind.tsx` + `component/dialog-command.tsx` + `app.tsx` master `command.register(() => [ ... ])` at pinned SHA.

Required shape (transcribed from `opencode-tui-reference.md` §6):

```
{
  title: string
  value: string             // stable command ID, e.g. "session.save-flow"
  keybind?: string          // name resolved through Keybind.print(name)
  category: string          // grouping for command palette
  slash?: { name: string; aliases?: string[] }
  suggested?: boolean       // live-reactive via Solid — see opencode "Show/Hide X" labels
  hidden?: boolean
  enabled?: boolean         // gates key handling entirely
  disabled?: boolean        // greys out palette entry
  onSelect: () => void | Promise<void>
}
```

The command palette's footer ALWAYS renders `keybind.print(option.keybind)` so the visible affordance is derived from the bound key, not hardcoded. This structurally prevents the "hint drifts from gate" bug catalogued in `current-tui-inventory.md` §6 pain-points 1, 7, 8.

Every current binding maps to exactly one registration entry. No orphaned keybindings, no silent no-ops. `ctrl+l` (clear), `n` on CookieSyncConfirm (clear selection), Main `↑/↓` multi-line instruction history — all become proper entries, some `hidden: true`.

### Streaming UX

Replicated store keyed by `(planId, stepId, toolCallId)` (or equivalent domain IDs from `ExecutedPerfPlan`) + sticky-bottom scrollbox + `<code streaming={true}>` for any agent text/tool arg/tool result that exceeds a single line. Modeled on opencode `context/sync.tsx` and `routes/session/index.tsx` (pinned SHA). Perf target: absorb ≥ 30 events/sec without dropping frames and without re-building the full event list per delta (this is the explicit fix for `testing-screen.tsx:455-545` pain point #1, 11, 22 in the audit).

### Error handling

Top-level `<ErrorBoundary>` (opentui-solid's primitive, not React's) wraps the app root. Per-screen toasts via a `Toast` provider modeled on opencode `ui/toast.tsx`. Tagged domain errors from Effect (e.g. `ReportLoadError`, `CheckoutBranchError`) get specific handlers at the atom boundary — no more dropped `cause` like the one flagged in `task-62-review-1.md:47`. `AsyncResult.builder(...)` becomes mandatory at every call site that reads an atom in the Solid TUI — the adapter in TUI-P2 returns results in a shape the builder can chain.

---

## 3. Package & file layout

New workspace package: `apps/cli-solid/`. The existing `apps/cli/` package stays intact through TUI-P5; flipped out in TUI-P6.

```
apps/cli-solid/
  package.json                  # "type": "module", "bin": {"perf-agent": "..."} NOT set until P6
  tsconfig.json                 # extends root; sets "jsxImportSource": "@opentui/solid"
  bunfig.toml                   # Bun-specific overrides for @opentui/core native addon paths
  src/
    index.ts                    # Commander entry (mirrors apps/cli/src/index.tsx), forks into tui.ts
    tui.ts                      # Bun entry for `perf-agent tui` — creates renderer, mounts <App/>
    app.tsx                     # Top-level component: providers, route switch, master command.register(...)
    constants.ts                # Ports from apps/cli/src/constants.ts; adds OpenTUI-specific magic numbers
    context/
      runtime.tsx               # Effect atom runtime provider (replaces apps/cli/src/data/runtime.ts usage)
      sync.tsx                  # Replicated store from Effect atoms (Effect↔Solid adapter consumer)
      kv.tsx                    # Persistent preferences (zustand-persist storage reuse)
      theme.tsx                 # Theme provider; keep semantic COLORS map; honor NO_COLOR
      keybind.tsx               # Keybind parser/printer; leader-key handling (skip leader v1 unless trivial)
      dialog.tsx                # Dialog stack (opencode ui/dialog.tsx pattern)
      toast.tsx                 # Toast provider (opencode ui/toast.tsx pattern)
      command.tsx               # command.register(...) registry
      project.tsx               # gitState, project preferences, cookie preferences
      agent.tsx                 # agent provider + model selection state
    adapters/
      effect-atom.ts            # THE Effect↔Solid boundary. Converts Atom<A> -> Accessor<AsyncResult<A>>
                                # and AtomFn<In, Out> -> (In) => Promise<Exit<Out>>
      async-result.ts           # AsyncResult.builder(...) wrapper for Solid JSX <Show> chains
    renderables/                # Custom Solid components on top of OpenTUI primitives
      logo.tsx                  # Port of apps/cli/src/components/ui/logo.tsx
      spinner.tsx               # Port of spinner.tsx
      text-shimmer.tsx          # Shimmer effect — re-implement on a Solid interval, not setInterval-in-render
      ruled-box.tsx
      screen-heading.tsx
      hint-bar.tsx              # Drops the legacy HintSegment[] shape; reads from command registry
      search-bar.tsx
      file-link.tsx             # OSC 8 links
      image.tsx                 # Inline images when terminal supports
      input.tsx                 # Multiline text input (OpenTUI <input> + our word-boundary nav)
      scrollable-list.tsx       # Virtualized list primitive; replaces use-scrollable-list hook
      error-display.tsx         # Structured error renderer (CLAUDE.md AsyncResult pattern)
      modeline.tsx              # Single modeline primitive reading from command registry; no drift
    routes/                     # Parity with current screens; one file per screen
      main/                     # Main menu; split into smaller renderables
        index.tsx
        changes-banner.tsx
        last-run-banner.tsx
        context-picker.tsx
      testing/
        index.tsx
        collapsed-view.tsx
        expanded-view.tsx
        tool-call-row.tsx
        cancel-dialog.tsx
      watch/
        index.tsx
        phase-display.tsx
      results/                  # Splits the 1691 LOC results-screen.tsx
        index.tsx
        metrics-table.tsx
        insights-list.tsx
        regressions-panel.tsx
        console-panel.tsx
        network-panel.tsx
        insight-details-overlay.tsx
        raw-events-overlay.tsx
        ask-overlay.tsx
      saved-flow-picker/index.tsx
      recent-reports-picker/index.tsx
      port-picker/
        index.tsx
        custom-url-input.tsx
      cookie-sync-confirm/index.tsx
      pr-picker/
        index.tsx
        checkout-dialog.tsx
      agent-picker/index.tsx
    commands/
      register-main.ts          # Main-screen commands (ctrl+k, ctrl+a, ctrl+p, ctrl+r, ctrl+f, ctrl+w)
      register-results.ts       # Results-screen commands (y, p, s, r, a, c, n, i, ctrl+o)
      register-global.ts        # ctrl+l, ctrl+u, esc/back
      register-testing.ts       # ctrl+o expand, ctrl+n notifications, esc cancel
      register-watch.ts         # ctrl+n notifications, esc stop
      register-picker-commons.ts# ↑↓/jk/ctrl+n/p navigation stub reused across pickers
    hooks/
      use-terminal-dimensions.ts
      use-scrollable-list.ts    # Solid reactive version; no useCallback/useMemo
    utils/
      format-host-path.ts       # Consolidates the 3 duplicated helpers from pain #9
      format-duration.ts
      wrap-plain.ts             # Text wrapping; used by raw-events + insights overlays
  tests/
    commands/register-main.test.ts
    commands/register-results.test.ts
    adapters/effect-atom.test.ts
    context/sync.test.tsx
    routes/main/main-menu.test.tsx
    routes/results/results-screen.test.tsx
    # smoke test using @opentui/core createTestRenderer + captureCharFrame on key frames only
```

**File-count discipline:** the results screen decomposes from 1 × 1691 LOC into ~10 files of ≤ 200 LOC each (see pain point #1). Testing screen similarly drops below 400 LOC per file. This is an acceptance bar for P3 and P4.

---

## 4. Phase plan

7 phases, IDs `TUI-P0` through `TUI-P6`. Sizing keeps each phase under ~5 engineer-days with one reviewer round.

### TUI-P0 — Bootstrap

- **Goal:** stand up `apps/cli-solid/` with a Bun entry, OpenTUI deps, and a minimal rendered box; confirm build and dev-loop.
- **Blocked by:** nothing.
- **Blocks:** every subsequent phase.
- **Scope (files to create):**
  - [ ] `apps/cli-solid/package.json` (`solid-js`, `@opentui/core@0.1.99`, `@opentui/solid@0.1.99`, `commander`, `effect` catalog ref, `effect-atom`, `@effect/platform-node`, `@neuve/*` workspace refs).
  - [ ] `apps/cli-solid/tsconfig.json` (extends root; `jsxImportSource: "@opentui/solid"`).
  - [ ] `apps/cli-solid/bunfig.toml` (native addon config).
  - [ ] `apps/cli-solid/src/index.ts` — Commander shell: `perf-agent-solid` (temporary binary name for now). Forks to `tui.ts` on `tui` subcommand; other subcommands shell to the existing `apps/cli` build or fail loud.
  - [ ] `apps/cli-solid/src/tui.ts` — OpenTUI renderer setup (alt-screen, kitty keyboard detection, mouse-disable flag honored).
  - [ ] `apps/cli-solid/src/app.tsx` — renders `<box><text>perf-agent solid TUI — hello</text></box>`.
  - [ ] `apps/cli-solid/src/renderables/logo.tsx` — port of existing Logo. Single file; proves the JSX pragma works end-to-end.
  - [ ] Root `package.json` scripts: add `dev:solid`, `build:solid`. Do NOT touch the existing `perf-agent` bin yet.
  - [ ] `pnpm-workspace.yaml` — register `apps/cli-solid`.
  - [ ] `docs/handover/tui-rewrite/review-system-prompt.md` authored in this phase (reviewer blocker).
- **Acceptance criteria:**
  - [ ] `pnpm -C apps/cli-solid install` succeeds on macOS and Linux (Windows tracked as an open question in §7).
  - [ ] `pnpm -C apps/cli-solid build` succeeds.
  - [ ] `pnpm typecheck` (repo-wide, existing command) passes.
  - [ ] `bun apps/cli-solid/dist/tui.js` renders the hello banner and exits cleanly on `ctrl+c` without leaving the terminal in alt-screen.
  - [ ] `pnpm test --filter cli-solid` runs (empty suite ok).
- **Tasks:**
  - **P0.T1 — Workspace scaffolding.** Create the directory tree, `package.json`, `tsconfig.json`, `bunfig.toml`, add to pnpm workspace, wire up Turbo pipeline. Diary at `docs/handover/tui-rewrite/diary/P0.T1-scaffolding.md`. Review at `docs/handover/tui-rewrite/reviews/P0.T1-review.md`.
  - **P0.T2 — Minimal render.** Author `tui.ts` + `app.tsx` + `logo.tsx`; prove 60 FPS renderer comes up, alt-screen teardown is clean on all exit paths (normal, `ctrl+c`, uncaught exception). Diary at `P0.T2-minimal-render.md`.
  - **P0.T3 — Review system prompt + binary-name decision note.** Author `review-system-prompt.md`. Write a decision note to `docs/handover/tui-rewrite/decisions/binary-name.md` capturing the plan for P6 (keep `perf-agent`, flip the bin). This is a paper task — no code.
- **Review lane:**
  - Skills to load: `/effect-services` (for layer setup), `/global-patterns`, `/interface-craft` (for renderer lifecycle).
  - Antagonistic focus: alt-screen teardown correctness on every exit path; Bun dep resolution doesn't shadow pnpm for the shared `effect` dep; Zig native addon actually loads on the reviewer's machine; `tsconfig.json` doesn't leak the JSX pragma into `apps/cli`.
- **Risks / open questions for this phase:** §7 items 1, 2, 3 must be partially resolved: pick a Bun version, confirm OpenTUI 0.1.99 installs on Linux and macOS (Windows tracked).

### TUI-P1 — Command registry + Main menu parity

- **Goal:** implement the unified `command.register(...)` pattern + the main menu (no cookies, no PR picker yet — stub navigation targets).
- **Blocked by:** TUI-P0.
- **Blocks:** TUI-P3, TUI-P4, TUI-P5.
- **Scope:**
  - [ ] `src/context/keybind.tsx` — key parser, `match(key, evt)`, `print(name)`, no leader v1.
  - [ ] `src/context/command.tsx` — `command.register(fn)`, `command.trigger(value)`, reactive suggested/hidden/enabled flags.
  - [ ] `src/context/dialog.tsx` — stack, `replace`/`clear`/`push`, on-top key gating.
  - [ ] `src/context/toast.tsx`.
  - [ ] `src/renderables/modeline.tsx` — reads from the command registry. No `HintSegment[]`. No drift surface.
  - [ ] `src/commands/register-global.ts` — `ctrl+l`, `ctrl+u` (update nudge), `esc`/back.
  - [ ] `src/commands/register-main.ts` — registers all Main-screen commands as stubs (`ctrl+k`, `ctrl+a`, `ctrl+p`, `ctrl+r`, `ctrl+f`, `ctrl+w`). Each `onSelect` prints a toast "not yet wired" until the relevant phase lands.
  - [ ] `src/routes/main/index.tsx` + `changes-banner.tsx` + `last-run-banner.tsx` — Main menu layout with prompt input, banners, cookie chip, agent chip.
  - [ ] `src/renderables/input.tsx` — multiline input primitive (word-boundary nav, history ↑/↓, context-picker trigger).
  - [ ] `src/routes/main/context-picker.tsx` — `@`-triggered context picker (working tree, branches, PRs, commits).
  - [ ] Tests: `tests/commands/register-main.test.ts` exhaustively verifies every Main key has a matching registered entry; `tests/renderables/modeline.test.tsx` snapshots the modeline against the registry.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test --filter cli-solid -- commands registry modeline` (specific test files) green.
  - [ ] Running the binary shows the Main menu with all banners, and every modeline hint corresponds to a real registered command (asserted by test, not by eye).
  - [ ] `ctrl+l` clears the screen. `esc` on Main is a no-op by design. `ctrl+c` exits cleanly.
  - [ ] Instruction history persists across runs (zustand-persist storage reuse verified by deleting `~/.perf-agent/prompt-history` and repopulating).
- **Tasks:**
  - **P1.T1 — Keybind + command registry + dialog stack.** Pure-logic layer, no screens. Test-first: registry validation (no two commands share a key), dialog stack invariants (esc-pops-top, clear runs onClose). Diary `P1.T1-registry-and-dialog.md`.
  - **P1.T2 — Modeline derived from registry.** Replaces `apps/cli/src/components/ui/modeline.tsx` semantics. Must pass a test that asserts "every affordance in the rendered modeline is a live `enabled: true` command." Diary `P1.T2-modeline.md`.
  - **P1.T3 — Main screen layout + input primitive.** Port `logo`, `ruled-box`, `screen-heading`, `hint-bar`, `input`. Main renders but navigation targets stub out via toast. Diary `P1.T3-main-screen.md`.
  - **P1.T4 — Context picker + history.** `@`-picker with working-tree/branch/remote-PR/commit sources. Instruction history via `kv.signal("instruction_history", [])`. Diary `P1.T4-context-picker.md`.
- **Review lane:**
  - Skills to load: `/interface-craft`, `/global-patterns`, `/effect-services`.
  - Antagonistic focus: any Main key without a modeline entry (silent no-op class); input multiline ↑/↓ gate must not silently inert (pain #8 regression); dialog stack esc handling must pop only the top; history storage key matches the existing `prompt-history` on-disk format.

### TUI-P2 — Effect↔Solid adapter + data layer consumption

- **Goal:** build the adapter that exposes Effect atoms to Solid, then migrate every piece of state the Main menu and the pickers need (preferences, git state, cookie prefs, project prefs, agent provider, recent reports, saved flows, installed browsers, detected projects, remote branches, listening ports, config options, update check, available agents).
- **Blocked by:** TUI-P1.
- **Blocks:** TUI-P3, TUI-P4.
- **Scope:**
  - [ ] `src/adapters/effect-atom.ts` — the contract: `atomToAccessor<A, E>(atom: Atom<A, E>): Accessor<AsyncResult<A, E>>` + `atomFnToPromise<In, Out, E>(atomFn): (input: In) => Promise<Exit<Out, E>>`. 16 ms batch coalescer on burst updates (mirror opencode `context/sdk.tsx` pattern).
  - [ ] `src/adapters/async-result.ts` — Solid-friendly `AsyncResult.builder(...).onWaiting(...).onSuccess(...).onFailure(...).orNull()` returning JSX.
  - [ ] `src/context/sync.tsx` — replicated store scaffolding (keys: `session`, `plan`, `step`, `toolCall`, `consoleCapture`, `networkCapture`) — shape follows `opencode-tui-reference.md` §4; reducer is pure, independently testable.
  - [ ] `src/context/kv.tsx` — backed by the existing zustand-persist storage on disk; keys must not collide with current storage.
  - [ ] `src/context/project.tsx` — git state, project preferences, cookie preferences.
  - [ ] `src/context/agent.tsx` — agent provider, model preference. Removes the `agentBackend` / `agentProviderAtom` double-write documented in pain #23.
  - [ ] Port `recentReportsAtom`, `saveFlowFn`, `loadReportFn`, `executeFn`, `askReportFn` consumption — no changes to the atoms themselves.
  - [ ] Replace React Query hooks (`use-git-state`, `use-listening-ports`, `use-detected-projects`, `use-remote-branches`, `use-installed-browsers`, `use-available-agents`, `use-config-options`, `use-update-check`, `use-saved-flows`) with Effect-atom equivalents OR Solid `createResource` wrappers — decision per hook, captured in `docs/handover/tui-rewrite/decisions/query-to-atom-migration.md`.
  - [ ] Fix pain #3 (`recentReportsAtom` never invalidates) as part of migration — atom MUST invalidate on successful `reportStorage.save` in `execute-atom.ts`. Same class fix for `useSavedFlows` → `saveFlowFn` invalidation. Supervisor-adjacent but within atom layer scope.
  - [ ] Fix pain #17 (`screenshotPathsAtom` dead wiring) — either populate or delete. Decision in `docs/handover/tui-rewrite/decisions/screenshot-paths-atom.md`.
  - [ ] Tests: `tests/adapters/effect-atom.test.ts` — batch coalescer, waiting/success/failure transitions; `tests/context/sync.test.tsx` — reducer unit tests with synthetic events.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test --filter cli-solid -- adapters sync` green.
  - [ ] Main menu shows real data: git state banner, recent-reports `ctrl+f` gate flips on after a run completes (regression test for pain #3), cookie chip updates after CookieSyncConfirm commits.
  - [ ] Adapter performance test: 100 synthetic events/sec for 5 seconds → zero dropped events, no more than one `setStore` per 16 ms window.
  - [ ] No remaining `@tanstack/react-query` import in `apps/cli-solid/src/**`.
  - [ ] No remaining `zustand` import in `apps/cli-solid/src/**` (only the persist storage adapter, imported directly from `zustand/middleware` is allowed if strictly necessary; otherwise port to a plain `fs` + JSON read/write in `context/kv.tsx`).
- **Tasks:**
  - **P2.T1 — Adapter core + batch coalescer.** `effect-atom.ts` + tests. Diary `P2.T1-adapter-core.md`.
  - **P2.T2 — Preferences + kv.** `context/kv.tsx`, `context/project.tsx`, `context/agent.tsx`. Instruction history, cookie prefs, agent provider, model preferences. Diary `P2.T2-preferences.md`.
  - **P2.T3 — Replicated sync store.** `context/sync.tsx`. Reducer handles `message.part.delta`-analog events from our streaming atoms. Diary `P2.T3-sync-store.md`.
  - **P2.T4 — React Query port.** One PR per group: (a) git/branches/PRs, (b) browsers/agents/config options, (c) ports/projects/update-check/saved-flows. Each hook either becomes an atom call or a Solid `createResource`. Pain #3 and its `useSavedFlows` twin are explicit acceptance items on this task. Diary `P2.T4-rq-port.md`.
- **Review lane:**
  - Skills to load: `/effect-services`, `/effect-portable-patterns`, `/global-patterns`.
  - Antagonistic focus: adapter doesn't double-initialize the atom runtime (pain similar to `watch-screen.tsx:128-141` running a second `layerCli`); no `null` slips in; `Option` used correctly at the boundary; recent-reports invalidation actually fires from the atom side, not guessed-at from the UI side; the kv keys match the on-disk names used by the Ink TUI (required for a smooth P6 cutover); AsyncResult.builder is mandatory — grep every atom consumer.

### TUI-P3 — Core screens (non-streaming)

- **Goal:** port Results, SavedFlowPicker, RecentReportsPicker, AgentPicker, PrPicker, PortPicker, CookieSyncConfirm — all the screens that do not have live agent streams. Results gets split per §3.
- **Blocked by:** TUI-P1, TUI-P2.
- **Blocks:** TUI-P5 (overlays depend on Results structure), TUI-P6.
- **Scope:**
  - [ ] `src/routes/results/` — 10 files per §3, each ≤ 200 LOC. Normal-mode keys only (`y`, `p`, `s`, `r`, `c`, `n` toggles). Overlays (`a`, `i`, `ctrl+o`) are stubbed until TUI-P5.
  - [ ] `src/routes/saved-flow-picker/index.tsx`.
  - [ ] `src/routes/recent-reports-picker/index.tsx` — surfaces the real `ReportLoadError.cause` (fixes pain in `current-tui-inventory.md` §1.6 + `task-62-review-1.md:47`).
  - [ ] `src/routes/agent-picker/index.tsx` — group-header rendering (fixes pain in §1.10 where groups are silently flattened).
  - [ ] `src/routes/pr-picker/index.tsx` + `checkout-dialog.tsx` — fixes `null` usage in the current code; checkout confirmation is a proper dialog on the stack, not a local boolean.
  - [ ] `src/routes/port-picker/` — proper state machine for search/custom-URL/nav modes.
  - [ ] `src/routes/cookie-sync-confirm/index.tsx` — `n`-clear gets a modeline entry (fixes silent no-op pain #8).
  - [ ] `src/renderables/scrollable-list.tsx` — uniform virtualized list, stable keys from domain IDs (no more `${index}` keys — fixes pain #12).
  - [ ] `src/utils/format-host-path.ts` — consolidated helper (fixes duplicate helpers pain #9).
  - [ ] `src/commands/register-results.ts` — all Results commands registered; gates (`hasConsole`, `hasNetwork`, `hasInsightDetails`, `hasToolEvents`) live on one derived memo that both the key handler and the modeline read (fixes drift pain #7).
  - [ ] Tests per screen: `tests/routes/results/results-screen.test.tsx` (at least a captureCharFrame on the healthy path), picker tests on navigation + selection happy paths.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test --filter cli-solid -- routes` green.
  - [ ] No file in `src/routes/` exceeds 250 LOC.
  - [ ] No `${index}`-style keys in any `<For>`.
  - [ ] Every screen's modeline entry corresponds to a live `enabled: true` command (same test harness as P1.T2).
  - [ ] `n` on CookieSyncConfirm shows in the modeline.
  - [ ] `ReportLoadError.cause` is rendered when a manifest fails to load (test: inject a failing `loadReportFn`, assert the cause string surfaces).
- **Tasks:**
  - **P3.T1 — Results split.** Decompose the 1691 LOC screen into the files listed in §3. Per-component tests. Keep overlay code paths empty (overlay wiring in P5). Diary `P3.T1-results-split.md`.
  - **P3.T2 — Pickers group A.** SavedFlowPicker + RecentReportsPicker + AgentPicker. Shares `register-picker-commons.ts` for ↑↓/jk navigation. Diary `P3.T2-pickers-a.md`.
  - **P3.T3 — Pickers group B.** PrPicker + PortPicker + CookieSyncConfirm. Port the search/filter state machines cleanly. Diary `P3.T3-pickers-b.md`.
  - **P3.T4 — Scrollable list + stable keys.** Shared primitive. All call sites migrated. No index keys survive. Diary `P3.T4-scrollable-list.md`.
- **Review lane:**
  - Skills to load: `/interface-craft`, `/vercel-react-best-practices` (for the "no manual memoization" spirit; adapt to Solid reactivity), `/global-patterns`.
  - Antagonistic focus: every `<For>` has a stable domain-ID key; Results screen has no dead-weight data reads (the insights/raw lines are NOT re-built every keypress); cookies `n`-clear regression test passes; `loadReportFn` failure surfaces real cause; pr-picker checkout-dialog IS a dialog.stack entry, not a local `confirmBranch` boolean.

### TUI-P4 — Streaming screens (Testing + Watch) + event store

- **Goal:** port Testing (collapsed + expanded + cancel) and Watch (phases + last-result + stop) using the replicated sync store from P2.
- **Blocked by:** TUI-P2.
- **Blocks:** TUI-P6.
- **Scope:**
  - [ ] `src/routes/testing/index.tsx` + subcomponents per §3. Collapsed view reads from derived signals of the sync store (active step, last 5 tool calls), NOT by re-walking events on every render.
  - [ ] `src/routes/testing/expanded-view.tsx` — `<scrollbox stickyScroll stickyStart="bottom">` with `<For each={toolCallRows()}>`. Snap-to-bottom via `scrollTo(scrollHeight)` imperative call on first expand.
  - [ ] `src/routes/testing/cancel-dialog.tsx` — proper dialog.stack entry, not an inline pseudo-modal.
  - [ ] `src/routes/watch/` — phase display, per-run step list, last-result chip. Adds a path from Watch → Results for completed runs (fixes pain in §1.3 / §11 item #15 — user can inspect metrics after a watch run).
  - [ ] `src/commands/register-testing.ts` + `src/commands/register-watch.ts`.
  - [ ] Agent message chunks (`AgentMessageChunk`) actually render in Testing (fixes §7 gap: "Agent messages (text chunks) are NOT rendered in Testing").
  - [ ] Tool-call argument expansion — press `enter` on a tool row in expanded mode to see full args/result (fixes §7: "Tool-call arguments are truncated at 80 chars ... No way to expand").
  - [ ] Elapsed-time timer is a single signal that only updates the footer, NOT a tree-wide re-render (fixes pain #22).
  - [ ] Tests: `tests/routes/testing/stream-reducer.test.ts` replays a recorded event stream of ≥ 100 events and asserts the resulting `ExecutedPerfPlan`-derived signals match the Ink TUI's output.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test --filter cli-solid -- routes/testing routes/watch` green.
  - [ ] Recorded-stream replay test: 100 events absorbed in < 1 second with no dropped frames (OpenTUI `targetFps` stays at 60 during replay).
  - [ ] Cancel dialog is a dialog-stack entry (asserted by test, not by inspection).
  - [ ] Watch → Results navigation works on run completion.
  - [ ] Agent message chunks render in Testing collapsed + expanded views.
- **Tasks:**
  - **P4.T1 — Testing collapsed view.** Derived signals from sync store; no per-render event walks. Diary `P4.T1-testing-collapsed.md`.
  - **P4.T2 — Testing expanded view + cancel dialog.** Sticky-bottom scrollbox; dialog.stack cancel. Tool-call drill-in via `enter`. Diary `P4.T2-testing-expanded.md`.
  - **P4.T3 — Watch.** Phase state machine; last-result chip; Watch → Results path. Diary `P4.T3-watch.md`.
  - **P4.T4 — Agent message chunks + elapsed-time perf fix.** Wire `AgentMessageChunk` into the sync reducer and the Testing render path. Extract elapsed time into its own signal. Diary `P4.T4-streaming-polish.md`.
- **Review lane:**
  - Skills to load: `/effect-services`, `/interface-craft`, `/runtime-review` (for the streaming perf claims), `/global-patterns`.
  - Antagonistic focus: stream reducer is a pure function (testable with synthetic events); no "expandedRows re-built per render" regressions (grep for any `.map(...)` in the render body that walks all events); cancel actually interrupts the Effect fiber via `Atom.Interrupt` (same mechanism as today at `testing-screen.tsx:593-595`); Watch's second `layerCli` (§1.3 pain) does NOT recur — Watch uses the single `cliAtomRuntime` from `context/runtime.tsx`.

### TUI-P5 — Overlays (insights, raw events, ask)

- **Goal:** land the three Results overlays on the dialog-stack primitive from P1.
- **Blocked by:** TUI-P1 (dialog stack), TUI-P3 (Results), TUI-P4 (streaming; the Ask panel streams).
- **Blocks:** TUI-P6.
- **Scope:**
  - [ ] `src/routes/results/insight-details-overlay.tsx` — dialog entry. Line array is memoized via `createMemo`; scroll offset bounded; no `${index}` keys.
  - [ ] `src/routes/results/raw-events-overlay.tsx` — dialog entry. Same memoization and keys rules. Drops the `<ErrorBoundary>` workaround from commit `02da3111` by fixing the root cause (unstable keys + stale offsets).
  - [ ] `src/routes/results/ask-overlay.tsx` — dialog entry. Ask-panel agent stream renders incrementally (fixes §7: "agent's streaming chunks accumulate into a single string but aren't shown incrementally"). Cancel-on-esc ACTUALLY cancels the fiber (fixes §7 + pain #14 — defer no longer).
  - [ ] Overlay state lives in the dialog stack. No local `useState` + `overlay` store double-write (fixes pain #2).
  - [ ] Overlay hints are automatic — each overlay's commands are registered scoped, and the modeline swaps via the command registry (not via the legacy `overlay` field from Zustand).
  - [ ] Tests: `tests/routes/results/overlays.test.tsx` — open each overlay, assert modeline updates, assert `esc` closes exactly the top overlay.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test --filter cli-solid -- overlays` green.
  - [ ] The `<ErrorBoundary>` wrap around Raw Events is removed; no scroll-crash reproduces with a 500-item event list and rapid `pgdn` spam (documented test fixture).
  - [ ] Ask panel `esc` cancels the fiber — test asserts the atom reports `Exit.Failure({ cause: Interrupt })` on esc press.
- **Tasks:**
  - **P5.T1 — Insight details overlay.** Memoized lines, domain-id keys, bounded scroll. Diary `P5.T1-insights-overlay.md`.
  - **P5.T2 — Raw events overlay.** Same treatment; explicit test fixture for the scroll-crash regression. Drop the ErrorBoundary workaround. Diary `P5.T2-raw-events-overlay.md`.
  - **P5.T3 — Ask overlay with live streaming + cancel.** Streaming chunks render; `esc` cancels. Answer history scrolls within the overlay. Diary `P5.T3-ask-overlay.md`.
- **Review lane:**
  - Skills to load: `/interface-craft`, `/effect-services`, `/runtime-review`.
  - Antagonistic focus: dialog stack ownership is single-source (no local `showX` boolean duplicates); stale scroll offsets are impossible (assert by test); Ask cancel actually interrupts; no new `ErrorBoundary` workarounds appear.

### TUI-P6 — Cutover

- **Goal:** flip the `perf-agent` binary to the Solid build, delete the Ink code, update docs, and confirm CI/distribution stay green on all platforms.
- **Blocked by:** TUI-P1..TUI-P5.
- **Blocks:** nothing — this is the last phase.
- **Scope:**
  - [ ] Rename `apps/cli-solid/` → `apps/cli/` (or, inverse: delete current `apps/cli/`, move solid in). Decision captured in `docs/handover/tui-rewrite/decisions/cutover-directory-strategy.md`.
  - [ ] `package.json` `bin.perf-agent` points to the Bun entry in the new package.
  - [ ] All Commander subcommands other than `tui` continue to work — regression test against the existing `tests/init.ts`, `tests/watch-notifications.ts`, etc. in `apps/cli/tests/` (which move into the new package).
  - [ ] Delete all code marked Ink-dependent in `apps/cli/`: `components/`, `stores/`, `hooks/use-scrollable-list.ts`, `hooks/use-stdout-dimensions.ts`, React Query hooks already migrated in P2.
  - [ ] Delete `react`, `ink`, `@tanstack/react-query`, `zustand`, `@effect-atom/react`, `ink-testing-library`, `ink-spinner`, `ink-text-input` from the workspace.
  - [ ] Update `README.md`, `CONTRIBUTING.md`, `PUBLISHING_GUIDE.md`. Dev-env docs now reference Bun.
  - [ ] CI updates: add macOS, Linux, Windows matrix for the new build. Pin a Bun version. Gate publish on all three passing.
  - [ ] Verify `.perf-agent/` directory contract is unchanged (reports, flows, manifests, logs).
  - [ ] Smoke test against every agent backend (claude, codex, copilot, gemini, cursor, opencode, droid, pi, local) on the maintainer's machine — tracked as a manual checklist, not automated.
- **Acceptance criteria:**
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test` green (repo-wide).
  - [ ] `pnpm build` produces a single distributable that runs on macOS, Linux, Windows (or documented distribution matrix if Bun single-binary isn't viable — tracked as open question in §7).
  - [ ] Feature-preservation checklist in §6 of this doc: every item verified manually by the phase lead.
  - [ ] No `react` / `ink` / `zustand` / `@tanstack/react-query` import remains anywhere in the repo (verified by grep).
  - [ ] CI runs green on Linux + macOS + Windows (Windows is allowed to be "best-effort" if §7 decision lands that way).
- **Tasks:**
  - **P6.T1 — Directory + binary flip.** Move `apps/cli-solid/` into place. Update `bin`. Update Turbo pipeline. Diary `P6.T1-cutover.md`.
  - **P6.T2 — Delete Ink code + dep prune.** Remove all React/Ink-era files; prune `package.json` deps. Diary `P6.T2-prune.md`.
  - **P6.T3 — Docs + CI matrix.** Update README, CONTRIBUTING, PUBLISHING_GUIDE. Add Linux/Windows CI lanes. Diary `P6.T3-docs-ci.md`.
  - **P6.T4 — Feature-preservation audit.** Tick every item from §6. Diary `P6.T4-preservation-audit.md`.
- **Review lane:**
  - Skills to load: `/global-patterns`, `/strict-critique`, `/code-review`.
  - Antagonistic focus: no Ink imports survive; `perf-agent` binary runs on at least Linux + macOS in CI; every non-`tui` subcommand still works; `.perf-agent/` on-disk contract is byte-identical; feature-preservation checklist is genuinely audited, not just ticked.

---

## 5. Data-layer integration contract

The Effect supervisor + atoms under `apps/cli/src/data/` (ported unchanged into `apps/cli-solid/` via workspace re-export in TUI-P2) define the contract the new TUI consumes. The contract:

### Atom → Solid signal

```
effect-atom Atom<A>            → Accessor<AsyncResult<A, never>>
effect-atom Atom<A, E>         → Accessor<AsyncResult<A, E>>
effect-atom AtomFn<In, Out>    → (input: In) => Promise<Exit<Out, UnknownError>>
```

Adapter location: `apps/cli-solid/src/adapters/effect-atom.ts`.

Rules:

- **No synchronous unwrap.** Every consumer uses `AsyncResult.builder(...)` from `src/adapters/async-result.ts`. Manual `AsyncResult.isSuccess` checks are banned (grep blocker in P2 acceptance).
- **Mutations trigger invalidation at the atom layer.** Fixing the `recentReportsAtom` + `useSavedFlows` stale-read class of bug (pain #3, #4) is a P2 deliverable, not a TUI concern. The TUI reads; the atoms refresh.
- **Batch coalescer:** updates within 16 ms collapse into one Solid `setStore` call. This is required to keep the streaming view at 60 FPS under the realistic worst case (30 events/sec sustained with bursts of ~10 events in a single 16 ms window).
- **Span annotations preserved.** Every atom call already annotates its span (`ask-report-atom.ts:259`, `recent-reports-atom.ts:16`, `execution-atom.ts:141`). The adapter must not swallow these. Our `.perf-agent/logs.md` debug workflow depends on them.

### Streaming event boundary

`executeFn.onUpdate(executedPlan)` today fires for every `ExecutionEvent` the supervisor emits. The Solid TUI subscribes via the sync store's event reducer. Event types (from `@neuve/shared`):

- `StepStarted`, `StepCompleted`, `StepFailed`, `StepSkipped`
- `ToolCall`, `ToolResult`, `ToolProgress`
- `AgentMessageChunk` (currently dropped — TUI-P4 must wire it)
- `ScreenshotCaptured` (currently dropped — pain #17)
- `RunCompleted`, `RunFailed`, `RunCancelled`

### Perf envelope

- Sustain: 30 events/sec for ≥ 60 seconds without dropped frames.
- Burst: 100 events in a single 200 ms window.
- Expanded view: 500 tool calls, rapid `pgdn` spam, no crashes (the regression that commit `02da3111` papered over with `<ErrorBoundary>` — must be genuinely fixed in P5.T2).

### Error parity

- `ErrorBoundary` at app root (OpenTUI/Solid primitive).
- `ErrorDisplay` renderable consumes Effect tagged errors (`_tag`, optional `displayName`, `message`, optional `cause`).
- `AsyncResult.builder().onFailure(cause => <ErrorDisplay cause={cause} />)` is the only blessed error-rendering path.
- No "generic string fallback that drops the cause" pattern (pain in §1.6). Reviewer MUST grep for string literals like `"Failed to "` and confirm each has a `cause` path.

---

## 6. Feature-preservation checklist

Every item below MUST work after TUI-P6. Phases that don't preserve the item they touch FAIL acceptance.

**Main menu**
- [ ] Describe-what-to-test prompt input (multiline, with persisted history accessible by `↑/↓` on single-line).
- [ ] Inline test-suggestion placeholder with `tab` to accept, `→/←` to cycle.
- [ ] `@`-triggered context picker: pick working-tree, any local branch, any remote PR branch, or a specific commit.
- [ ] Visible context chip above input showing the active context.
- [ ] "Changes detected" banner with file counts + ±added/removed when `gitState.hasUntestedChanges`.
- [ ] "Last run: url · time · status" banner when recent reports exist.
- [ ] Cookie-sync toggle (`ctrl+k`).
- [ ] Agent picker (`ctrl+a`).
- [ ] PR picker (`ctrl+p`).
- [ ] Watch mode (`ctrl+w`).
- [ ] Saved-flow picker (`ctrl+r`).
- [ ] Past-runs picker (`ctrl+f`, gated on reports existing — AND invalidating correctly, fixing pain #3).
- [ ] Auto-transitions to CookieSyncConfirm / PortPicker on missing URL/cookies.

**CookieSyncConfirm**
- [ ] Detected-browser list (Chrome, Firefox, Safari, Arc, Chrome Canary, …).
- [ ] Default-browser seed.
- [ ] Multi-select (`space`), `a` select-all, `n` clear-all — **`n` must appear in the modeline** (new requirement, fixes pain #8).
- [ ] Persist cookie-browser keys to project preferences.

**PortPicker**
- [ ] Listening-ports list with 5s refetch.
- [ ] Detected-projects list (framework + cwd + default port).
- [ ] Multi-select checkbox state.
- [ ] Free-form custom URL input.
- [ ] Skip option.
- [ ] Search `/`.
- [ ] Seed selection from `lastBaseUrl`.
- [ ] Propagate selected URLs + `devServerHints` to Testing.

**Testing**
- [ ] Live streamed agent session (tool calls, tool results, tool progress).
- [ ] Collapsed view: active step + last 5 tool calls with running indicator + streaming bytes/tokens.
- [ ] Expanded view (`ctrl+o`): scrollable list of all steps + tools + scroll keys + snap-to-bottom on first expand.
- [ ] Inline screenshot rendering.
- [ ] Cancel-confirmation on `esc` (`enter/y` stop, `esc/n` dismiss).
- [ ] `ctrl+n` toggle notifications.
- [ ] Auto-navigate to Results on completion.
- [ ] On failure, structured error render via `ErrorDisplay`.
- [ ] Analytics events emitted unchanged (`analysis:started`, `analysis:completed`, `analysis:failed`, `analysis:cancelled`).
- [ ] **New:** agent message chunks render (fixes gap).
- [ ] **New:** press `enter` on a tool row in expanded view to drill into full args/result.

**Watch**
- [ ] File-watching loop with phases (polling, settling, change-detected, assessing, running, idle, error).
- [ ] Idle-spinner cycling.
- [ ] Per-run step list during active run.
- [ ] Last-result chip (passed/failed) + run count.
- [ ] Stop-confirmation on `esc`.
- [ ] `ctrl+n` toggle notifications.
- [ ] Desktop notifications on completion/error.
- [ ] **New:** Watch → Results navigation on completion.

**Results**
- [ ] Status + icon + fallbacks for "no tools ran" / "tools ran but no trace".
- [ ] CWV metrics table per URL (LCP, FCP, CLS, INP, TTFB).
- [ ] Trace insight names list.
- [ ] Regressions panel.
- [ ] Console captures panel (summary + `c` expand).
- [ ] Network captures panel (summary + `n` expand).
- [ ] Insight-details drill-in (`i`) with scroll.
- [ ] Raw-events drill-in (`ctrl+o`) with scroll.
- [ ] Ask panel (`a`) with Q&A history.
- [ ] Copy report (`y`).
- [ ] Post to PR (`p`, gated on `Option.isSome(report.pullRequest)`).
- [ ] Save flow (`s`).
- [ ] Restart (`r`).
- [ ] Per-step status list with elapsed time.
- [ ] Total elapsed time.
- [ ] Report summary text.
- [ ] Video URL.
- [ ] Screenshot images.
- [ ] **New:** Ask panel streams incrementally + `esc` cancels the fiber.

**SavedFlowPicker**
- [ ] Scrollable list of saved flows (title, step-count, description).
- [ ] Select → re-run with instruction + cookie hints.

**RecentReportsPicker**
- [ ] Scrollable list of `ReportManifest`s (url, branch, status, relative time).
- [ ] Select → load `PerfReport` → Results.
- [ ] Error surface shows real `ReportLoadError.cause`.

**PR Picker**
- [ ] Remote branches with PR metadata.
- [ ] Filters: recent, all, open, draft, merged, no-pr.
- [ ] Search `/`.
- [ ] Select → `checkoutBranch(cwd, name)` → Main.
- [ ] Error surface on checkout failure.
- [ ] Cached appropriately.

**AgentPicker**
- [ ] Agent list with installed-marker.
- [ ] Writes to agent + preferences state (single source — fixes pain #23).
- [ ] Per-agent model list.
- [ ] **New:** group headers rendered (fixes silently-flattened groups).
- [ ] Current model marked with tick.

**Global**
- [ ] `ctrl+l` clear-and-repaint — **now with a palette entry** (hidden from modeline by default but discoverable via command palette).
- [ ] `ctrl+u` update CLI.
- [ ] Update-check banner.
- [ ] Alt-screen enter/exit correctness on every exit path.
- [ ] `NO_COLOR` honored.
- [ ] OSC 8 clickable file links.
- [ ] Inline images where supported.
- [ ] Analytics opt-in/opt-out at supervisor layer.
- [ ] `.perf-agent/logs.md` structured logs unchanged.

---

## 7. Open product decisions

_Restated verbatim from `opencode-tui-reference.md` §12 + new items that surface from the phase plan. Do NOT answer here — the user resolves on circle-back BEFORE TUI-P0 starts. Each item is a trade-off framing._

1. **Maturity of OpenTUI on non-macOS platforms.** Trade-off: committing Path A without first-hand Linux/Windows validation risks discovering blockers mid-phase. Cheap mitigation: a half-day spike running opencode locally on all three OSes before TUI-P0.

2. **OpenTUI API stability.** `@opentui/core` at 0.1.99 is pre-1.0. Trade-off: pin hard and eat churn during rewrite, or track latest and absorb breaking changes. Recommendation lane: pin to whatever opencode pins at TUI-P0 start.

3. **Zig toolchain dependency at install time.** Trade-off: if OpenTUI doesn't ship pre-built binaries for every triple we care about, users without Zig installed can't install `perf-agent`. Need first-hand confirmation of platform matrix coverage.

4. **60 FPS full-redraw vs Ink — is the perf benefit real for our workload?** Trade-off: Ink's bottleneck is Yoga + React reconciliation, not ANSI output. If our real workload (hundreds of tool calls + markdown streaming) is fine on Ink after fixing the audit pain points, Path A's perf argument collapses. This doc assumes "yes, it's worth it" — a 1-hour benchmark on the existing Ink TUI with `testing-screen.tsx` reset to not re-walk events per render would either confirm or invalidate the premise.

5. **Plugin system requirement.** Opencode invests ~27 KB in `TuiPluginRuntime` + slot registry. Do we ever want third-party TUI plugins? Trade-off: dropping from v1 saves a phase's worth of work; re-adding later requires another refactor.

6. **Mouse vs. copy-on-select.** Opencode flags `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`. Terminal mouse capture breaks native text-select. Trade-off: enable mouse (richer UX, breaks copy-paste) vs disable (keyboard-only like today).

7. **SSE vs. in-process event source.** This doc assumes in-process because our supervisor is in-process today. Confirm. Trade-off: in-process is simpler but locks us out of remote-supervisor scenarios; SSE/EventSource is future-proof but costs complexity and a 16ms batch coalescer boundary.

8. **Snapshot vs. behavioral TUI tests.** OpenTUI supports `captureCharFrame` snapshots. Opencode chose not to use them. Trade-off: snapshots catch visual regressions but are noisy; behavioral tests are lower-noise but miss layout bugs. This doc assumes behavioral-first with captureCharFrame only on healthy-path smoke.

9. **i18n / a11y / screen-reader support.** OpenTUI has no screen-reader story. Trade-off: if we need a11y for perf-agent, Path A blocks us on OpenTUI upstream work.

10. **Authoritative motivation for opencode's Go→OpenTUI migration.** We have secondary sources (grokipedia, commit messages) but no first-party-cited rationale. Minor risk: if the real reason was "maintainer preference" more than "perf", our Path A justification is shakier. Cheap mitigation: fetch PR #2685's body via a gh token that can read sst/opencode PRs.

**New items surfaced by the phase plan:**

11. **Binary-name collision during P6 cutover.** Trade-off: rename `apps/cli-solid/` → `apps/cli/` (clean but dangerous — git history split), OR delete `apps/cli/` and rename `apps/cli-solid/` into place (linear git history, risks a broken-main window). This doc leaves the decision to P6; needs a call before then.

12. **Environment variable renames.** The current TUI honors `NO_COLOR`. Opencode has `OPENCODE_DISABLE_MOUSE`, `OPENCODE_EXPERIMENTAL_MARKDOWN`, etc. Trade-off: mirror the opencode naming (`PERF_AGENT_DISABLE_MOUSE`, ...) or invent our own. Needs a naming decision + a compat shim for `NO_COLOR`.

13. **How do `.perf-agent/` artifacts surface in the new TUI?** Today, paths come through in toasts and the Results footer. Opencode's equivalent is the terminal-title effect. Do we want the new TUI to set the terminal title based on the active run (e.g. `perf-agent — testing homepage`)? Small UX feature with a small implementation cost.

14. **Bun + pnpm workspace coexistence policy.** This doc assumes pnpm stays as the monorepo tool and Bun is only used for the TUI's runtime. An alternative is full Bun workspaces. Trade-off: migrating packages/ to Bun affects CI, publish flow, `@neuve/supervisor` and the other packages. Probably out of scope for this rewrite but worth naming.

15. **zustand-persist storage format preservation.** The current `prompt-history` file stores `agentBackend`, `instructionHistory`, `notifications`, `modelPreferences`. If we write to a different file from P2 onwards, we lose user state across the TUI-P6 cutover. Decision: read-compat both files in P2, write to one, nuke the legacy file in P6 — OR just read/write the same file. Preferred: same file.

16. **React Query → Effect-atom vs createResource per hook.** P2.T4 punts this to a decision note. Open for the lead to set a house rule upfront (e.g. "if it's a long-lived subscription, it's an atom; if it's a one-shot fetch, it's createResource").

---

## 8. Risk register

| Risk | Impact | Mitigation | Trigger to re-evaluate |
|---|---|---|---|
| OpenTUI 0.1.99 pre-1.0 API churn breaks builds | Rewrite stalls or requires rework mid-phase | Pin `@opentui/core`/`@opentui/solid` exactly; treat updates as opt-in; maintain a `docs/handover/tui-rewrite/opentui-versions.md` log | A pinned upgrade breaks more than one screen, or upstream releases 1.0 |
| Zig toolchain / native addon install fails on Linux or Windows | Distribution broken for a user segment | Confirm pre-built binaries in TUI-P0; add a `postinstall` probe that fails loud; publish per-platform tarballs in P6 | Any CI matrix run fails to install |
| Effect↔Solid reactive boundary fights fiber lifecycle | Streaming perf regresses, cancellation breaks | Isolate the adapter behind a single file (`src/adapters/effect-atom.ts`) with its own test suite; 16ms batch coalescer modeled on opencode; if the adapter can't hit the perf envelope in §5, surface as open question before P4 starts | Adapter test fails perf envelope, or any Atom.Interrupt scenario deadlocks |
| Perf target (30 events/sec sustained, 100-event burst) not met by full-redraw model | Testing/Watch feel sluggish; user-facing regression | Build a recorded-event replay fixture in P4.T1 that runs as a perf test; if it fails, fall back to `<Static>` equivalents for completed steps and only stream the active step | Perf test fails in P4 |
| Snapshot tests (if we take that path in §7 item 8) churn noisily and slow reviews | Merge friction; ignored test runs | Keep snapshots to healthy-path smoke only; reject any PR that adds a snapshot diff without a matching behavioral assertion | Any review cycle cites "snapshot noise" |
| Multi-platform binary distribution doesn't match Node+Ink parity | Users lose install ergonomics | Decide between `bun build --compile` per-platform, or keep `npm install`-style JS distribution and require `bun` installed. Document in `PUBLISHING_GUIDE.md` update in P6.T3 | P6.T3 can't make all three OS targets green |
| `recentReportsAtom` + `useSavedFlows` stale-read fixes leak into supervisor scope | P2 scope creep blocks other phases | Scope the fix to the atom layer in `apps/cli/src/data/*` only; if it needs supervisor changes, escalate | Fix requires touching `packages/supervisor/` |
| Agent message chunks (today dropped) break existing analytics when wired in | Misreported analysis:completed counts | Analytics live in `execution-atom.ts` — verify P4.T4 doesn't alter analytics call sites; add a test on the analytics events emitted per synthetic stream | P4.T4 review surfaces a delta in analytics events |
| Mixed pnpm + Bun dependency resolution yields two different `effect` versions | Subtle runtime bugs, type errors across workspace | Enforce single version via `"overrides"` in root `package.json`; add a CI check that resolves `effect` from both `apps/cli-solid/` and `packages/supervisor/` and compares | Build or tsc flags a version drift |
| Cutover in P6 leaves the repo in a broken-main state between rename and bin flip | Distribution broken mid-flight | Land P6.T1+T2 in a single merged PR; require P6.T4 audit PASS before publishing any npm version | P6.T1 merges without P6.T2 ready |
| OpenTUI lacks a feature we rely on (mouse selection, OSC 8 link fallback, inline image terminals beyond iTerm2) | Feature-preservation regression | Each such gap becomes an open question item at the time of discovery; not all of §6 is guaranteed portable | Any §6 item can't be delivered natively |
| Reviewer backlog on per-phase reviews under strict-critique | Phases pipeline poorly | Budget reviewer time upfront per §4; any REQUEST_CHANGES blocks dismissal of the implementer per team-orchestration SKILL | A single phase has > 2 review rounds |

---

## 9. Definition of done (whole rewrite)

The rewrite is "done" at the repo level when all of the following hold:

- [ ] All seven phases have a passing final review (`APPROVE` verdict on every phase's review file in `docs/handover/tui-rewrite/reviews/`).
- [ ] `pnpm typecheck` green repo-wide.
- [ ] `pnpm test` green repo-wide.
- [ ] `pnpm build` green repo-wide, producing the `perf-agent` binary.
- [ ] Every item in §6 (Feature-preservation checklist) is ticked, with a note in `P6.T4-preservation-audit.md` for any item that required a deliberate behavior change.
- [ ] Zero imports of `react`, `ink`, `ink-*`, `zustand`, `@tanstack/react-query`, `@effect-atom/react` survive in the repo (verified by grep in P6.T2).
- [ ] CI runs green on macOS and Linux. Windows is green OR formally deferred per §7 item 1, with the deferral documented in `docs/handover/tui-rewrite/decisions/windows-support.md`.
- [ ] `README.md`, `CONTRIBUTING.md`, `PUBLISHING_GUIDE.md` reflect the new stack (Bun, OpenTUI, SolidJS).
- [ ] `.perf-agent/` on-disk contract unchanged — verified by running the Ink TUI and the new TUI side-by-side against the same project and diffing their artifacts.
- [ ] The review gate for TUI-P6 is signed off by a separate reviewer instance per the strict-critique skill.
- [ ] All open questions in §7 either have a recorded decision in `docs/handover/tui-rewrite/decisions/` or are explicitly deferred with a ticket link.

---

## 10. How to use this doc on circle-back

A future lead arriving at this doc cold should:

1. **Re-read §4 (phase plan) and §8 (risk register)** — these are the operational spine. Skim everything else as needed.
2. **Resolve the open questions in §7 with the user** — at minimum items 1, 4, 14, 15 must be answered before TUI-P0 starts. The other items can be resolved as they become blockers.
3. **Load the two skills**: `/team-orchestration` and `/strict-critique`. These govern how you spawn engineers and reviewers.
4. **Spawn the implementing engineer for TUI-P0** using the task seed prompt composed from §4's P0 subsection. Hand them this doc's path and `current-tui-inventory.md` + `opencode-tui-reference.md` as required reading. Acceptance criteria come from §4.
5. **Spawn the reviewer for TUI-P0** with `docs/handover/tui-rewrite/review-system-prompt.md` (authored in P0.T3), the skills listed in P0's review lane, and the antagonistic directive verbatim from the strict-critique skill. Do not dismiss the implementer until the review is APPROVED.
