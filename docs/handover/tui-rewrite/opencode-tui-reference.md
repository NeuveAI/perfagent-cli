# opencode TUI — Reference Architecture

Research counterpart to `tui-auditor-current`. Target: reference data for a
scoping decision on whether (and how) to port patterns from sst/opencode into
perfagent-cli's TUI.

Pin commit used for all file links:
`9640d889baa58fa01ed612a6372ba77462f79d9f` on branch `dev` (default branch).
File permalinks in this document use that SHA.

## 1. Repo state as of today (2026-04-15)

- Repo: `github.com/sst/opencode`. Default branch: `dev` (not `main`).
- Last commit on `dev`: `9640d889baa58fa01ed612a6372ba77462f79d9f` —
  "fix: register OTel context manager so AI SDK spans thread into Effect traces (#22645)"
  (2026-04-15T16:35:14Z).
- GitHub API `languages`: TypeScript 10.7 MB, MDX 7.1 MB, CSS 545 KB, Rust 87 KB,
  Astro 31 KB, JS 23 KB, Shell 22 KB. **No Go.** (Go + Bubbletea was deleted on
  2025-11-02 commit `f68374a` — message literally "DELETE GO BUBBLETEA CRAP HOORAY".
  OpenTUI-based Solid rewrite landed 2025-10-31 in PR #2685 "OpenTUI is here".)
- Monorepo layout (`packages/`): `opencode`, `app`, `web`, `desktop`, `server`,
  `sdk`, `plugin`, `ui` (shared component lib, not the TUI), `console`, etc.
  Bun + Turbo + pnpm-style workspaces (uses `bun.lock`).
- The **TUI lives inside the CLI package**, not a separate package:
  `packages/opencode/src/cli/cmd/tui/` — 135 files, ~1.84 MB of TS/TSX, rough
  ceiling of ~55k LOC (size/33 bytes-per-line heuristic; the 15 largest files
  alone account for ~353 KB).
- Top-15 largest TUI files (bytes, from the pinned tree):
  - 74 903 `routes/session/index.tsx`
  - 43 298 `component/prompt/index.tsx`
  - 30 761 `context/theme.tsx`
  - 27 828 `plugin/runtime.ts`
  - 25 449 `app.tsx`
  - 22 940 `routes/session/permission.tsx`
  - 20 990 `component/prompt/autocomplete.tsx`
  - 18 814 `component/logo.tsx`
  - 17 622 `context/sync.tsx`
  - 15 782 `routes/session/question.tsx`
  - 14 442 `ui/dialog-select.tsx`
  - 13 422 `context/local.tsx`
  - 12 412 `ui/spinner.ts`
  - 11 572 `component/dialog-provider.tsx`
  - 10 571 `feature-plugins/home/tips-view.tsx`
- Key dependencies (from `packages/opencode/package.json` at the pinned SHA):
  `@opentui/core` 0.1.99, `@opentui/solid` 0.1.99, `solid-js` (JSX), `effect`
  (catalog), `@effect/opentelemetry`, `@effect/platform-node`, `@lydell/node-pty`,
  `bun-pty` 0.4.8, `@hono/node-ws`, `@hono/node-server`, `@opencode-ai/sdk/v2`,
  `semver`, `open`, `diff`, `strip-ansi`, `remeda`. **No React, no Ink.**
- Related upstream repo: `github.com/anomalyco/opentui` (default branch `main`,
  language: TypeScript with Zig core; subpackages `core`, `react`, `solid`,
  `web`). opencode consumes `@opentui/core` and `@opentui/solid` only.

Reference directory permalinks:
- https://github.com/sst/opencode/tree/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui
- https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/app.tsx
- https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/package.json

## 2. TUI stack

- **Rendering library:** `@opentui/solid` (SolidJS reconciler) running on top
  of `@opentui/core`.
- **Language:** TypeScript with JSX (`@jsxImportSource @opentui/solid`).
  SolidJS reactive primitives (`createSignal`, `createMemo`, `createEffect`,
  `createStore`, `batch`, `Switch`/`Match`/`For`/`Show`, `Dynamic`).
- **Runtime:** Bun. `bun-pty` / `@lydell/node-pty` for nested terminal features.
- **Core implementation of OpenTUI itself:** Zig with a C ABI and TypeScript
  FFI bindings. See `github.com/anomalyco/opentui` packages: `core` (Zig +
  TS), `react`, `solid`, `web`. Relevant source files:
  `packages/core/src/renderer.ts`, `packages/core/src/renderables/*`,
  `packages/core/src/buffer.ts`, `packages/core/src/text-buffer.ts`.
- **Process model:** **Single process.** The TUI and the opencode HTTP server
  can run in the same Bun process; the TUI talks to the server via the
  `@opencode-ai/sdk/v2` client over REST + SSE (`sdk.global.event({ signal })`
  in `context/sdk.tsx`). A custom `EventSource` can be injected via props,
  enabling intra-process "events" to bypass the network. There is no
  Go-process/IPC split anymore.
- **Terminal handling** (from `app.tsx` + opentui `renderer.ts`):
  - Alt screen: `lib.setupTerminal(rendererPtr, useAlternateScreen)`,
    `applyScreenMode("alternate-screen" | "main-screen" | "split-footer")`.
  - Kitty keyboard protocol: `buildKittyKeyboardFlags({ disambiguate,
    alternateKeys })`, `lib.setKittyKeyboardFlags(...)`; configured in
    `rendererConfig` with `useKittyKeyboard: {}`.
  - Mouse: opt-in via `useMouse: mouseEnabled` (gated on
    `Flag.OPENCODE_DISABLE_MOUSE` and `config.mouse ?? true`).
  - Paste: detected by `StdinParser` and forwarded to
    `_keyHandler.processPaste(bytes, metadata)`.
  - Resize: debounced ~100 ms `handleResize` → `processResize` → emits
    `RESIZE` event; Solid reads dimensions via `useTerminalDimensions()`.
  - Windows: dedicated `win32InstallCtrlCGuard()` and
    `win32DisableProcessedInput()` shims in `tui/win32.ts`.
  - Suspend: `renderer.suspend()` + `process.kill(0, "SIGTSTP")` with
    `SIGCONT` → `renderer.resume()` (command `terminal.suspend`).
  - Title: `renderer.setTerminalTitle(...)` driven by a `createEffect`
    watching route/session.
- **Before/after motivation:** The prior stack was Go + Bubbletea, called
  from a TypeScript core via IPC. Migration PR #2685 ("OpenTUI is here",
  2025-10-31) flipped the TUI into the same Bun process using OpenTUI.
  Motivation, per grokipedia/wiki summaries of the migration (the PR body
  itself is public-restricted in API but the commit message and subsequent
  deletion PR make the direction clear): unify the stack on TypeScript,
  remove IPC overhead, use OpenTUI's Zig core for faster rendering, and keep
  Solid's fine-grained reactivity as the reconciler. The Nov 2 commit
  message `f68374a` deleted the Go tree outright.

