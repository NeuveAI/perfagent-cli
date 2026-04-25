# Review: frontier-planner-removal — Backend/Architecture lane

## Round 1 verdict: REQUEST_CHANGES
## Round 2 verdict: **APPROVE**

Both Round 1 Major findings (M1 coverage regression, M2 stale error message) were addressed in commits `35d2ff44` (P2) and `21637939` (P1). Re-verification under a clean working tree shows supervisor + evals tests passing cleanly with the expected `+1 file / +16 cases` delta in evals. See **Round 2 — patches** at the bottom for re-verification details.

(Round 1 historical record retained below.)

---

## Round 1

### Verdict (Round 1): REQUEST_CHANGES

Two MAJOR findings block merge: a 16-test coverage regression and a stale user-facing error message that gives invalid advice.

The committed Option-B excision itself is structurally clean — every dep-graph invariant holds, service identity is correct, the new `initialSteps` API is wired through to runtime use, and the regression test is concrete. But the lane lost critical decode-contract and no-API-key unit coverage by deleting `tests/plan-decomposer.test.ts` instead of porting it, and the rename `frontier → oracle-plan` was applied to the literal but not to the user-facing remediation message that references it.

(Note: original Round 1 prose said "17 test cases" — actual count in the deleted suite was 16. Off-by-one tally error from my count, not a missing case in the port. The port itself preserves all 16.)

---

## Verification command results

### 1. Independent typecheck — `pnpm --filter <pkg> typecheck`

| Package | Result |
|---|---|
| `@neuve/supervisor` | **PASS** (zero errors) |
| `@neuve/evals` | **PASS** (zero errors) |
| `@neuve/sdk` | **FAIL — out of scope.** Pre-existing `Cannot find module 'playwright'` at `src/perf-agent.ts:17` and `src/types.ts:1`. Confirmed identical failure on this branch with no working-tree changes; not introduced by frontier removal. |

`pnpm --filter <pkg> check` (which runs `vp check` = format + lint + typecheck) FAILS for all three packages on PRE-EXISTING formatting drift in unrelated files (`scripts/aggregate-baseline-run.ts`, `dist/*`, `report-storage.ts`, etc.) — not introduced by this PR.

### 2. Scoped tests — `pnpm --filter <pkg> test`

| Package | Files passed | Files failed | Tests passed |
|---|---|---|---|
| `@neuve/supervisor` | 9 | **2** | 71 |
| `@neuve/evals` | 11 | **2** | 111 |

**All 4 failures are TRANSFORM errors caused by uncommitted working-tree contamination, NOT by the frontier-removal commits.**

```
Identifier `buildLocalAgentSystemPrompt` has already been declared
  ╭─[ ../shared/src/prompts.ts:86:14 ]
  86 │ export const buildLocalAgentSystemPrompt = (): string =>
 118 │ export const buildLocalAgentSystemPrompt = (): string =>
```

Verified via `git show HEAD:packages/shared/src/prompts.ts` that the COMMITTED state (308 lines, single declaration at line 86) is clean. The duplicate at line 118 is in `git diff packages/shared/src/prompts.ts` only — uncommitted, blamed to `Not Committed Yet 2026-04-24 19:12`. This contamination is OUT OF SCOPE for this lane (Lane B owns `packages/shared/` if anyone) but **prevents clean verification of `tests/watch.test.ts` (supervisor) and `tests/real-runner.test.ts` + `tests/gemma-runner.test.ts` (evals) — three of the four files explicitly named in my scope.** Per the no-stash rule (memory `feedback_reviewer_never_stash`), I did not move the contamination to verify; flagged so removal-eng can resolve before re-review.

The remaining in-scope test, `executor-adherence-gate.test.ts`, is in supervisor's failing set — but it is failing in the SAME chained-transform way (not on its own assertions), so I cannot confirm pass/fail of its rewrite. Source-level review of that file is reported below.

### 3. Dep-graph invariant (Option B core promise)

