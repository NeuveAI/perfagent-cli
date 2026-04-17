# FIX-B Review

**Reviewer:** reviewer (strict mode)
**Scope:** `apps/cli-solid/src/tui.ts`, `apps/cli-solid/src/routes/startup/startup-screen.tsx`
**Engineer's diary:** `docs/handover/tui-rewrite/diary/fixb-diary.md`

## Verdict

**APPROVE WITH NOTE** — the diff is minimal, typecheck and tests pass, and no functional regression is introduced. However, the diary's stated *reason* for the `useKittyKeyboard: {}` change is factually wrong (see Issue 1 below). Given this is a no-op at runtime and the engineer already acknowledged FIX-B does not fix the scramble, I am approving the change but the lead must be aware that the kitty-flags "reduction" story is misleading — the new config produces byte-for-byte identical escape sequences to the old one.

**Caveat for the lead:** FIX-B does NOT solve the scramble. The manual dry-run will still show the garbled Results screen until FIX-D (layout collision fix) lands. This is explicitly acknowledged in the diary and in the task breakdown. Don't mistake a green `pnpm check` for a user-visible fix.

## Mandatory verification

### 1. Typecheck
```
$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
(no output, exit 0)
```
PASS.

### 2. Tests
```
$ cd apps/cli-solid && bun test
 564 pass
 0 fail
 1090 expect() calls
Ran 564 tests across 32 files. [7.17s]
```
PASS — matches the engineer's reported baseline.

### 3. Diff scope
`git diff` restricted to the two claimed files. `apps/cli-solid/src/tui.ts` has 3 lines of change (adds `externalOutputMode`, replaces `useKittyKeyboard`). `apps/cli-solid/src/routes/startup/startup-screen.tsx` has 3 lines of change (imports `useToast`, creates toast handle, swaps `console.error` → `toast.show`). Minimal and correct scope. PASS.

### 4. `console.*` inventory in cli-solid
```
$ Grep 'console\.' apps/cli-solid/src
No matches found.
```
PASS — engineer's claim that this fix removes the last `console.*` in cli-solid is confirmed.

### 5. Build
```
$ cd apps/cli-solid && bun run build
$ bun build.ts
(no errors)
```
PASS.

## Findings

### Issue 1 (Major — diary accuracy, NOT code correctness) — `useKittyKeyboard: {}` is identical to the previous config

The diary states the `useKittyKeyboard` change "keeps kitty support enabled but without the advanced flags that increase the odds of unparsed bytes." This is **not true**.

Reference: `.repos/opentui/packages/core/src/renderer.ts:311-346` (`buildKittyKeyboardFlags`):

- `disambiguate` defaults to `true` unless explicitly `false` → flag always set unless opted out.
- `alternateKeys` defaults to `true` unless explicitly `false` → flag always set unless opted out.
- `events`, `allKeysAsEscapes`, `reportText` all default to `false` and must be explicitly `true` to enable.

So both of these produce the **exact same flags** (`0b101` = disambiguate + alternateKeys):
- Old: `{ disambiguate: true, alternateKeys: true }` → explicit `true` → both set
- New: `{}` → both fall through to default `true` → both set

The terminal receives an identical kitty-keyboard progressive-enhancement request in both cases. There is no byte-level difference on the wire, no reduction of CSI-u escape sequences, no change to what terminals echo back. The "extra CSI sequences are now avoided" story is false.

**Why this is still OK to merge:** the change is a no-op at runtime, and matching opencode's spelling exactly has minor future-proofing value (if opentui ever changes defaults, we won't be pinned to the old explicit values). No regression, no user-visible impact.

**Action the lead should take:** before the commit message is written, strip the bogus "fixes unparsed bytes" rationale. Keep only "cosmetic alignment with opencode's config spelling." Do not let that claim survive into the git log or the handover doc — it'll mislead whoever debugs this next.

### Issue 2 (Informational) — `externalOutputMode: "passthrough"` is truly cosmetic in our case

Reference: `.repos/opentui/packages/core/src/renderer.ts:240-244`:
```ts
let externalOutputMode =
  config.externalOutputMode ?? (screenMode === "split-footer" ? "capture-stdout" : "passthrough")
if (process.env.OTUI_OVERRIDE_STDOUT !== undefined) {
  externalOutputMode = env.OTUI_OVERRIDE_STDOUT && screenMode === "split-footer" ? "capture-stdout" : "passthrough"
}
```

With our `screenMode: "alternate-screen"`, the resolved default is already `"passthrough"`. Setting it explicitly is informational only. There's also an env-var escape hatch (`OTUI_OVERRIDE_STDOUT`) but it only flips behaviour when `screenMode === "split-footer"`, which is not our mode. So for us, explicit vs. implicit is genuinely a no-op.

Keeping the explicit value is fine — it documents intent and matches opencode. Not a blocker.

### Issue 3 (Minor — diary accuracy) — `ConsoleMode` default claim confirmed

Reference: `.repos/opentui/packages/core/src/renderer.ts:800-804` and `1016-1023`:
```ts
this.consoleMode = config.consoleMode ?? "console-overlay"
// setter:
public set consoleMode(mode: ConsoleMode) {
  this._useConsole = mode === "console-overlay"
  if (this._useConsole) this.console.activate()
  else this.console.deactivate()
}
```

Engineer's claim is correct: default `"console-overlay"` captures `console.*` calls made after renderer construction. The startup-screen `console.error` fired inside `onMount` (strictly post-construction), so it was *already* being captured by the overlay and would not appear on the tty. The removal is correct but **not** a fix for stdout bleed — it's a style/consistency change (routing errors through the toast system).