## 3. Rendering model

- **Widget tree via JSX.** OpenTUI exposes renderable primitives as JSX
  elements: `box`, `text`, `span`, `scrollbox`, `code`, `markdown`. These
  correspond to classes in
  `opentui/packages/core/src/renderables/{Box,Text,ScrollBox,Code,Markdown,
  FrameBuffer,Input,Select,Textarea,TextTable,...}.ts`.
- **Layout:** Flexbox (`flexDirection`, `flexGrow`, `justifyContent`, `gap`,
  `alignItems`, `padding*`, `margin*`). Absolute positioning supported
  (`position="absolute"`, `top/right/bottom/left`). Example in `app.tsx`:
  full-screen `<box width={dimensions().width} height={dimensions().height}
  backgroundColor={theme.background}>`.
- **Rendering strategy:** **Full-redraw per frame** to a back buffer, then a
  native swap. `renderer.ts` keeps a dual-buffer pair (`nextRenderBuffer`,
  `currentRenderBuffer`); every frame calls
  `this.root.render(this.nextRenderBuffer, deltaTime)` and the Zig side
  swaps. There is no damage-rectangle reconciler at the JS layer; instead,
  Solid's fine-grained reactivity minimizes the *tree mutations* that feed
  into the per-frame render. `targetFps` is 60 in opencode's
  `rendererConfig`.
- **Hit grid** regenerated each frame for mouse tracking; hover/drag state
  flows through `processSingleMouseEvent()` with a `capturedRenderable` for
  drag capture.
- **Virtualization / scrolling:** `<scrollbox>` = `ScrollBoxRenderable` (from
  `@opentui/core`). opencode uses it as the messages viewport in
  `routes/session/index.tsx`:
  ```tsx
  <scrollbox
    ref={(r) => (scroll = r)}
    viewportOptions={{ paddingRight: showScrollbar() ? 1 : 0 }}
    verticalScrollbarOptions={{
      paddingLeft: 1,
      visible: showScrollbar(),
      trackOptions: { backgroundColor: theme.backgroundElement,
                      foregroundColor: theme.border },
    }}
    stickyScroll={true}
    stickyStart="bottom"
    flexGrow={1}
    scrollAcceleration={scrollAcceleration()}
  >
    <For each={messages()}>{(message, index) => ... }</For>
  </scrollbox>
  ```
  `scrollbox` exposes an imperative API: `scrollTo(y)`, `scrollBy(dy)`,
  `scrollHeight`, `y`, `height`, `getChildren()`. Message navigation
  (`next/prev message`, `first/last`, `jump to last user`) is implemented
  via `scroll.getChildren()` iteration + targeted `scrollBy` calls
  (`session/index.tsx:218-279`).
- **Text rendering:** `<text>` (single-style line or wrapped lines) with
  inline `<span style={{ fg, bg, bold }}>`. `<code filetype="markdown"
  streaming={true} syntaxStyle={syntax()} content={...}/>` and
  `<markdown>` (experimental behind `Flag.OPENCODE_EXPERIMENTAL_MARKDOWN`)
  are specialized renderables with tree-sitter-backed highlighting and a
  `streaming` prop that keeps partial trees stable while new tokens arrive.
- **No custom reconciler in opencode itself** — they consume the
  `@opentui/solid` reconciler. The imperative escape hatches are
  `renderer.setTerminalTitle`, `renderer.clearSelection()`,
  `renderer.getSelection()`, `renderer.toggleDebugOverlay()`,
  `renderer.console.toggle()`, `renderer.currentFocusedRenderable`.
- **Partial vs full redraw:** There is no partial-redraw path at the app
  level. The Zig core is fast enough that opencode relies on 60 Hz
  full-frames.

Receipts:
- `packages/opencode/src/cli/cmd/tui/app.tsx` (lines ~70-95 `rendererConfig`,
  ~530-580 top-level `<box>` shell with `TimeToFirstDraw`).
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (lines
  ~1060-1178 scrollbox + `For` messages; ~1476-1508 `TextPart` using
  `<code streaming={true}>`; ~1443-1473 `ReasoningPart` same).