```
$ grep -rn "@ai-sdk/google\|from [\"']ai[\"']\|from [\"']zod[\"']\|@ai-sdk/provider" \
    packages/supervisor/src/ packages/typescript-sdk/src/ apps/cli/src/ apps/cli-solid/src/
(zero hits)

$ grep -rn "PlanDecomposer\|plannerMode\|FrontierPlan\|PlannerAgent\|DecomposeError\|\
PlannerConfigError\|PlannerCallError\|parsePlannerMode\|PLANNER_MODES\|\
DEFAULT_PLANNER_MODE\|isPlannerMode" \
    packages/supervisor/src/ packages/typescript-sdk/src/
(zero hits)

$ grep -rn "planner-prompt\|plan-decomposer\|planner.ts" packages/supervisor/
packages/supervisor/tests/runtime-no-frontier-import.test.ts:25:  // Prompt-authoring symbols that lived in the deleted `planner-prompt.ts`.
(only comment in the regression test — expected)
```

**PASS.** Option B is fully realized in the runtime dep graph.

### 4. Service identity correctness

`packages/evals/src/planning/plan-decomposer.ts`:
- Line 282: `ServiceMap.Service<PlannerAgent>()("@evals/PlannerAgent", { … })` — correct new namespace
- Line 336: `ServiceMap.Service<PlanDecomposer>()("@evals/PlanDecomposer", { … })` — correct new namespace

Errors in `packages/evals/src/planning/errors.ts`:
- `Schema.ErrorClass<DecomposeError>("@evals/DecomposeError")` ✓
- `Schema.ErrorClass<PlannerConfigError>("@evals/PlannerConfigError")` ✓
- `Schema.ErrorClass<PlannerCallError>("@evals/PlannerCallError")` ✓

**PASS.** No stale `@supervisor/...` tags survived the move.

### 5. Executor refactor correctness

`packages/supervisor/src/executor.ts`:
- (a) No `yield* PlanDecomposer` — confirmed (only `agent`, `git`, `tokenUsageBus` yielded) ✓
- (b) No `planner` variable ✓
- (c) `ExecuteOptions.plannerMode` removed ✓
- (d) `ExecuteOptions.initialSteps?: readonly AnalysisStep[]` (line 78) is plumbed → consumed at line 193 (`const initialSteps = options.initialSteps ?? []`) → fed into `initialPlan.steps` (line 209) and `rationale` (line 208 — distinguishes "Seeded with pre-decomposed steps" vs "Direct execution"). **Not dead-wired.** ✓
- (e) `ExecutionError.reason` union (lines 47-52) contains only `AcpStreamError | AcpSessionCreateError | AcpProviderUnauthenticatedError | AcpProviderUsageLimitError`. `DecomposeError` is gone ✓

**PASS.**

### 6. Evals two-step pattern

`packages/evals/src/runners/real.ts`:
- Imports `PlanDecomposer` from `../planning/plan-decomposer` (line 6), `PlannerMode` from `../planning/errors` (line 7) — NOT from `@neuve/supervisor` ✓
- Two-step flow at lines 261-280: `const decomposedPlan = mode === "none" ? undefined : yield* planDecomposer.decompose(...)` → `executor.execute({ ..., initialSteps: decomposedPlan?.steps })` ✓
- `plannerMode === "none"` path correctly skips decomposition, passes empty steps to executor → executor plans itself ✓
- Default `DEFAULT_PLANNER_MODE: PlannerMode = "oracle-plan"` (line 37) — matches the rename ✓

`packages/evals/src/runners/gemma.ts`:
- Same import pattern (lines 6-7) ✓
- Reuses `runRealTask` from `./real` (line 8), so the two-step flow is shared ✓
- Default mode `"template"` (line 15) — appropriate for Gemma which runs without the Gemini API key ✓

No `Effect.catchAll`, `Effect.option`, `Effect.ignore`, or `Effect.orElseSucceed` introduced in either runner ✓

**PASS.**

### 7. Effect v4 compliance for new files

Reviewed `packages/evals/src/planning/{plan-decomposer,planner-prompt,errors}.ts`:

- `ServiceMap.Service<T>()("@ns/Name", { make: ... })` with `static layer` — both `PlannerAgent` and `PlanDecomposer` use this shape ✓
- `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)` — all three errors ✓
- `Effect.fn("ServiceName.method")` span names — `PlannerAgent.planFrontier`, `PlanDecomposer.decomposeFrontier`, `PlanDecomposer.decompose` ✓
- No `Effect.catchAll`, no `Effect.mapError`, no `try/catch`, no `null` ✓
- No barrel files in `packages/evals/src/planning/` (3 named files, no `index.ts`) ✓