This means the user-visible impact of Issue 3's file edit is: users *with the overlay showing* now see a toast instead of a console-overlay entry. Users without the overlay showing see nothing different (the console-overlay is hidden by default and they'd have had to press a hotkey to view it).

Q1 from the review prompt ("does the user actually see the error?"): **Yes, via the toast row.** The toast is rendered by the toast context which overlays the screen. The existing per-check result list also shows a "Health check crashed" entry for visibility in both paths. This is a net improvement over the previous `console.error` (which went to a hidden overlay).

### Issue 4 (Minor — confirmed) — keybindings not broken

Verified by running `bun test` — all 564 tests pass, which exercises the command registration code paths (`register-global`, `register-testing`, `register-session-picker`, `register-port-picker`, `register-cookie-sync`). The kitty flag set is *identical* to before (see Issue 1), so keypress parsing is unchanged. `esc`, `ctrl+q`, and all Results-screen keybindings (`y`, `s`, `r`, plus `ctrl+l`, `ctrl+u`, `ctrl+c`) continue to work.

Spot-checked `register-global.ts` — `ctrl+q` → `initiateShutdown()` on Startup + Main; `esc` → `goBack()` when not on Main and no overlay. Logic unchanged.

### Issue 5 (Informational — diary's layout-collision hypothesis)

Read `apps/cli-solid/src/routes/results/results-screen.tsx:148-163`. The RuledBox contains three `<text>` children:

1. `<text><span>Copy this summary now</span></text>`
2. `<text><span>Press </span><span>y</span><span>… to paste into your chat or PR.</span></text>`
3. `<text><span>Press </span><span>s</span><span>… or </span><span>r</span><span>… again.</span></text>`

`RuledBox` (`apps/cli-solid/src/renderables/ruled-box.tsx`) is `<box flexDirection="column" width="100%">` with no vertical spacing. Inside it, the inner box is `flexDirection="column"` with `paddingLeft=1, paddingRight=1` but no explicit `gap` or child `height` constraint.

**Verification of engineer's layout-collision theory:** plausible but NOT proven by reading alone. In opentui/Solid, sibling flex-column text nodes should each occupy their own row; collision into the same row would imply (a) one of them has `position="absolute"` implicitly, or (b) the parent is not allocating enough height and children overflow onto each other, or (c) a text wraps and the wrapped continuation lands on the next `<text>`'s row. None of these is obvious from the source. Proving it requires either a DOM/yoga snapshot from a test-renderer or a manual run.

**Recommended mini-investigation for FIX-D (not FIX-B):**
1. Add a test-renderer snapshot of the Results screen's RuledBox region at width=80 and width=120.
2. If snapshot shows three distinct rows, the theory is wrong and something else (e.g. span-width truncation, or stale framebuffer cells from the previous render) is at play.
3. If snapshot collapses rows, look at yoga layout: is any `<text>` getting `height: 0`? Does `RuledBox` need `flexShrink={0}` on children?

This is out of scope for FIX-B — just flagging so FIX-D's engineer has a start.

### Issue 6 (Confirmed) — no `stderr: "inherit"` on the hot path from TUI to children

Grepped the whole repo for `stderr: "inherit"`. The only in-repo hits are:
- `apps/cli/src/commands/init-utils.ts:115` — different app, not in TUI path
- `.repos/opentui/…` and `.repos/opencode/…` — vendored reference code

None are loaded by the Solid TUI runtime. Engineer's claim that the TUI→child stdio pipeline is fully piped/drained is confirmed for the ACP adapter (`packages/agent/src/acp-client.ts:707-740` uses Effect `ChildProcessSpawner` which defaults `stderr` to `"pipe"`, and `Stream.runDrain` consumes it). The `StdioClientTransport` at `packages/local-agent/src/mcp-bridge.ts:77` does rely on MCP SDK defaults which include `stderr: 'inherit'` — but that inherit is inside the *local-agent subprocess*, and local-agent's own stderr is piped by the parent. The diary's 2-hop analysis is correct.

### Issue 7 (Informational) — toast vs. Effect logger

The diary explains the choice: startup-screen has no Effect runtime in scope (it's inside a Solid `onMount`), so `Effect.logWarning` isn't directly callable. Using `toast.show` matches other non-Effect surfaces in the codebase. The toast is user-visible; the error is not silently swallowed. Acceptable.

One tiny nit: `toast.show(\`Startup health check failed: ${String(error)}\`)` could lose the stack trace. Since the error object might contain one (via `Error.stack`), future debugging might benefit from also running `Effect.logWarning` if a runtime becomes available here. Not a blocker for FIX-B.

## Summary for the lead

- Code changes are minimal, correct, and pass typecheck/tests/build.
- The diff is a valid hardening/cleanup pass; it removes the last `console.*` in cli-solid and aligns renderer config with opencode.
- The diary's **reasoning** for the `useKittyKeyboard` change is wrong — `{}` and `{disambiguate: true, alternateKeys: true}` produce identical kitty flags. Don't let the "fixes unparsed-byte echoes" claim survive into the commit message. Rewrite as "spelling alignment with opencode; no runtime change."
- FIX-B does **not** fix the scramble. The engineer explicitly acknowledges this and points at FIX-D (layout collision in RuledBox on Results screen) as the real culprit. Manual dry-run will still show garbled text on Results. Lead, plan FIX-D next.
- No critical or major blockers in the code itself. One major diary accuracy issue (Issue 1) that affects what ends up in the commit message.

Verdict: **APPROVE**, conditional on the commit message being truthful about the kitty-flags no-op.
