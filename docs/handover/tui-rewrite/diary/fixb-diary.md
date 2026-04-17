# FIX-B Diary — Stop stdout/stderr bleed into TUI framebuffer

## Scope

Investigate whether stray `console.*`, `process.stdout.write`, or child-process stderr inherits are bleeding into the Solid TUI's framebuffer, producing the garbled text visible on the Results screen ("Presstyitoscopyrtheotest summary…"). Apply minimum-viable fixes.

---

## Investigation

### 1. Stray `console.*` / `process.stdout.write` inventory

Grepped `console\.(log|error|warn|info|debug|trace)` and `process\.(stdout|stderr)\.write` across `apps/cli-solid/src` and every package under `packages/`.

| File | Line | Call | Context |
|---|---|---|---|
| `apps/cli-solid/src/routes/startup/startup-screen.tsx` | 32 | `console.error("Startup health check failed:", error)` | Runs inside `onMount` on TUI mount if `runHealthChecks` throws. **Only stray `console.*` in the TUI process.** |
| `packages/local-agent/src/log.ts` | 24 | `process.stderr.write(line)` | Runs inside the `@neuve/local-agent` **subprocess**, not in the TUI. Parent captures its stderr via `childProcess.stderr.pipe(...)` in `acp-client.ts:721` — consumed, not inherited. |
| `packages/browser/src/mcp/start.ts` | 17, 26 | `process.stderr.write(...)` | Inside the `browser-mcp` **subprocess**. Parent (ACP adapter subprocess, which is itself launched with piped stderr) consumes via MCP. |
| `packages/browser/src/mcp/start-http.ts` | 114, 124, 141 | `process.stderr.write(...)` | Standalone HTTP daemon script — not loaded inside the TUI. |
| `packages/typescript-sdk/tests/e2e.ts` | many | `console.log(...)` | Test file, never executed by the TUI. |
| `packages/**/*.md` | several | `console.log(...)` | README / resource markdown — non-code. |

**Conclusion:** the only in-process `console.*` in the TUI is the startup-screen one. All other stdout/stderr writes are isolated behind subprocess boundaries that the parent consumes as piped streams.

### 2. Child-process stdio audit

Searched `spawn(`, `Bun.spawn(`, `StdioClientTransport(` across all packages + the TUI.

| File | Line | Spawn | `stderr` handling |
|---|---|---|---|
| `apps/cli-solid/src/lifecycle/health-checks.ts` | 36 | `Bun.spawn(["npx", "chrome-devtools-mcp@0.21.0", "--version"], …)` | `{ stdout: "ignore", stderr: "ignore" }` — safe. |
| `apps/cli-solid/src/lifecycle/health-checks.ts` | 76 | `Bun.spawn(["pgrep", …], …)` | `{ stdout: "pipe", stderr: "ignore" }` — safe. |
| `packages/agent/src/acp-client.ts` | 707 | `ChildProcess.make(adapter.bin, adapter.args, …)` via Effect `ChildProcessSpawner` | Default in `@effect/platform-node-shared/NodeChildProcessSpawner.ts:100-111` is `{ stream: "pipe" }` for unspecified `stderr`. Parent drains via `childProcess.stderr.pipe(…)` at `acp-client.ts:721`. Safe. |
| `packages/browser/src/devtools-client.ts` | 20 | `new StdioClientTransport({ command: "npx", args: ["chrome-devtools-mcp@0.21.0", …], stderr: "pipe" })` | Explicitly `"pipe"` — safe. |
| `packages/local-agent/src/mcp-bridge.ts` | 77 | `new StdioClientTransport({ command, args, env })` | **`stderr` not specified**. MCP SDK defaults to `'inherit'` (`@modelcontextprotocol/sdk/dist/esm/client/stdio.js:71` — `stdio: ['pipe', 'pipe', this._serverParams.stderr ?? 'inherit']`). |

**Note on `mcp-bridge.ts` finding:** this file is loaded inside the **`@neuve/local-agent` subprocess**, not the TUI. The child MCP server's inherited stderr goes to the local-agent's stderr, which the TUI's ACP adapter spawner pipes via Effect's `ChildProcess` (default `pipe`) and drains with `Stream.runDrain`. So the bleed path that might look alarming terminates at the parent's stream consumer. It's still a latent wart worth noting, but it is **not** the source of the on-screen garble because it never reaches the TUI's tty directly.