**PASS.**

### 8. Deleted-file fallout

```
$ grep -rn "supervisor/src/planner\|supervisor/src/plan-decomposer" packages/
(zero hits)
```

**PASS.**

### 9. package.json + lockfile sanity

`packages/supervisor/package.json` — verified GONE: `@ai-sdk/google`, `@ai-sdk/provider`, `ai`, `zod`, `dotenv`. Only Effect/platform-node/agent/devtools/shared/oxc-resolver/pathe/simple-git remain. ✓

`packages/evals/package.json` — verified PRESENT: `@ai-sdk/google: 4.0.0-beta.45`, `@ai-sdk/provider: 4.0.0-beta.12`, `ai: 7.0.0-beta.111`, `dotenv: ^17.0.0`, `zod: ^4.3.6`. ✓

`pnpm-lock.yaml` diff: clean 12-line removal from `packages/supervisor` block (`@ai-sdk/google`, `@ai-sdk/provider`, `ai`, `zod` — 3 lines each). ✓

**PASS** (one MINOR caveat — see findings).

### 10. Regression-test quality

`packages/supervisor/tests/runtime-no-frontier-import.test.ts` (80 lines):
- Iterates 9 banned source tokens and 4 banned package deps
- For each token: walks `src/` recursively, reads each `.ts`/`.tsx` file, asserts the token does NOT appear (logs the exact offending file paths if it does) — this is a real string-presence assertion against actual source content
- For deps: `JSON.parse(package.json)` and asserts no overlap with banned list
- 10 individual `it()` cases total

Not a placeholder; concrete, hard-to-cheat invariant. ✓

**PASS.**

### 11. Test-drift assessment

`tests/executor-adherence-gate.test.ts` (rewritten, 142 lines changed): Read in full. The five `it()` cases cover:
1. Premature RUN_COMPLETED with pending steps → still gated (Volvo trace replay)
2. Clean termination when all plan steps reach terminal before RUN_COMPLETED
3. Abort path (`ASSERTION_FAILED|category=abort` → `RUN_COMPLETED|failed`)
4. **NEW** — RUN_COMPLETED with empty `initialSteps` (the runtime/Gemma path) — explicitly proves the new behavior
5. `synthesizeRunFinished()` grace-period safety net

Adherence is NOT gutted. The premature-completion gate is still tested with the same Volvo failure trace, just wired through `initialSteps` instead of `PlanDecomposer.decompose`. The new case (4) is exactly the regression test you'd want for the new option. ✓

`tests/executor-planner-integration.test.ts` (166 lines, DELETED): Tested DecomposeError → ExecutionError propagation in the executor. Codepath no longer exists (`ExecutionError.reason` union dropped `DecomposeError`). Deletion is appropriate. ✓

`tests/plan-decomposer.test.ts` (445 lines, DELETED): **MAJOR REGRESSION — see findings below.**

---

## Findings

### MAJOR

#### M1 — 17 PlanDecomposer unit tests deleted with no replacement

**Files:** deleted `packages/supervisor/tests/plan-decomposer.test.ts` (445 lines); no equivalent created at `packages/evals/tests/plan-decomposer.test.ts`.

**Why it matters:** The deleted suite covered three `describe` blocks with **17 `it` cases** that have ZERO replacement coverage anywhere in the repo:

- **`PlanDecomposer template mode` (2 tests)** — multi-step decomposition, single-URL bare-prompt edge case
- **`PlanDecomposer frontier mode (structured output)` (8 tests)** — happy path + 7 distinct DecomposeError scenarios:
  - markdown-fenced JSON (structured-output violation)
  - prose instead of JSON
  - malformed JSON
  - model call throws (network / rate-limit)
  - "Reached …" preamble (Apr-24 production regression)
  - trailing commentary after JSON
- **`PlanDecomposer no-API-key path (CRITICAL-1 regression)` (4 tests)** — explicitly named "CRITICAL-1 regression". Covers:
  - `PlanDecomposer.layer` resolves without `GOOGLE_GENERATIVE_AI_API_KEY` (template mode works)
  - `PlanDecomposer.layer` resolves without the key; `plannerMode='none'` never calls planner (dies by design)
  - frontier mode without the key surfaces a `DecomposeError` (lazy key read fires on first `planFrontier` call)
  - `PlannerConfigError` surfaces an actionable message
