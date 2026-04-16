# HP-5 Review: Integration Wiring + Per-Screen Commands + Smoke Test

**Reviewer:** Agent (senior engineer)
**Commits:** `bc5d2a81`, `a30afc2c`
**Verdict:** APPROVE

---

## Verification Results

| Check | Result |
|-------|--------|
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | Pass (clean) |
| `bun test` (all 506 tests) | Pass (0 failures, 933 expect() calls, 1.78s) |
| `bun run build` (`bun build.ts`) | Pass (clean) |
| No source file changes | Confirmed -- only 3 test files + 1 diary file |

---

## Checklist

### 1. Command isolation tests

**Pass.** `screen-command-isolation.test.ts` creates a full registry with all 6 command sets for each screen and asserts that commands belonging to other screens have `enabled: false`. Covers all 5 main screens (Main, CookieSyncConfirm, PortPicker, Testing, Results) for each command set. The isolation is real -- the tests construct the actual `createXCommands` factories with different `currentScreen` values and assert the `enabled` flag.

### 2. Modeline visibility tests

**Pass.** `app-wiring.test.ts` tests `getVisibleCommands()` filtering per screen:
- Main: asserts 4 specific commands visible (`cookie-sync`, `agent-picker`, `saved-flows`, `watch`) and several absent.
- Results: asserts 3 visible (`copy`, `save`, `restart`) and hidden stubs absent.
- Testing: asserts 0 visible.
- CookieSyncConfirm: asserts 0 visible.
- PortPicker: asserts 0 visible.

**Minor gap (not blocking):** The Main modeline test doesn't assert `main.pr-picker` and `main.past-runs` are visible (they are, since `isGitRepo` and `hasRecentReports` are both `true` in the test setup). The diary claims 6 visible on Main, but only 4 are positively asserted. A count assertion like `expect(visible.length).toBe(6)` would strengthen this. Not a correctness issue -- the underlying code is correct, just a test coverage gap.

### 3. Data threading tests

**Pass.** `screen-transitions.test.ts` verifies props thread correctly through the full flow:
- `ChangesFor` construction (Changes, Commit, Branch variants)
- `screenForTestingOrPortPicker` routing logic (URL detection, baseUrls presence)
- Props threading chain: Main -> CookieSyncConfirm -> PortPicker -> Testing -> Results
- Minimal props (optional fields undefined)
- `goBack` target is always Main

### 4. Enter keybind isolation

**Pass.** Three tests explicitly verify enter isolation:
- Main: `main.submit` enabled, `cookie-sync.confirm` and `port-picker.confirm` disabled.
- CookieSyncConfirm: `cookie-sync.confirm` enabled, others disabled.
- PortPicker: `port-picker.confirm` enabled, others disabled.

The registry keybind validator only checks enabled commands, so the duplicate `enter` keybinds don't cause a collision error.

### 5. global.back on Testing

**Acceptable.** Traced the full flow:
- `register-global.ts:41` -- `global.back` enabled when `currentScreen()._tag !== "Main"`, so it IS enabled on Testing.
- `app.tsx:47-48` -- `goBack` returns early for Testing/Watch (no-op).
- `testing-screen.tsx:137-162` -- Testing screen has its own `useKeyboard` that handles esc independently (shows cancel confirmation dialog).
- Both handlers fire for the same esc event. The `goBack` no-op runs harmlessly, and the Testing screen's handler does the real work.

This is a design choice, not a bug. The diary correctly identifies it. The test at line 297-302 asserts `global.back` is enabled on Testing, which matches the code.

### 6. ctrl+o keybind shared between Testing and Results

**Not a bug.** Both `testing.expand` (keybind `ctrl+o`) and `results.raw-events` (keybind `ctrl+o`) exist, but they are never both enabled simultaneously (gated by `isTestingScreen` and `isResultsScreen`). The keybind validator runs at registration time against the initial screen state (Main), where both are disabled, so no collision is detected. At runtime, `handleKeyEvent` skips disabled commands. Safe.

### 7. Test quality

**Good.** The tests exercise real integration points:
- They construct actual command registries with all 6 command sets wired together.
- They test `handleKeyEvent` with real `KeyEvent` objects (not just checking `enabled` flags).
- They cover the cross-cutting concerns (esc behavior, enter conflicts, single-letter keys on wrong screens).

**Minor nit:** `enterKey` and `escKey` are imported but unused in `screen-command-isolation.test.ts` (line 10). The tests use `charKey`, `ctrlKey`, and direct `enabled` checks instead. Not blocking.

### 8. No code changes

**Confirmed.** `git show --stat bc5d2a81` shows only 3 new test files (1030 insertions). `git show --stat a30afc2c` shows only 1 diary file (38 insertions). Zero source files modified.

### 9. Big picture (HP-1 through HP-5)

**All 5 core screens are reachable** via the Switch in `app.tsx:132-153`: Main, CookieSyncConfirm, PortPicker, Testing, Results.

**Watch screen is NOT in the Switch router.** The Screen union defines Watch (navigation.tsx:28-33), `goBack` handles it as a no-op (app.tsx:48), and commands register for it, but there is no `<Match>` for Watch in `app.tsx`. It would hit the fallback text. This is a pre-existing gap from HP-1-4, not introduced by HP-5. Same for SelectPr, SavedFlowPicker, RecentReportsPicker, AgentPicker -- these are future work stubs in the navigation union. Not blocking for HP-5.

**Full flow is complete:** Main -> (CookieSyncConfirm) -> (PortPicker) -> Testing -> Results, verified by screen-transitions tests.

**No orphaned imports or dead code** in the new test files (aside from the unused `enterKey`/`escKey` imports noted above).

---

## Summary

88 integration tests across 3 files. Tests are meaningful -- they wire up the full command registry and verify cross-screen isolation, modeline filtering, keybind routing, and data threading. No source code was modified. Type-check, tests, and build all pass.

Two minor non-blocking observations:
1. Main modeline test could assert total visible count (6) alongside the 4 specific commands it checks.
2. Unused imports (`enterKey`, `escKey`) in `screen-command-isolation.test.ts`.

Neither is worth blocking the review for.