- `anomalyco/opentui/packages/core/src/renderer.ts` — dual buffer,
  full-frame, hit grid, stdin parser, setup terminal, setKittyKeyboardFlags.

## 4. State management

- **Central Solid stores + context providers.** Deep provider tree in
  `app.tsx` (outer-to-inner):
  `ErrorBoundary → Args → Exit → KV → Toast → Route → TuiConfig → SDK →
  Project → Sync → Theme → Local → Keybind → PromptStash → Dialog →
  Command → Frecency → PromptHistory → PromptRef → App`.
- **`context/sync.tsx` is the single source of truth for server-replicated
  state.** It holds a `createStore` with shape:
  ```ts
  {
    status: "loading" | "partial" | "complete"
    provider: Provider[]
    agent: Agent[]
    session: Session[]
    message: { [sessionID: string]: Message[] }
    part: { [messageID: string]: Part[] }   // <-- streaming target
    permission: { [sessionID: string]: PermissionRequest[] }
    question: { [sessionID: string]: QuestionRequest[] }
    // plus command, lsp, mcp, formatter, vcs, config, console_state, ...
  }
  ```
  Updates flow from `context/sdk.tsx`:
  ```ts
  const events = await sdk.global.event({ signal: ctrl.signal })
  for await (const event of events.stream) {
    if (ctrl.signal.aborted) break
    handleEvent(event)
  }
  ```
  `handleEvent` queues events and flushes within a ~16 ms window inside
  `batch(() => ...)` so bursts of SSE messages produce a single Solid
  reactive update. A custom `EventSource` can be passed via props to
  replace SSE entirely (`props.events?.subscribe(handleEvent)`).
- **Streaming mechanics** (verbatim from `sync.tsx`):
  ```ts
  case "message.part.delta": {
    const parts = store.part[event.properties.messageID]
    if (!parts) break
    const result = Binary.search(parts, event.properties.partID, (p) => p.id)
    if (!result.found) break
    setStore("part", event.properties.messageID, produce((draft) => {
      const part = draft[result.index]
      const field = event.properties.field as keyof typeof part
      const existing = part[field] as string | undefined
      ;(part[field] as string) = (existing ?? "") + event.properties.delta
    }))
    break
  }

  case "message.part.updated": {
    const parts = store.part[event.properties.part.messageID]
    if (!parts) {
      setStore("part", event.properties.part.messageID,
               [event.properties.part])
      break
    }
    const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
    if (result.found) {
      setStore("part", event.properties.part.messageID, result.index,
               reconcile(event.properties.part))
      break
    }
    setStore("part", event.properties.part.messageID, produce((draft) => {
      draft.splice(result.index, 0, event.properties.part)
    }))
    break
  }
  ```
  Primitives: `createStore` (reactive), `produce` (Immer-like draft),
  `reconcile` (deep structural diff keyed by id), `batch` (coalesce), binary
  search for in-order insert — everything is O(log n) per delta.
- **Per-view state** uses plain `createSignal`/`createMemo` (e.g. hover, sidebar
  open, expanded code output, `scroll` ref).
- **Persistent preferences** live in `context/kv.tsx` — `kv.signal(key,
  default)` returns a `[getter, setter]` pair backed by disk (used for
  `thinking_visibility`, `tool_details_visibility`, `sidebar`, `timestamps`,
  `animations_enabled`, `diff_wrap_mode`, `terminal_title_enabled`, etc.).
- **Long-running tasks emitting progress:** modeled as server-side
  mutations that emit `session.status`, `message.part.delta`,
  `message.part.updated`, `installation.update-available`,
  `session.deleted`, `session.error`. The UI is a pure function of the
  replicated `sync.data` store plus ephemeral event reactions. Example
  reaction (`app.tsx`):
  ```ts
  event.on("installation.update-available", async (evt) => { ... })
  event.on("session.error", (evt) => toast.show({ variant: "error", ... }))
  ```
- **Event bus:** `context/event.tsx` exposes an `event.on(type, handler)`
  API over the same SSE stream; also used for imperative app events
  (`TuiEvent.ToastShow`, `TuiEvent.CommandExecute`, `TuiEvent.SessionSelect`).
- **No Effect-TS in the TUI layer.** `effect` is in dependencies for the
  server/SDK layer, but the TUI code uses plain Solid + SDK promises. Error
  surfacing uses `toast.show({ variant: "error", message })` + a top-level
  `<ErrorBoundary>`.

Receipts:
- `context/sync.tsx` (full file, 17 622 bytes) — store shape, event
  reducer, binary search, produce/reconcile.
- `context/sdk.tsx` (2 928 bytes) — `sdk.global.event({ signal })` loop,
  `createGlobalEmitter`, 16 ms batched flush.
- `context/event.tsx`, `context/kv.tsx`, `context/local.tsx` — derived
  state layers.

## 5. Screen/navigation model

- **Routes** are a discriminated union stored in a Solid store:
  ```ts
  type Route =
    | { type: "home"; initialPrompt?: PromptInfo }
    | { type: "session"; sessionID: string; initialPrompt?: PromptInfo }
    | { type: "plugin"; id: string; data?: Record<string, unknown> }
  ```
  `context/route.tsx` exposes `{ data, navigate(route) }`. `useRouteData<T>`
  narrows to a route variant with a runtime assertion.