- **`splitByConnectives` (2 tests)** — utility unit tests

The end-to-end `tests/real-runner.test.ts` and `tests/gemma-runner.test.ts` STUB the entire `PlanDecomposer` service (`PlanDecomposer.of({...})`), so they exercise zero PlanDecomposer behavior. Verified:
```
$ grep -E "PlanDecomposer|MockLanguageModel" packages/evals/tests/real-runner.test.ts
import { PlanDecomposer } from "../src/planning/plan-decomposer";
    PlanDecomposer,
    PlanDecomposer.of({       ← stubbed, not exercised
```

The execution diary explicitly acknowledges this:
> "Coverage of the evals-local `PlanDecomposer` now lives only in the end-to-end `real-runner.test.ts` + `gemma-runner.test.ts`, which exercise the full `runRealTask(...)` two-step flow. A follow-up commit could port `plan-decomposer.test.ts` directly to `packages/evals/tests/` if the A:B harness needs isolated planner-level unit coverage again — nothing in this branch required it."

This rationale is wrong on two counts:
1. The runner tests do NOT exercise `PlanDecomposer` (they stub it), so the claim "coverage now lives in the e2e tests" is false.
2. "Nothing in this branch required it" misreads the value of the deleted CRITICAL-1 regression group — it exists precisely because that bug class is high-cost-to-recover. Deleting a regression test "because nothing required it" is a category error.

**Required fix:** Port `tests/plan-decomposer.test.ts` to `packages/evals/tests/plan-decomposer.test.ts` (path-rewrite imports `../src/...` → `../src/planning/plan-decomposer` etc.) before merge. The file is 445 lines of straight Effect-test code that should rebase cleanly.

#### M2 — Stale `EVAL_PLANNER=frontier` advice in user-facing error message

**File:** `packages/evals/src/planning/errors.ts:35`