**Conclusion:** no direct `stdio: 'inherit'` path exists from a child process up to the TUI's tty. Nothing to reroute here for FIX-B's immediate concern.

### 3. Renderer config comparison (ours vs opencode)

| Option | Ours (before) | Opencode | Our fix |
|---|---|---|---|
| `screenMode` | `"alternate-screen"` | unset (alternate-screen is default) | keep `"alternate-screen"` |
| `targetFps` | `60` | `60` | keep |
| `externalOutputMode` | not set → implicit `"passthrough"` (from `resolveModes` in `renderer.ts:240-244`, alt-screen ⇒ `passthrough`) | `"passthrough"` explicit | **set explicitly** to match opencode and remove any reliance on default |
| `useKittyKeyboard` | `{ disambiguate: true, alternateKeys: true }` | `{}` | **use `{}`** to match opencode; disambiguate/alternateKeys emit additional CSI sequences that some terminals echo back if not fully consumed |
| `useMouse` | `false` | `mouseEnabled` (config-driven) | keep `false` — unrelated to this bug |
| `exitOnCtrlC` | `false` | `false` | keep |
| `consoleMode` | not set → default `"console-overlay"` | not set → default `"console-overlay"` | keep default. With overlay capture active, any `console.*` call is intercepted by the renderer and written into the overlay buffer instead of stdout — see `opentui/packages/core/src/console.ts:98-148` + `renderer.ts:1016-1023`. This means the startup-screen `console.error` is already captured after `render()` kicks in, but we still remove it for correctness and to avoid a race window before activation. |
| `consoleOptions` | not set | sets copy keybinding for the overlay | not needed for FIX-B. |

### 4. Opentui renderer source — key confirmations

From `/Users/vinicius/code/perfagent-cli/.repos/opentui/packages/core/src/renderer.ts`:

- `resolveModes` (line 227-254): when `screenMode === "alternate-screen"`, `externalOutputMode` defaults to `"passthrough"`. Setting it explicitly is cosmetic but documents intent.
- Line 804: constructor sets `this.consoleMode = config.consoleMode ?? "console-overlay"`.
- Line 1016-1023: setter activates `TerminalConsole`, which on activation (`console.ts:98-148`) replaces `global.console` with a captured writable stream. So post-activation `console.log/error/warn/info/debug` are routed into the overlay, not to the tty.

So the TUI's default behaviour already neutralises `console.*` calls made **after** the renderer constructor finishes. Calls made earlier (top-level imports, pre-`render()` synchronous code) would still hit the real stdout. In our code, the startup-screen's `console.error` fires inside `onMount`, which is strictly after construction — so it's captured by the overlay today. We still remove it because:

1. Routing user-visible errors through the toast system is the pattern this codebase already uses (cookie-sync-confirm-screen.tsx:47 uses `Effect.logWarning`; we use `toast.show` here because startup-screen has no Effect runtime).
2. Avoids reliance on implicit renderer capture for correctness.

---

## Hypothesis — which of the two bugs causes the garble?

Looking at the screenshot carefully against the Results screen source (`results-screen.tsx:148-163`):

```
Line A: "Press y to copy the test summary so you can paste it into your chat or PR."
Line B: "Press s to save this flow or r to run it again."
Garble: "Presstyitoscopyrtheotest summary so you can paste it into your chat or PR."
```

The garbled prefix `Presstyitoscopyrtheotest` is line A interleaved with extra characters from line B that overwrite whitespace positions in A. This is **two `<text>` children rendering onto the same row of the framebuffer**, not a stdout byte stream overwriting framebuffer cells. A stdout bleed would produce a contiguous foreign string (the raw emitted message), not a character-level mask pattern, and it would affect the modeline or an arbitrary row — but the modeline is clean.

**Primary hypothesis:** the garble is a *layout* bug inside `RuledBox` on the Results screen, causing lines A and B (and the third `<text>` with the s/r hints) to collide in the same row. This belongs to **FIX-A's territory (overlay/layout rework)**, not FIX-B (stdout bleed). That said, FIX-B's preventative fixes are still correct and worth keeping in:

**Secondary hypotheses for why we still do FIX-B's changes:**

- **Renderer-config alignment with opencode.** `useKittyKeyboard: { disambiguate: true, alternateKeys: true }` requests extra CSI-u escape-sequence classes from the terminal. Terminals that don't support kitty disambiguation will echo the raw escape bytes back to the input stream, which opentui's input parser may or may not fully consume — and anything unconsumed can surface as spurious chars. Using `{}` (opencode's setting) keeps kitty support enabled but without the advanced flags that increase the odds of unparsed bytes.
- **`console.error` removal.** Routes structured user-visible failures through the toast queue that the rest of the TUI already uses. Defensive — removes a subtle race where a pre-`render()` call would bypass the overlay capture.
- **Explicit `externalOutputMode: "passthrough"`.** Documents intent; removes reliance on the `alternate-screen` default.

**Expectation after FIX-B:** the scrambled-header symptom will **not** fully disappear; FIX-A (layout rework for overlays and, separately, the RuledBox stacking on Results) is still needed. FIX-B removes the stdout-bleed class of root causes from contention so that remaining visual bugs can be narrowed to layout/rendering issues.

---

## Fix — summary of changes

### `apps/cli-solid/src/tui.ts`

- Added `externalOutputMode: "passthrough"` explicitly (was implicit via `alternate-screen`).
- Replaced `useKittyKeyboard: { disambiguate: true, alternateKeys: true }` with `useKittyKeyboard: {}` to match opencode's config exactly.

### `apps/cli-solid/src/routes/startup/startup-screen.tsx`

- Imported `useToast` from `../../context/toast`.
- Removed `console.error("Startup health check failed:", error)` on line 32 (old).
- Replaced with `toast.show(\`Startup health check failed: ${String(error)}\`)` — user sees the failure in the toast row below the modeline, and the per-check result list still shows the "Health check crashed: …" entry as before.

### Files intentionally NOT changed

- `packages/local-agent/src/log.ts` and `packages/local-agent/src/mcp-bridge.ts` — these run in the subprocess, and the parent pipeline consumes both streams. Changing them is out of scope for the TUI-framebuffer bleed.
- `packages/browser/src/devtools-client.ts` — already pipes stderr explicitly.
- All other packages — no direct writes to the TUI's tty.

---

## Verification

### TypeScript

```
$ cd apps/cli-solid && bunx tsgo --noEmit
EXIT=0
```

(Equivalent: `bunx tsc --noEmit` also clean.)

### Tests

```
$ cd apps/cli-solid && bun test
  564 pass
  0 fail
  1090 expect() calls
Ran 564 tests across 32 files. [6.99s]
```

### Build

```
$ cd apps/cli-solid && bun run build
$ bun build.ts
(ok, produced dist/tui.js + dist/browser-mcp.js + tree-sitter assets)
```

### Manual dry-run (required)

This can only be validated by running the actual TUI end-to-end in a terminal. The reviewer / user should:

1. Launch `perf-agent tui -a local -u https://agent.perflab.io` (or any short-running flow that reaches the Results screen).
2. On the **Startup** screen: confirm no stray `[Object], Error: …` text appears below the logo/checks (if a health check crashes, expect the failure to surface in the toast row AND in the "Health check" failed entry — not as a scrambled console dump).
3. On the **Results** screen, look at the "Copy this summary now" RuledBox. The two hint lines should be:
   - `Press y to copy the test summary so you can paste it into your chat or PR.`
   - `Press s to save this flow or r to run it again.`
   Each on its own row, no scrambled letters, no spaces replaced.
4. Check the modeline along the bottom remains clean throughout (no garbled characters).
5. If scrambling persists on the Results screen body: the remaining culprit is layout/stacking inside `RuledBox` or `results-screen.tsx`, not stdout bleed — that is FIX-A territory (overlay/RuledBox rework). FIX-B's renderer-config changes have already closed the stdout-bleed class of causes.

---

## Files changed

- `apps/cli-solid/src/tui.ts`
- `apps/cli-solid/src/routes/startup/startup-screen.tsx`

No commits. Waiting for reviewer APPROVE before the lead commits.
