# Review: Wave 4.5 — Real-runner upgrade attempt + F5 addendum (Round 2)

## Verdict: APPROVE

F5 is a real, well-characterized measurement-apparatus bug. The engineer attempted the real-runner upgrade path in good faith, hit a reproducible measurement-invalidating gap, correctly stopped the sweep before publishing misleading cross-branch numbers, and surfaced the finding with code references, trace evidence, and a concrete fix direction. Scope hygiene is clean (zero runtime mutation; the temporary `evalite.config.ts` tweak was reverted byte-identical before commit). The new subset eval file is scoped, reuses existing infrastructure, and adds no scope creep. The byte-count correction is acknowledged.

This round delivered more value than numerical baselines would have — it flagged a pre-existing scorer bug that would have produced a false-positive "B1 is better than current" inversion under any cross-branch real-runner baseline, and it did so without costing any runtime code change. APPROVE.

### Verification executed

- `git log --oneline -5` → top of main is `ba3511bc`, `0fd12ed3`, `3c5df159` (round-1 review), `aaad0015`, `b12f01f2`. Expected set.
- `git branch -a` → only `main`. Throwaway branches not created this round (confirmed by addendum:97-102).
- `git status` → working tree clean.
- `git show 0fd12ed3 --stat` → `packages/evals/evals/wave-4-5-subset.eval.ts | 213 +++`. Single file. No runtime dir touched.
- `git show ba3511bc --stat` → 2 files, both under `docs/handover/harness-evals/baselines/`. No runtime dir touched.
- `git log --oneline -- evalite.config.ts` → last commit pre-dates Wave 4.5. No Wave-4.5 commit touched it. Confirmed.
- `git diff HEAD~2 HEAD -- evalite.config.ts` → empty. The temporary tweak claim checks out.
- `git log --oneline -- packages/evals/src/runners/real.ts` → `5f2a2d14` + `99c5cb54`, both pre-dating Wave 4.5. `real.ts` is explicitly NOT touched this round, consistent with the "measurement-only, do not fix F5 here" discipline.
- `pnpm --filter @neuve/evals test` on main → `9 test files / 81 tests passed`. Still green.
- `jq ... wave-4-5-subset-current-real-partial.json` → 2 evals, both calibration-1 and calibration-2 averaging 0.25 with tool-call-validity=1 and all other scorers at 0. Matches the addendum:31-32 table exactly. No NaN/null; all scores in `[0,1]`.

### F5 accuracy check

The addendum's root-cause characterization is correct. Verified:

1. **`extractUrlFromToolInput` behavior** — read `packages/evals/src/runners/real.ts:44-55` independently. The function parses `ToolCall.input` as JSON, then reads `parsed.url` OR `parsed.action.url`. It does NOT inspect `ToolResult.result`. The addendum's code quote is verbatim.

2. **Wave 2.A tool schema** — read `packages/browser/src/mcp/tools/interact.ts:7-80`. The interact tool uses a discriminated union keyed on `command`. The `navigate` command variant (`:8-16`) DOES include a top-level `url: z.string().optional()` alongside `command: z.literal("navigate")`. Structurally, `extractUrlFromToolInput` could theoretically find a URL via the `action.url` branch at real.ts:52-54.

3. **Trace evidence — the load-bearing piece** — the addendum cites `args: "{}"` in the emitted trace for `mcp__browser__interact` (addendum:40). The `args` are empty. This is the critical fact: regardless of what the schema accepts, the AGENT IS NOT PASSING URLs through the top-level args. The URL only appears in `ToolResult.result` text ("Successfully navigated to https://docs.python.org/3/..."). The scorer inspects only `ToolCall.input`, never `ToolResult.result`, so `extractUrlFromToolInput` returns undefined for every real call. This produces `reachedKeyNodes: 0` despite successful navigation.

4. **Scoring consequence** — I independently verified `step-coverage.ts`, `final-state.ts`, and `furthest-key-node.ts` all derive from `reachedKeyNodes` / `finalUrl` (both populated only through `extractUrlFromToolInput`). So three of four scorers go to 0, and `tool-call-validity` survives because it reads `wellFormed` from `isWellFormedToolCall` (real.ts:57-61), which only checks JSON well-formedness. The 0.25 average score the partial JSON shows is exactly what this bug predicts: `(0 + 0 + 1 + 0) / 4 = 0.25`. Self-consistent.