```ts
message = `Frontier planner not configured: ${this.reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in your shell (or a dotenv file loaded by perf-agent) before running the eval harness with EVAL_PLANNER=frontier.`;
```

**Why it matters:** Commit `4ff3d383` ("refactor(evals): rename planner mode literal "frontier" → "oracle-plan"") renamed `PLANNER_MODES = ["oracle-plan", "template", "none"]`. A user who follows the error's advice and runs `EVAL_PLANNER=frontier evalite ...` will hit:

```
Error: Unknown planner mode "frontier". Expected one of: oracle-plan, template, none.
```

(thrown synchronously by `parsePlannerMode` at `errors.ts:13-17`, killing the harness before any `EVAL_PLANNER` consumer sees it). This is a self-inflicted user-facing UX regression introduced by this PR — the rename should have updated this message in the same commit.

**Required fix:** Change `EVAL_PLANNER=frontier` → `EVAL_PLANNER=oracle-plan` in the `message` template. Also rename the `displayName = "Frontier planner not configured"` if the lane wants string-level consistency with the literal rename (this is a SUGGESTION, not part of the required fix).

### MINOR

#### m1 — `@ai-sdk/provider` version silently bumped during the move

`packages/supervisor/package.json` (pre-removal): `@ai-sdk/provider: "^3.0.8"` → resolved to `3.0.8`.
`packages/evals/package.json` (post-removal): `@ai-sdk/provider: "4.0.0-beta.12"`.

A "move" commit bumped a major version (3.x → 4.0-beta) without rationale. Likely intentional (aligns with the `4.0.0-beta.*` line of `@ai-sdk/google`/`ai`/Effect), but uncalled-out version drift inside a "move" commit is a recipe for "git blame says 'move'; behavior changed under us." Worth a one-line note in the diary's Changes summary.

### INFO (non-blocking, out of scope but worth surfacing)

#### i1 — Working-tree contamination blocks scoped-test verification

`packages/shared/src/prompts.ts` and `packages/shared/tests/prompts.test.ts` have UNCOMMITTED duplicate-declaration edits in the working tree (not in any of the 9 frontier-removal commits). This causes `tests/watch.test.ts`, `tests/real-runner.test.ts`, and `tests/gemma-runner.test.ts` to fail on transform — three files in this lane's stated scope. Source-code review of those files is reported above; runtime verification deferred until contamination is resolved (per `feedback_reviewer_never_stash`, I did not stash to investigate).

#### i2 — `@neuve/sdk` typecheck fails on pre-existing `playwright` import errors

`src/perf-agent.ts:17` and `src/types.ts:1` import from `playwright` which is not declared in `package.json`. Reproduced on the branch with no working-tree changes; not introduced by this PR.

#### i3 — `vp check` fails on pre-existing formatting drift

Several files (none in scope) have drifted from the formatter (`scripts/aggregate-baseline-run.ts`, `dist/*`, `report-storage.ts`, `reporter.ts`). Pre-existing.

#### i4 — `parsePlannerMode` throws sync `Error` instead of using Effect

`packages/evals/src/planning/errors.ts:13-17` — pure function so technically OK per CLAUDE.md "Pure Functions Stay Pure", but it has a failure mode and uses `throw new Error(...)`. Pre-existing pattern, not introduced by this PR.

#### i5 — `packages/supervisor/src/index.ts` is a barrel file

CLAUDE.md: "Never create index.ts files that just re-export things." Pre-existing barrel; this PR only removed entries (clean delta), did not introduce the pattern.

---

## Suggestions (non-blocking)

- **S1** — When porting `plan-decomposer.test.ts` to `packages/evals/tests/`, also update the import line in the file from `from "../src"` to `from "../src/planning/plan-decomposer"` and `from "../src/planning/errors"` (the supervisor barrel re-exported them; evals does not).
- **S2** — Consider renaming `PlannerConfigError.displayName` from "Frontier planner not configured" to "Oracle planner not configured" (or "Plan decomposer not configured") for consistency with the new literal, in the same commit that fixes M2.
- **S3** — The diary's "Changes summary" should call out that `@ai-sdk/provider` was bumped from `^3.0.8` to `4.0.0-beta.12` during the move (currently presented as a pure relocation).
- **S4** — `executor.ts:336` uses `Stream.mapError((reason) => new ExecutionError({ reason }))`. This is type-safe (the upstream errors are constrained to the union members of `ExecutionError.reason`) but is the only `mapError` in the file. Pre-existing; the boundary-mapping pattern is defensible. Calling out so future readers don't trip on it.

---

## Round 2 — patches

**Verdict: APPROVE.**

Both Round 1 Major findings are resolved. Re-verification ran against a clean working tree (the `packages/shared/src/prompts.ts` contamination that blocked Round 1 test execution has been discarded per team-lead) so I can confirm runtime test status this round.

### Commits reviewed

| Patch | SHA | Subject | Targets |
|---|---|---|---|
| P2 | `35d2ff44` | `fix(evals): update PlannerConfigError guidance to EVAL_PLANNER=oracle-plan` | M2 |
| P1 | `21637939` | `test(evals): port plan-decomposer suite to @neuve/evals` | M1 |
| — | `f241cbf6` | `docs(diary): record backend-lane reviewer patches P1+P2` | diary book-keeping |

### Round 2 verification

#### Typechecks (clean working tree)

```
$ pnpm --filter @neuve/supervisor typecheck   →  exit 0 (zero errors)
$ pnpm --filter @neuve/evals typecheck        →  exit 0 (zero errors)
```

(One transient FAIL was observed when typecheck and `vp test run` were launched in parallel and contended on `tsgo`'s build cache; re-running typecheck in isolation gave a clean exit 0. Not a real failure — flagged so future reviewers don't chase it.)

#### Scoped tests (clean working tree)

```
$ pnpm --filter @neuve/supervisor test
  Test Files  11 passed (11)        ← was 9 passed / 2 failed (transform) in Round 1
       Tests  86 passed (86)        ← was 71 in Round 1

$ pnpm --filter @neuve/evals test
  Test Files  14 passed (14)        ← was 11 passed / 2 failed (transform) in Round 1
       Tests 148 passed (148)       ← was 132 in Round 1; +16 from the P1 port (matches engineer's report)
```

The +1 file / +16 cases delta in `@neuve/evals` matches exactly what P1 added (`packages/evals/tests/plan-decomposer.test.ts` with 16 cases across 4 describe blocks). The +2 files / +15 cases delta in `@neuve/supervisor` reflects the previously-untransformable `executor-adherence-gate.test.ts` and `watch.test.ts` now loading cleanly under the de-contaminated working tree.

### M1 — port verification

`packages/evals/tests/plan-decomposer.test.ts` (444 lines):

| Required | Found |
|---|---|
| Imports rewritten to `../src/planning/plan-decomposer` | ✓ Lines 7-12 |
| Imports rewritten to `../src/planning/errors` | ✓ Line 13 (`PlannerConfigError`) |
| `PlanDecomposer template mode` describe block (2 cases) | ✓ Lines 133-157 |
| `PlanDecomposer oracle-plan mode (structured output)` describe block (8 cases) | ✓ Lines 159-355, **describe block + every `decompose(..., "oracle-plan", ...)` literal renamed correctly** |
| `PlanDecomposer no-API-key path (CRITICAL-1 regression)` describe block (4 cases) | ✓ Lines 357-428 |
| `splitByConnectives` describe block (2 cases) | ✓ Lines 430-444 |
| Total cases preserved (16) | ✓ All present |
| `EVAL_PLANNER=oracle-plan` (not `frontier`) in CRITICAL-1 message assertions | ✓ Lines 418, 426 — actively asserts P2's fix |
| No `Effect.catchAll` / `mapError` / `option` / `ignore` / `orElseSucceed` introduced | ✓ Confirmed via `grep -E "Effect\.(catchAll\|option\|ignore\|orElseSucceed\|mapError)"` → zero hits |
| Failure-path tests use `Effect.runPromiseExit` + `Cause.findErrorOption` (proper Effect testing) | ✓ Lines 217, 238, 256, 274, 311, 339, 387, 404 |
| CRITICAL-1 layer construction reflects evals-local wiring (`Layer.provide(emptyConfigProviderLayer)`, not the deleted CLI wiring comment) | ✓ Lines 358-370, comment correctly updated to "what the eval harness wires via @neuve/evals" |

The port is faithful and the new `EVAL_PLANNER=oracle-plan` assertions in CRITICAL-1 (lines 418, 426) double as a guard against M2 regressing in the future. **M1 resolved.**

### M2 — message rename verification

`packages/evals/src/planning/errors.ts` (full file post-P2):

```ts
// PlannerConfigError
displayName = `Oracle planner not configured`;
message = `Oracle planner not configured: ${this.reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in your shell (or a dotenv file loaded by perf-agent) before running the eval harness with EVAL_PLANNER=oracle-plan.`;

// PlannerCallError
displayName = `Oracle planner call failed`;
message = `Oracle planner call failed: ${this.cause}`;
```

Diff vs Round 1 baseline (`git diff e71f5329..35d2ff44 -- packages/evals/src/planning/errors.ts`): exactly 4 string replacements across 2 classes. No collateral changes (`DecomposeError` left untouched — its own message reads `Plan decomposition (${this.mode}) failed` which is mode-agnostic and correct).

The PlannerCallError rename from `"Frontier planner call failed"` → `"Oracle planner call failed"` is **consistent, not scope creep**: it's the same Frontier→Oracle theme, and Round 1's S2 explicitly suggested doing exactly this. Both changes belong in the same commit.

**M2 resolved.**

### Round 1 minor / suggestions follow-up

- **m1 (`@ai-sdk/provider` version bump)** — diary commit `f241cbf6` adds a "Minor (m1)" subsection that records the bump from `^3.0.8` (supervisor pre-removal) to `4.0.0-beta.12` (evals post-removal) and notes the test fixture's `LanguageModelV4CallOptions` import resolves against the v4 beta surface. **Acknowledged in record.**
- **S1, S2, S3** — all three suggestions executed (path-rewritten imports in P1, displayName renamed in P2, diary call-out in `f241cbf6`).
- **S4** — non-blocking note about `Stream.mapError` in executor.ts; left as-is (pre-existing).

### Round 2 findings

None.

### Final verdict: APPROVE

The Option-B excision is now structurally clean **and** has preserved test coverage for the moved code. Safe to merge from the backend/architecture lane's perspective. Lane B (CLI/UI/docs/eval lit) sign-off still required before final merge.
