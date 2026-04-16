# Review: TUI-P0 -- Bootstrap (Round 1)

## Verdict: APPROVE

No Critical or Major findings. All mandatory verification commands pass. The existing CLI is unaffected. Alt-screen teardown is clean on every tested exit path (ctrl+c, SIGINT, SIGTERM, normal exit, beforeExit). The build chain works end-to-end.

---

### Verification executed

1. **`pnpm install`** -- pass. All 10 workspace projects resolved. `cli-solid` included via the `apps/*` glob in `pnpm-workspace.yaml`.

2. **`pnpm typecheck`** -- pass. 9 packages, all 9 successful (full turbo cache hit, confirming no type regressions).

3. **`pnpm --filter @neuve/perf-agent-cli typecheck`** -- pass. The existing Ink CLI typechecks cleanly. JSX pragma isolation confirmed: `apps/cli/tsconfig.json` has `"jsx": "react-jsx"`, `apps/cli-solid/tsconfig.json` has `"jsx": "preserve"` + `"jsxImportSource": "@opentui/solid"`. No cross-contamination.

4. **`pnpm test`** -- 1 pre-existing failure in `@neuve/cookies` (`Chrome: extracted cookies have valid expiry timestamps`). This is documented in the diary as a flaky test on the current `main` branch (Guest Profile returns 0 cookies). Not a regression from cli-solid. `@neuve/shared` tests: 113/113 passed. No new failures introduced.

5. **`pnpm --filter cli-solid build`** -- pass. Produces `dist/tui.js` at 1.3 MB. Clean exit.

6. **`bun dist/tui.js` + SIGINT** -- pass. The TUI renders on alt-screen showing "perf-agent solid TUI -- hello" with the Logo component. SIGINT causes clean exit with code 0. Alt-screen off sequence `\x1b[?1049l` confirmed in the output stream. Terminal returns to normal state.

7. **React/Ink leak check** -- `rg "react|ink|@tanstack|zustand|@effect-atom/react" apps/cli-solid/src/ apps/cli-solid/package.json` -- zero hits.

8. **OpenTUI leak into existing CLI** -- `rg "@opentui" apps/cli/` -- zero hits.

9. **`effect` version consistency** -- `pnpm ls effect --recursive --depth=0` confirms `4.0.0-beta.35` across all 8 consuming packages including both `apps/cli` and `apps/cli-solid`. No version shadowing.

10. **Root `package.json` diff** -- only `dev:solid` and `build:solid` scripts added. No other changes.

---

### Findings

#### MINOR findings

- **[MINOR] `TARGET_FPS` magic number not in `constants.ts`** (`apps/cli-solid/src/tui.ts:4`) -- CLAUDE.md requires magic numbers in `constants.ts` with `SCREAMING_SNAKE_CASE` and unit suffixes (e.g. `TARGET_FPS`). The constant is correctly named but lives inline in `tui.ts` rather than in a dedicated `constants.ts`. Acceptable for a 15-line bootstrap file; should be moved when `constants.ts` is created in P1.

- **[MINOR] Color hex literals in `logo.tsx` not in constants** (`apps/cli-solid/src/renderables/logo.tsx:6-10`) -- Five color constants are defined inline. These will move to the theme context in P1 (`context/theme.tsx`), so extracting them to constants now would create throwaway code. Acceptable for P0.

- **[MINOR] `VERSION` hardcoded to `"dev"`** (`apps/cli-solid/src/renderables/logo.tsx:3`) -- The original logo imports `VERSION` from `../../constants`. The port hardcodes `"dev"`. This is fine for P0's hello-world render but should be wired to the real version in a later phase.

- **[MINOR] Scope doc lists `src/index.ts` (Commander entry) but it was not created** -- The scope doc's file checklist (rewrite-scope.md line 236) includes `apps/cli-solid/src/index.ts` for P0. The engineer skipped it. This does not violate any acceptance criterion (the Commander shell is not tested by any P0 gate), and deferring it is reasonable since P0 is about proving the render pipeline. The engineer should note this as a carry-forward for P1.

#### INFO findings

- **[INFO] OpenTUI console overlay shows internal stack traces** -- Noted in the diary. The runtime output includes red error text from OpenTUI's rendering loop (`activateFrame` stack traces). These are non-fatal internal OpenTUI errors. The `consoleMode: "disabled"` config option can suppress them. Not a P0 concern, but the team should decide whether to disable the console overlay in P1.