5. **Cross-branch inversion prediction** — addendum:79-90 argues B1 would score higher than current under a real run because the pre-Wave-2.A tool surface likely passed URLs at the top level of `ToolCall.input` (that's why `extractUrlFromToolInput` was designed the way it was). This is plausible and importantly would produce a *misleading* result. Stopping the sweep before publishing that is the correct call. "Publishing misleading numbers is worse than publishing a stated limitation" (addendum:98-99) is the right posture.

F5 finding is accurate, well-evidenced, and correctly scoped as a non-blocking-for-this-wave issue.

### Subset eval file check

`packages/evals/evals/wave-4-5-subset.eval.ts:1-213`:

- [INFO] Imports only the 3 calibration tasks (lines 12-14). Declared as a `ReadonlyArray<EvalTask>` with no other task references.
- [INFO] Config pattern is identical structurally to `smoke.eval.ts` — same `stringWithSchemaDefault` helper, same `EVAL_RUNNER`/`EVAL_BACKEND`/`EVAL_PLANNER`/trace/base-url/headed/gemma-* config values. No new env vars. No new runner abstractions.
- [INFO] Three runner suites (real/gemma/mock) registered via the existing `registerRunnerSuite` + mock fork pattern. Scorers pulled from existing modules — no new scorers defined locally.
- [INFO] No side effects beyond `evalite(...)` registration. No top-level I/O, no global state mutation. `Effect.runSync(resolveEvalConfig)` is the same pattern smoke uses.
- [INFO] No scope creep: no fixtures added, no `smoke.eval.ts` modified (verified via `git log --oneline -- packages/evals/evals/smoke.eval.ts` shows no Wave-4.5-round-2 commit).
- [INFO] Kept as a permanent artifact (not throwaway) is appropriate — it's a useful time-boxed spot-check entry for the next real-runner attempt, and it costs nothing as a mock-runner when the full smoke is fine.

Clean. No concerns.

### Addendum quality

- [INFO] F5 is characterized with `file:line` references (real.ts:44-55), code quote, trace evidence, consequence chain, and a concrete fix direction (addendum:111-120). This is exactly what a reviewer wants to see for a deferred finding.
- [INFO] "Why baseline-b1 and baseline-b2 were not actually run" section (addendum:92-102) cites the team-lead's "hard rule" (any mid-run failure → abandon real-runner). Honest framing.
- [INFO] Byte-count correction (addendum:126-140) acknowledges the round-1 Minor finding, documents the drift source (`ls -la` rounding), and notes the underlying invariance claim still holds. Correct path forward — not amending the round-1 artifacts to avoid re-reviewing settled content, propagating the correction via the addendum instead.
- [INFO] "Not fixed in this wave" section (addendum:104-109) explicitly cites the seed's hard rule ("measurement task only. No edits to main's harness code") as the reason for deferring. Consistent with the engineer's discipline in v1.
- [INFO] Fix direction is sound. Option 1 (parse `ToolResult.result`) or option 2 (piggy-back on executor-side `StepCompleted` events) are both tractable ~30 LoC changes. The recommendation for a regression test against a fixture trace from each Wave 2.A tool is well-targeted.

### Minor observations (non-blocking)

- [MINOR] The addendum cites the schema at `interact.ts` but does not explicitly reconcile the "schema allows nested url via `action.url`" fact with "trace shows `args: '{}'`". A reader unfamiliar with the MCP server's session-state model might wonder why the agent's `args` are empty when the schema allows a URL. The real explanation (the chrome-devtools-mcp session carries URL state separately, so the agent sends `{}` once the target URL is already set in session context) isn't spelled out. Could be added as a one-sentence clarification for future readers. Non-blocking — the empirical evidence (`args: "{}"` → scorer returns undefined → reachedKeyNodes=0) is what matters.
- [MINOR] The "Cross-branch inversion" prediction is stated as a certainty ("would deliver a false positive"). Strictly speaking it's a prediction, not a measurement, because the engineer did not actually run B1/B2 to confirm URL extraction works against the pre-Wave-2.A tool surface. The phrasing could be softened to "likely" to match the same epistemic rigor used in the v1 static-diff projections. Minor stylistic inconsistency — does not change the decision to stop.

### Scope hygiene — all green

- [INFO] Three Wave-4.5-round-2 touchpoints: `packages/evals/evals/wave-4-5-subset.eval.ts` (new eval entry), `docs/handover/harness-evals/baselines/wave-4-5-subset-current-real-partial.json` (partial artifact), `docs/handover/harness-evals/baselines/wave-4-5-addendum.md` (findings). Zero runtime paths touched. `evalite.config.ts` verified byte-identical pre/post. `real.ts` not touched.
- [INFO] Subset eval file uses the `.eval.ts` test discovery extension which is registered by evalite's runner, not vitest's test discovery — verified by the 81/81 figure being unchanged (had it leaked into `vitest run`, the test count would have changed).

### Round-1 byte-count correction — acknowledged

- [INFO] The round-1 Minor flag (349597 vs 349598) is explicitly acknowledged at addendum:126-140. The engineer did not amend the original files (correct — amending a committed reviewed artifact creates more review noise than the off-by-one typo deserves). Propagating the correction through the addendum is the right call.

### Value delivered by this round

F5 is load-bearing. Without it, a future engineer attempting a real-runner baseline for Wave 6+ would execute the sweep, record non-zero numbers on B1 (where the old tool surface emits top-level `url`), compare to zero-scoring numbers on current, and conclude "the Wave 2.A consolidation regressed step-coverage by 80%". That conclusion would be false and would motivate reverting work that is actually an improvement. Surfacing this before any cross-branch baseline exists is strictly more useful than whatever numerical deltas the 9-eval subset would have produced.

APPROVE.