- **Top-level render** is a `<Switch><Match when={route.data.type === "home"}>
  <Home/></Match><Match when={route.data.type === "session"}><Session/>
  </Match></Switch>` inside `app.tsx`. Plugin routes render via
  `routes.get(name)?.at(-1)?.render`.
- **Overlays = dialog stack.** `ui/dialog.tsx` owns a Solid store:
  ```ts
  const [store, setStore] = createStore({
    stack: [] as { element: JSX.Element; onClose?: () => void }[]
  })
  ```
  - `dialog.replace(() => <X/>)` stores current focused renderable, clears
    the stack, pushes new.
  - `dialog.clear()` runs all `onClose` callbacks, empties the stack,
    restores focus via `refocus()`.
  - Only the topmost dialog renders: `value.stack.at(-1)!.element`.
  - Dialog-scoped `useKeyboard`:
    ```ts
    useKeyboard((evt) => {
      if (store.stack.length === 0) return
      // esc/ctrl+c → pop
    })
    ```
  - Individual dialogs add their own `useKeyboard` handlers that are also
    gated by "am I on top of the stack?" semantics.
- **Nested modals** are handled by dialogs calling
  `dialog.replace(() => <Next/>)` to swap (the common case, e.g. selecting
  an agent replaces the command palette) or pushing via the stack API.
- **Command palette** (`component/dialog-command.tsx`) is just a dialog that
  iterates an array of `CommandOption` registered from anywhere (via
  `command.register(() => [ ... ])`). Its `useKeyboard` matches keybinds
  only when `dialog.stack.length === 0` — this is how the command palette
  keybinds disable themselves while another dialog is open.
- **Keybinding scope** is therefore layered:
  - **Global** — `App.useKeyboard` (selection copy / esc clear selection).
  - **Route-local** — `Session.useKeyboard` (e.g. only active when in child
    session).
  - **Dialog-local** — `useKeyboard` inside the dialog component; caller
    gates `if (dialog.stack.length === 0) return` (command palette) or the
    opposite (dialog handlers).
  - **Component-local** — `<Prompt>` textarea has its own `<Input>`
    renderable with internal key handling.

Receipts:
- `context/route.tsx` (1 142 bytes) — route union + `useRouteData`.
- `ui/dialog.tsx` — stack, replace/clear/push, refocus, esc/ctrl+c gate.
- `component/dialog-command.tsx` (first ~80 lines) — suspend counter,
  keybind gating, `command.trigger(value)` imperative API.
- `app.tsx` lines ~475-505 — the master `<Switch>` for home/session/plugin.

## 6. Input handling

- **Key dispatcher** is layered via `useKeyboard` hooks from
  `@opentui/solid`. Every component that cares about keys installs one. The
  Solid reconciler routes each `ParsedKey` event through all live handlers;
  gating is cooperative (`if (dialog.stack.length > 0) return` etc.).
- **Keybind configuration** is name-based (`TuiConfig.keybinds`), parsed
  once into `Keybind.Info[]`. `context/keybind.tsx` exposes:
  ```ts
  {
    get all(): Record<string, Keybind.Info[]>
    get leader(): boolean
    parse(evt: ParsedKey): Keybind.Info
    match(key: string, evt: ParsedKey): boolean
    print(key: string): string   // human-readable, substitutes <leader>
  }
  ```
  - **Leader key** is a vim-style prefix: matching the leader binding
    blurs the focused renderable, sets a 2000 ms timeout, and waits for
    the next key; any key clears the leader state.
  - Workaround for Ctrl+_:
    `if (evt.name === "\x1F") { return Keybind.fromParsedKey({ ...evt,
    name: "_", ctrl: true }, store.leader) }`.
- **Affordance ↔ key coupling (the "silent no-op" fix).** opencode
  couples commands and their keybinds via a **single object**:
  ```ts
  {
    title: "Switch session",
    value: "session.list",
    keybind: "session_list",
    category: "Session",
    suggested: sync.data.session.length > 0,
    slash: { name: "sessions", aliases: ["resume", "continue"] },
    onSelect: () => dialog.replace(() => <DialogSessionList />),
  }
  ```
  Registered via `command.register(() => [ ...array ])`. The command
  palette uses `keybind.print(option.keybind)` as the footer so the
  visible affordance *always* shows the active binding. The palette's
  global `useKeyboard` iterates the same list and calls `option.onSelect`,
  so **a command either has an entry (and thus a visible affordance) or it
  doesn't exist**. No orphaned keybindings.
- **Slash commands** share the same array (`slash: { name, aliases }`),
  so `/help`, `/exit`, `/sessions` etc. are the same options surfaced
  through the prompt with identical `onSelect`.
- **Hidden commands** use `hidden: true` (still trigger via keybind, don't
  clutter the palette, e.g. `messages_page_down`). `enabled: false` and
  `disabled: true` are distinct — `enabled` gates key handling entirely,
  `disabled` greys out palette entry.
- **Imperative trigger**: `command.trigger("session.share")` programmatic
  (used by `TuiEvent.CommandExecute`).

Receipts:
- `context/keybind.tsx` (full file, quoted above).
- `component/dialog-command.tsx` lines 1-90 — `CommandOption` type,
  global `useKeyboard`, `command.trigger`.
- `app.tsx` lines ~220-470 — the master `command.register(() => [ ... ])`
  with ~40 commands. Each entry has `title`, `value`, `keybind?`,
  `slash?`, `category`, `onSelect`, optional `suggested`, `hidden`,
  `enabled`.