- **[INFO] `handleError` on uncaught exception does not tear down alt-screen** -- OpenTUI's `handleError` (at `@opentui/core/index-8978gvk3.js:19127`) catches `uncaughtException` and `unhandledRejection` but does NOT call `destroy()`. Instead it logs the error to the console overlay and keeps the TUI running. This is OpenTUI's intentional design (show errors in-context). If the uncaught exception causes process termination, `beforeExit` fires and calls `destroy()`. If it does not terminate the process, the user can ctrl+c out. The scope doc's P0.T2 task mentions "uncaught exception" teardown, but the acceptance criteria (lines 244-248) only gate on ctrl+c. This is not blocking, but worth documenting as a known behavior for future phases.

- **[INFO] Linux/Windows native addon validation not performed** -- The diary confirms macOS arm64 works. The scope doc (line 256) acknowledges Linux/Windows as an open question tracked in section 7. No evidence of Linux testing. This is expected for P0 and tracked.

- **[INFO] `build.ts` does not verify output exists after build** -- The build script checks `result.success` and exits on failure, but does not verify `dist/tui.js` was actually written. Bun's `Bun.build()` should guarantee this on success, so this is cosmetic.

---

### Alt-screen teardown trace (primary review-lane concern)

Traced through OpenTUI's `@opentui/core/index-8978gvk3.js`:

| Exit path | Handler | Calls `destroy()`? | Alt-screen restored? |
|---|---|---|---|
| ctrl+c (with `exitOnCtrlC: true`) | `_keyHandler.on("keypress")` at line 19230 | Yes, via `process.nextTick(() => this.destroy())` | Yes |
| SIGINT (OS-level) | `exitHandler` at line 19153 via `addExitListeners` at line 19291 | Yes | Yes |
| SIGTERM, SIGQUIT, SIGABRT, SIGHUP, SIGBREAK, SIGPIPE, SIGBUS | Same `exitHandler` via `addExitListeners` | Yes | Yes |
| `beforeExit` (normal exit) | `exitHandler` at line 19225 | Yes | Yes |
| Uncaught exception | `handleError` at line 19127 | No -- logs to console overlay, keeps running | No (TUI stays up; user ctrl+c exits cleanly) |
| `kill -9` (SIGKILL) | None -- cannot be caught | No | No (unavoidable) |

All user-reachable exit paths result in clean alt-screen teardown. The uncaught exception path keeps the TUI alive (by design) rather than crashing, so the terminal never enters a "stuck in alt-screen with no TUI" state.

---

### Suggestions (non-blocking)

- When `constants.ts` is created in P1, move `TARGET_FPS` there with the `_FPS` unit suffix.
- Consider adding `consoleMode: "disabled"` to the renderer config in P1 to suppress the internal OpenTUI stack traces visible in the console overlay.
- The `trustedDependencies` field appears in both `package.json` and `bunfig.toml`. The `package.json` entry is for pnpm (lifecycle scripts), and the `bunfig.toml` entry is for Bun's install. Both are needed -- no duplication concern, but worth a comment in the bunfig for future readers.
- For P1, wire `VERSION` to the real package version rather than keeping the hardcoded `"dev"` string.

---

### CLAUDE.md compliance checklist

| Rule | Status |
|---|---|
| `interface` over `type` | N/A (no types defined in P0 source) |
| Arrow functions only | Pass -- no `function` keyword in source |
| No comments unless `// HACK:` | Pass -- zero comments |
| No type casts (`as`) | Pass |
| No unused code | Pass |
| kebab-case filenames | Pass (`tui.ts`, `app.tsx`, `logo.tsx`, `build.ts`) |
| No barrel files | Pass -- no `index.ts` re-exports |
| No `null` | Pass |
| No `useMemo`/`useCallback`/`React.memo` | Pass -- zero React hooks |
| Namespace imports for `fs`, `os`, `path` | N/A (no Node built-in imports) |
| `Boolean` over `!!` | N/A |

---

### Exit criteria met

1. `pnpm typecheck` passes -- verified.
2. `pnpm test` passes (no new failures) -- verified. Pre-existing `@neuve/cookies` flake is documented.
3. Build succeeds -- verified. `pnpm --filter cli-solid build` produces `dist/tui.js`.
4. TUI renders and ctrl+c exits cleanly -- verified.
5. No Critical or Major findings -- confirmed.
6. Existing CLI typecheck unaffected -- verified via `pnpm --filter @neuve/perf-agent-cli typecheck`.
