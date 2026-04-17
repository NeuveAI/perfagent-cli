# OV-2b Review — Wire Insights Overlay Into Results

**Reviewer:** reviewer (antagonistic)
**Date:** 2026-04-17
**Verdict:** APPROVE

---

## Scope verification

`git diff --stat` confirms exactly 4 files touched, matching the engineer's diary:

```
apps/cli-solid/src/commands/register-results.ts     |  3 +--
apps/cli-solid/src/routes/results/results-screen.tsx |  5 +++++
apps/cli-solid/tests/commands/register-results.test.ts | 21 +++++++++++++++++++--
apps/cli-solid/tests/integration/app-wiring.test.ts |  2 +-
4 files changed, 26 insertions(+), 5 deletions(-)
```

- `git diff HEAD apps/cli-solid/src/app.tsx` → empty. No `app.tsx` modifications. Confirmed.
- `grep setOverlay("ask")` across cli-solid → no matches. Zero `ask` wiring leakage (OV-3c still owns that).

## Mandatory checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | Clean (exit 0, no output) |
| `bun test` in `apps/cli-solid` | **563 pass, 0 fail, 1089 expect() calls** (+1 from 562 baseline) |
| Only 4 files touched | Confirmed |
| Diary line-ranges match | Confirmed (`register-results.ts:59-68`, `results-screen.tsx:13,215-217`) |

## Findings

### `register-results.ts` (lines 59-68)

Diff flips the `insights` stub to active:
- Removed `hidden: true` (Q4 — absent now, defaults to visible).
- `keybind: "i"` (Q3 — correct, unchanged from OV-1b's stub).
- `enabled: isEnabled(options)` (Q6, Q21 — shared helper, same as the 5 other Results commands). No bespoke predicate.
- `onSelect: () => { options.setOverlay("insights"); }` (Q5 — correct).

`ask` stub at lines 48-58 was NOT touched: still `hidden: true`, still the HACK comment. Correct — OV-3c's problem.

### `results-screen.tsx` (lines 13, 215-217)

- Line 13: `import { InsightsOverlay } from "./insights-overlay";` — correct relative path.
- Lines 215-217: `<Show when={navigation.overlay() === "insights"}>` placed as a **sibling** of the existing `rawEvents` `<Show>` (lines 208-213), not nested (Q7 ✓).
- The two overlays are mutually exclusive because `navigation.overlay()` returns a single `ResultsOverlay | undefined` value; `"insights" === "rawEvents"` can never both be true (Q8 ✓).
- `<InsightsOverlay report={props.report} onClose={() => navigation.setOverlay(undefined)} />` — Q9: `props.report` is typed `PerfReport` (line 25 `ResultsScreenProps`), and `InsightsOverlay` expects `report: PerfReport` (`insights-overlay.tsx:9`). Types match. Q10: `onClose` calls `setOverlay(undefined)`, not a self-pointer.

### Tests

- `"copy, save, restart, insights, raw-events are visible; ask is hidden"` (line 45): asserts `insights?.hidden).toBeUndefined()` and `ask?.hidden).toBe(true)`. Correct direction.
- `"insights command calls setOverlay with insights"` (lines 190-205): invokes `insights.onSelect()`, asserts captured overlay value is `"insights"` (Q11 ✓ — mirrors the existing raw-events ratchet exactly).
- `"commands are disabled when overlay is active"` (line 124) and `"commands are disabled when a dialog is open"` (line 137) iterate `for (const cmd of commands)` — they implicitly cover `insights` now (Q12 ✓, Q22 ✓).
- `"keybinds are correct"` already asserted `insights?.keybind).toBe("i")` since OV-1b (line 169) — no change needed, still green.
- `app-wiring.test.ts:374-377`: `results.insights` moved from `not.toContain` to `toContain`. Since `hidden: false` now means the modeline SHOULD list it, the direction is correct (Q13 ✓).
- `EXPECTED_COMMAND_SETS` (line 55) and `screen-command-isolation.test.ts:136` already listed `results.insights` pre-OV-2b — they were presence checks, unaffected by visibility change (Q14 ✓).

### Test count reconciliation

562 → 563 (+1) matches exactly ONE new ratchet (`"insights command calls setOverlay with insights"`). The renamed visibility test (line 45) is a rename + assertion swap, not an added test (Q15 ✓, Q16 ✓). Weakening check: old asserted `insights?.hidden).toBe(true)`, new asserts `insights?.hidden).toBeUndefined()` — equivalent strength, just inverted direction to match the new state.

### Code quality

- No nested `<text>` in the overlay render (Q17 ✓).
- No `useMemo`/`useCallback`/`React.memo` (Q18 ✓ — also N/A since this is Solid, not React).
- No explanatory comments added (Q19 ✓).
- Named exports only (Q20 ✓).

### Shielding contract (Q22)

Confirmed still intact for all 5 other Results commands: they all share `isEnabled(options)` which returns false when `overlay() !== undefined`. With `insights` overlay open, `e`/`y`/`s`/`r` won't fire — the existing `"commands are disabled when overlay is active"` test (line 124) already proves this for the whole set including insights itself.

## Severity counts

- Critical: 0
- Major: 0
- Minor: 0
- Nit: 0

## Verdict

**APPROVE.** The change is exactly what the spec (`overlays-plan.md:120-131`) asked for: flip the stub to active, render the overlay, ratchet a test. No scope creep, no ask leakage, no bespoke predicate, no app.tsx churn. Reuses OV-1b's `isEnabled` helper as required. Type-check clean, 563/563 tests green with the expected +1 ratchet delta. Ready to commit.