- `ui/dialog-help.tsx` — demonstrates the pattern: the help dialog text
  reads `"Press ${keybind.print("command_list")} to see all available
  actions and commands in any context."` The rendered string is always
  in sync with the actual binding.

## 7. Streaming / agent output UX

- **Message timeline** is a single `<scrollbox stickyScroll={true}
  stickyStart="bottom">` with a `<For each={messages()}>` that renders
  either a `<UserMessage>` or an `<AssistantMessage>` per row. Each row is
  identified by `id={message.id}` so the scroll helpers can find it by
  message id (`getChildren().find((c) => c.id === id)`).
- **AssistantMessage** iterates `parts` and `<Dynamic component={...}
  part={...} message={...}>` with a mapping:
  ```ts
  const PART_MAPPING = {
    text: TextPart,
    tool: ToolPart,
    reasoning: ReasoningPart,
  }
  ```
  - **`TextPart`** renders via `<code filetype="markdown"
    drawUnstyledText={false} streaming={true} syntaxStyle={syntax()}
    content={text.trim()} conceal={ctx.conceal()} fg={theme.text}/>`. The
    `streaming={true}` flag tells the markdown/code renderable to keep
    partial trees stable while deltas arrive (no flicker between tokens).
    An experimental `<markdown>` renderable path exists behind
    `Flag.OPENCODE_EXPERIMENTAL_MARKDOWN`.
  - **`ReasoningPart`** is the same shape, dimmed, filtered for
    `"[REDACTED]"` (OpenRouter encrypted reasoning), hidden unless
    `showThinking()` is on.
  - **`ToolPart`** dispatches on `part.tool` to per-tool components:
    `Bash`, `Glob`, `Read`, `Grep`, `List`, `WebFetch`, `CodeSearch`,
    `WebSearch`, `Write`, `Edit`, `Task`, `ApplyPatch`, `TodoWrite`,
    `Question`, `Skill`, default `GenericTool`. Each tool renders its own
    per-status affordance.
- **Tool presentation primitives:** `InlineTool` (one line with icon +
  pending/complete text + spinner fallback) and `BlockTool` (bordered
  block with title, body, optional click-to-expand). `InlineTool` shows:
  - fallback pending line (`~ Writing command...`);
  - completed icon + body;
  - strike-through when permission was denied
    (`TextAttributes.STRIKETHROUGH`);
  - red error body below when
    `part.state.status === "error"` and not a known "denied" cause.
  - `Spinner` renderable when `spinner` prop is true.
- **Running status** comes from `part.state.status === "running" |
  "pending" | "completed" | "error"`. The session has a
  `pending = messages().findLast(x => x.role === "assistant" &&
  !x.time.completed)?.id` memo that drives a bottom-bar spinner.
- **Footer** displays model + mode + duration + "interrupted" when
  `message.error.name === "MessageAbortedError"`, rendered unconditionally
  below the last message so the user always has a receipt that the turn
  ended.
- **Permissions inline:** when the agent requests a permission
  (`sync.data.permission[sessionID]`), the entire prompt area switches to
  a `<PermissionPrompt>` (the `Prompt` component is hidden) — a hard
  modal at the bottom of the screen. Similarly `QuestionPrompt` for
  agent questions. This is the pattern for "long-running task that needs
  human input": flip the composer out for a scoped modal.
- **Error surfacing** is multi-layer:
  - `<ErrorBoundary fallback={(error, reset) => <ErrorComponent .../>}>`
    at the top of `app.tsx` for unrecoverable UI crashes.
  - `event.on("session.error", ...)` → `toast.show({ variant: "error",
    message: errorMessage(evt.properties.error), duration: 5000 })`.
  - Per-message error box rendered inside `AssistantMessage` when
    `message.error && message.error.name !== "MessageAbortedError"`.
  - Per-tool error in `InlineTool` / `BlockTool`.
  - Toast is a first-class provider (`ui/toast.tsx`); every side effect
    path has a toast-friendly error handler.

Receipts:
- `routes/session/index.tsx` lines ~1060-1178 (scrollbox + For),
  ~1346-1435 (`AssistantMessage` + footer),
  ~1437-1508 (`PART_MAPPING`, `TextPart`, `ReasoningPart`),
  ~1512-1600 (`ToolPart` switch), ~1610-1738 (`GenericTool`,
  `InlineTool`), ~1740-1786 (`BlockTool`).
- `ui/toast.tsx` (toast provider).
- `component/error-component.tsx` + `<ErrorBoundary>` usage in `app.tsx`.

## 8. Theming & typography

- **Themes** are JSON files under
  `packages/opencode/src/cli/cmd/tui/context/theme/` — 33 presets
  (tokyonight, nord, gruvbox, rosepine, dracula, etc.). Schema
  (`context/theme.tsx`, 30 761 bytes):
  ```ts
  type ThemeJson = {
    defs?: Record<string, string | { dark: string; light: string }>
    theme: Record<string, string | { dark: string; light: string }>
    selectedListItemText?: string
    backgroundMenu?: string
    thinkingOpacity?: number
  }
  ```
- **Resolution priority:** default themes < plugin themes < custom files <
  generated system theme. System theme is synthesized from
  `renderer.getPalette({ size: 16 })` — opencode reads the user's
  terminal 16 ANSI colors at startup and builds a theme from them.
  `ansiToRgba(code)` handles 0-15 + 16-231 cube + 232-255 grayscale ramp.
