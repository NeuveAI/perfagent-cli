# Review: LC-fix-tests — Update test expectations for new commands

## Verdict: APPROVE

### Verification performed

- `cd apps/cli-solid && bun test` → **547 pass, 0 fail** (1053 expect() calls, 32 files). Matches target.
- `cd apps/cli-solid && bunx tsc --noEmit` → clean, no output.
- `git diff --stat` → only the 3 test files changed, no source modifications.
- Focused re-run of the 3 edited files → 76 pass, 0 fail.

### Source-of-truth confirmation

Grepped `apps/cli-solid/src/commands/` for each new command value:

- `global.quit` → `register-global.ts:49` (keybind `ctrl+q`, enabled only on Main, **no `hidden` flag** — intentionally visible in modeline on Main).
- `global.force-quit` → `register-global.ts:59` (keybind `ctrl+c`, `hidden: true`, always enabled).
- `testing.retry` → `register-testing.ts:26` (keybind `r`, `hidden: true`, enabled only on Testing).

### File-by-file findings

**`apps/cli-solid/tests/integration/app-wiring.test.ts`**
- `EXPECTED_COMMAND_SETS` now lists 5 global (was 3) and 3 testing (was 2) commands. Values match the source factories exactly.
- The existing invariants (`total command count`, `no duplicate values`, `every command with keybind is non-empty`, `every title/category non-empty`) still run against the expanded set and all pass — structural guarantees preserved.
- Note: `"Testing screen shows no visible commands"` (line 362) still holds because `testing.retry` is `hidden: true`; the new command is correctly hidden, so this invariant continues to be meaningful.

**`apps/cli-solid/tests/integration/screen-command-isolation.test.ts`**
- New positive test `"r dispatches testing.retry on Testing"` (line 260) only asserts `handled === true`. This is acceptable because the test exercises the shared registry — `results.restart` is `enabled: false` on Testing, so `handleKeyEvent(charKey("r"))` can only reach `testing.retry`. The keybind-collision guard in `command-registry.ts:61-73` only fires on simultaneously-enabled duplicates, so the coexisting `r` bindings are safe.
- Exclusion of `"Testing"` from the "r does not dispatch" loop (line 266) is correct — `r` now has a legitimate dispatcher on Testing.
- The `"results commands disabled on non-Results"` block (line 119) still asserts `results.restart.enabled === false` on Testing, which locks in the guarantee that the `r` key cannot accidentally trigger `results.restart` from Testing.

**`apps/cli-solid/tests/commands/register-global.test.ts`**
- Rename to `"all global commands except quit are hidden"` is accurate: `quit` is the only command without `hidden: true`. The source uses no explicit `hidden` field on quit (defaults falsy), and the assertion `expect(cmd.hidden).not.toBe(true)` correctly covers both `undefined` and `false`.
- `force quit` is verified hidden via the loop (still caught by the default `expect(cmd.hidden).toBe(true)` branch).
- `"no keybind collisions among global commands"` at line 90 filters by `enabled !== false`. With `currentScreen: Main`, `global.quit` is enabled (ctrl+q), `global.back` is disabled (Main), and `global.force-quit` is enabled (ctrl+c). No collision. Good.

### Findings

_None at Critical or Major severity._

### Suggestions (non-blocking)

- `tests/integration/screen-command-isolation.test.ts:234` — the `describe` title `"y/s/r keys only fire on Results screen"` is now stale; `r` also fires on Testing. Consider `"y/s keys only fire on Results; r fires on Results and Testing"` or split into two describe blocks.
- `tests/commands/register-global.test.ts:22` — the positive `"creates expected command set"` test still only asserts `global.clear`, `global.update`, `global.back`. It would be stronger to also `toContain("global.quit")` and `toContain("global.force-quit")` to match the expanded command set. The `app-wiring.test.ts` expectations cover this, so it's not load-bearing, just looser than it could be.
- The new `"r dispatches testing.retry on Testing"` test could additionally assert **which** command fired (e.g. spy on `onSelect` or check that a side-effect attributable to retry ran) to guard against a future regression where `results.restart.enabled` leaks to Testing. As-is, it only proves "some command handled r", which is weaker than the analogous Results `y`/`s` tests that inspect `commands.find((cmd) => cmd.value === ...).enabled === true`.