- **Light/dark** is driven by `Terminal.getTerminalBackgroundColor()` (OSC
  11 probe) in `app.tsx` before first render, plus a `mode` signal the user
  can override and optionally `lock` / `unlock`. Runtime mode changes come
  via `CliRenderEvents.THEME_MODE`.
- **Contrast/accessibility:** `selectedForeground(theme, bg)` picks
  `black | white` by luminance > 0.5; muted text colors are computed from
  the background luminance too. There is no explicit high-contrast theme
  variant and no truecolor capability detection — the renderer assumes the
  terminal can render RGBA. Theme JSON can specify RGBA ints directly
  (e.g. the modal backdrop `RGBA.fromInts(0, 0, 0, 70)` in
  `routes/session/index.tsx:1228`).
- **Dynamic width:** all layout uses flex; the composer/session split
  triggers a "wide" mode at `dimensions().width > 120` (sidebar shows
  inline) vs narrow (sidebar becomes a floating absolute overlay).
  `contentWidth = dimensions().width - (sidebarVisible ? 42 : 0) - 4` is
  threaded through context to children that need a hard width (e.g. code
  blocks, diff rendering).
- **Typography primitives:** `<text>` + `<span style={{ fg, bg, bold,
  italic?, dim? }}>`, plus `TextAttributes.{BOLD, STRIKETHROUGH, ...}` as
  the attribute flag set from `@opentui/core`. `<code>` supports
  tree-sitter syntax highlighting via `syntaxStyle={syntax()}` (themed).
- **Animations** are feature-flagged per user preference
  (`kv.get("animations_enabled", true)`) — spinners/markdown streaming
  skip animation frames when disabled.

Receipts:
- `context/theme.tsx` (30 761 bytes) — `resolveTheme`, `selectedForeground`,
  `ansiToRgba`, palette sampling, 12-step grayscale.
- `context/theme/*.json` — 33 theme presets.
- `app.tsx` line ~88 — `Terminal.getTerminalBackgroundColor()` pre-render.
- `routes/session/index.tsx` — `wide()`, `contentWidth()`,
  `sidebarVisible()`.

## 9. Testing strategy

- **Runner:** `bun:test`.
- **Reconciler-backed component tests.** Opencode TUI tests use
  `testRender` from `@opentui/solid` with the JSX pragma
  `/** @jsxImportSource @opentui/solid */`. Example
  (`test/cli/tui/slot-replace.test.tsx`):
  ```ts
  import { test, expect } from "bun:test"
  import { createSlot, createSolidSlotRegistry, testRender,
           useRenderer } from "@opentui/solid"
  import { onMount } from "solid-js"

  test("replace slot mounts plugin content once", async () => {
    let mounts = 0
    const Probe = () => { onMount(() => mounts += 1); return <box /> }
    const App = () => {
      const renderer = useRenderer()
      const reg = createSolidSlotRegistry<Slots>(renderer, {})
      const Slot = createSlot(reg)
      reg.register({ id: "plugin", slots: { prompt: () => <Probe /> } })
      return <box><Slot name="prompt" mode="replace"><box /></Slot></box>
    }
    await testRender(() => <App />)
    expect(mounts).toBe(1)
  })
  ```
- **Context integration tests** (`test/cli/tui/sync-provider.test.tsx`) wrap
  the whole provider stack (`ArgsProvider`/`ExitProvider`/`ProjectProvider`
  /`SDKProvider`/`SyncProvider`) with a stubbed `fetch` that returns
  synthetic session/message/part payloads, then `testRender(() =>
  <...providers><Probe/></...providers>)`. Async state is asserted via a
  `wait(() => condition, 2000)` poll helper.
- **Testing utilities in `@opentui/core`:** `createTestRenderer({ width,
  height })` returns `{ renderer, mockMouse, mockKeys, renderOnce,
  captureCharFrame }`. Snapshot-style assertions use
  `captureCharFrame()` → string. Mocks:
  - `createMockKeys` — `type`, `press(KeyCode)`, `pressEnter`,
    `pressTab`, `pressBackspace`, modifier combos (`ctrl`, `shift`,
    `meta`).
  - `createMockMouse` — `click`, `doubleClick`, `drag`, `scroll`,
    position, buttons, modifiers.
  Example from opentui docs:
  ```ts
  const { mockMouse, renderOnce, captureCharFrame } =
    await createTestRenderer({ width: 80, height: 24 })
  // ...
  await mockMouse.click(10, 5)
  expect(clicked.callCount()).toBe(1)
  ```
- **Snapshot infra** exists in `@opentui/core` under
  `packages/core/src/renderables/__snapshots__` and
  `packages/core/src/testing/__snapshots__`. Used for core primitives, not
  exercised in the opencode tree — opencode's 16 TUI tests favor
  behavioral assertions over snapshots.
- **Coverage of the TUI tree:** 16 TUI tests total (globbed under
  `packages/opencode/test/cli/tui/` and `test/cli/cmd/tui/`). Most focus
  on plugin runtime, keybind plugin handling, slot replacement, sync
  provider, thread rendering, and transcript formatting. There is **no
  exhaustive per-component test suite** for the session view — the bulk
  of confidence comes from testing the data-flow layer (sync reducer,
  theme store, transcript formatter, keybind) rather than the render
  surface.

Receipts:
- `packages/opencode/test/cli/tui/*` (16 files).
- `packages/opencode/test/cli/cmd/tui/prompt-part.test.ts`.
- `anomalyco/opentui/packages/core/src/testing/{test-renderer.ts,
  mock-keys.ts, mock-mouse.ts, test-recorder.ts, spy.ts}`.

## 10. What's directly portable

Patterns that map onto an Effect-TS + pnpm monorepo with minimal friction,
because they are stack-agnostic (they're about shape, not runtime):

- **Keybind ↔ command ↔ slash-command unification** (section 6). One
  registration object owns the name, the palette entry, the keybind, the
  slash command, `enabled`/`hidden`/`suggested`, and `onSelect`. The
  palette footer prints the active binding via `keybind.print(name)` so
  the affordance is always in sync. This is the single most valuable
  pattern and is pure data — trivial to port into any TUI, Ink or
  otherwise.
- **Dialog stack with `replace` / `clear` / on-top `useKeyboard`
  gating** (section 5). Small, pure-TS primitive. The "only top of stack
  handles keys" rule is exactly what solves nested-modal/esc routing.
- **Event-sourced replicated store** (section 4). The "SSE → reducer →
  central store keyed by (sessionID, messageID) with binary-search insert
  + produce/reconcile" pattern composes cleanly with Effect — the reducer
  is a pure function, SSE can be an `Effect.scoped` stream. Our
  `@expect/supervisor` is already event-oriented; the pattern is
  compatible.
- **Streaming-stable renderable contract** (`streaming={true}` on a
  markdown/code block). The *pattern* is: decorate your markdown renderer
  with a `streaming` mode that preserves partial AST stability. Ink has a
  similar idea via `<Static>`/ink-markdown — the idea ports.
- **Per-turn footer with model/duration/interrupted state**. Renders
  unconditionally below the last message. Good UX receipt for agent
  turns.
- **PermissionPrompt / QuestionPrompt = composer swap** (section 7) for
  modal human-in-the-loop input. Portable pattern, independent of
  renderer.
- **KV-backed view preferences** (`kv.signal(key, default)`), and
  `command.register(() => [...])` for commands that reflect live state
  ("Show X" vs "Hide X" label flipping). Portable.
- **Theme schema: JSON preset + `defs` + dark/light variants + system
  palette probe fallback**. The data shape is portable; the palette
  probe is terminal-level.
- **Test-at-the-data-layer ethos.** Assert the reducer, the theme store,
  the keybind parser, the transcript formatter. Only the top-level
  rendering integration needs a fake terminal. Our Effect services
  already line up with this.
- **Slash command table as the *source* of commands and keybinds**, not a
  post-hoc parser of user input. Slash == palette with input prefilter.
- **Route union as a plain Solid-store / signal** — for us, a Ref-backed
  atom or an Effect Ref — with `useRouteData<T>` runtime narrowing.

## 11. What's lossy or needs adaptation

The TUI is TypeScript already, but it is **SolidJS + OpenTUI + Bun**, and
our current stack is **Ink + React + Effect-TS + Node/Bun**. Porting paths:

### Path A — Adopt opencode's full stack (Solid + OpenTUI)

- Requires replacing Ink with `@opentui/solid`. Loses React/JSX-on-React
  mental model; gains Solid's fine-grained reactivity, which is the
  single biggest reason opencode's streaming renders at 60 FPS without
  jank.
- Requires Zig available at install time (`@opentui/core` has a native
  addon; Zig needed for build). Users install binary from npm, but
  platform coverage must be confirmed. (`OpenTUI appears to not be
  respecting setting TMPDIR when starting up, leading to failure to
  initialize` was a recent public issue — maturity risk.)
- Effect-TS works alongside Solid without issue (opencode already uses
  Effect for the SDK/server; the TUI itself avoids Effect). We would
  keep Effect for services, use Solid only in the TUI.
- **Biggest cost:** zero React Compiler benefit (not applicable — no
  React), team ramp on Solid primitives (`createStore`/`produce`/
  `reconcile`/`batch` are different from Jotai/React Query).
- **Biggest win:** streaming markdown renderer with `streaming={true}`,
  kitty keyboard, hit-testable mouse, ScrollBox that just works,
  `captureCharFrame` snapshot tests.

### Path B — Keep Ink/React but adopt opencode's patterns (not libraries)

- Portable items from section 10 slot in here with no stack change.
- Ink already does alt screen, mouse (via `ink-mouse`), basic resize.
  Ink's `<Static>` is a partial analog of OpenTUI's streaming mode but is
  weaker; markdown streaming in Ink tends to flicker unless you roll a
  custom reconciler.
- You will re-implement: `ScrollBox` equivalent with sticky-bottom + key
  nav by child id; a hit grid for mouse drag; kitty keyboard detection;
  `keybind.print(name)` helper; a 16 ms SSE batch coalescer.
- **Lowest risk, lowest upside.** Good if TUI is not the main product
  differentiator.

### Path C — Hybrid: TypeScript core stays, Ink for the outer shell,
**OpenTUI for the streaming viewport only**

- Not natively supported by either OpenTUI or Ink; would require running
  OpenTUI inside a separately-managed terminal region, or *within* an
  Ink render tree via a custom Ink element that hosts an OpenTUI
  sub-renderer. Nobody does this upstream — it would be novel
  infrastructure.
- Realistically this collapses into either Path A (flip fully) or a
  pragmatic Path B with ad-hoc ANSI escape rendering for the streaming
  area (bypassing Ink's reconciler for the hot path).
- **Lossy.** Recommend against unless streaming perf is the one specific
  bottleneck and we prototype the cross-boundary IPC cost first.

### Other adaptation concerns

- opencode's `context/sync.tsx` reducer imports `@opencode-ai/sdk/v2`
  types directly. We would replace with `@expect/shared` domain models
  (TestPlan, ExecutedTestPlan, ExecutionEvent) and our own reducer; the
  *shape* (status + keyed-by-id collections + binary-search insert + SSE
  batch) ports as-is.
- opencode uses its own `Keybind` parser (`@/util/keybind`) — need our
  own string grammar (`ctrl+x ctrl+c` leader sequences). Not a big item.
- The plugin slot system
  (`@opentui/solid` `createSlot`/`createSolidSlotRegistry`) is Solid-
  specific and only needed if we want third-party plugins in the TUI.
  Skip for v1.
- No i18n in opencode's TUI that I could find — strings are inline.
- The `win32.ts` shims (CtrlC guard, ENABLE_PROCESSED_INPUT fixup) are
  real and often-missed on Node/Bun TUIs. Porting the *fact that they
  exist* is as valuable as the code itself.

## 12. Questions that block scoping

> These are the items I could not fully determine from the public repo /
> docs and should be surfaced to the user before committing to a path.

1. **Maturity of OpenTUI on non-macOS platforms.** The Oct 31 migration
   is ~5 months old; issues like #4605 (TMPDIR handling on startup) and
   #4606 (TUI crashes) are still open on the anomalyco fork. We need
   first-hand evaluation on Linux (x86_64 + arm64) and Windows (native +
   WSL) before committing Path A. I did not execute opencode locally.
2. **OpenTUI API stability.** `@opentui/core` is at 0.1.99, still
   pre-1.0. No documented semver policy. What is the update cost we sign
   up for?
3. **Zig toolchain dependency at install time.** OpenTUI ships
   precompiled binaries for common triples, but I could not confirm the
   exact matrix from the README I fetched. Is there a pure-TS fallback
   for unsupported platforms?
4. **Does the 60 FPS full-redraw model actually exceed what Ink can do
   for our workload?** Ink's bottleneck is Yoga + React reconciliation,
   not ANSI output. Without a perf benchmark on our own message/tool-call
   shape, choosing Path A on "perf" alone is unfounded.
5. **Plugin system requirement.** opencode invests heavily in
   `TuiPluginRuntime`, slots, and route plugins. Is any of that a
   perfagent-cli requirement? If not, ~27 KB of `plugin/runtime.ts` and
   the slot registry drop out of the port.
6. **Mouse vs. copy-on-select.** opencode has a `Flag
   .OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` path because terminal
   mouse capture breaks native text selection. Which behavior do we want
   as the default? This is a product decision, not a tech one.
7. **SSE vs. in-process event source.** The TUI lets callers inject a
   custom `EventSource` via props to bypass SSE. If we keep the
   Supervisor/TUI split as "separate processes", we pay SSE. If we run
   them in-process, we get the in-process path for free. Which does
   `tui-auditor-current` currently assume?
8. **Snapshot vs. behavioral TUI tests.** OpenTUI supports
   `captureCharFrame` snapshots but opencode chose not to use them. Do
   we want snapshot coverage of the render surface, or do we match
   opencode and only test data/reducer layers?
9. **No i18n / a11y screen-reader support visible in opencode.** Is
   either a requirement for perfagent-cli? (OpenTUI has no
   screen-reader story I could find.)
10. **Why did opencode delete Go + Bubbletea in one commit with literally
    "HOORAY" in the message?** The rationale per grokipedia is "unify
    the stack, reduce IPC, perf". I could not fetch PR #2685's body to
    confirm (gh API returned 401 on the PR URL). The *public-facing*
    motivation is consistent across secondary sources but not
    first-party-cited.

Sources used during research:
- [sst/opencode (default branch `dev`)](https://github.com/sst/opencode/tree/9640d889baa58fa01ed612a6372ba77462f79d9f)
- [`packages/opencode/src/cli/cmd/tui/app.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/app.tsx)
- [`routes/session/index.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [`context/sync.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/context/sync.tsx)
- [`context/sdk.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/context/sdk.tsx)
- [`context/keybind.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/context/keybind.tsx)
- [`ui/dialog.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/ui/dialog.tsx)
- [`context/theme.tsx` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/src/cli/cmd/tui/context/theme.tsx)
- [opencode `package.json` @ pinned SHA](https://github.com/sst/opencode/blob/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/package.json)
- [TUI test directory @ pinned SHA](https://github.com/sst/opencode/tree/9640d889baa58fa01ed612a6372ba77462f79d9f/packages/opencode/test/cli/tui)
- [anomalyco/opentui repo](https://github.com/anomalyco/opentui)
- [anomalyco/opentui core renderer](https://github.com/anomalyco/opentui/blob/main/packages/core/src/renderer.ts)
- [anomalyco/opentui testing utilities](https://github.com/anomalyco/opentui/tree/main/packages/core/src/testing)
- [OpenTUI — Grokipedia](https://grokipedia.com/page/OpenTUI) (secondary, motivation claims)
- [OpenCode — Grokipedia](https://grokipedia.com/page/opencode) (secondary)
- [OpenCode TUI docs](https://opencode.ai/docs/tui/)
- Migration commits on `dev`: `96bdeb3` "OpenTUI is here" (2025-10-31),
  `f68374a` "DELETE GO BUBBLETEA CRAP HOORAY" (2025-11-02).
