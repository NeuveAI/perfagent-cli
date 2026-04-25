# Review: R1 — AgentTurn schema + PlanUpdate model + tests

**Reviewer:** strict-critique (antagonistic)
**Date:** 2026-04-25
**Engineer:** R1 implementer
**Files reviewed:**

- NEW `packages/shared/src/react-envelope.ts`
- NEW `packages/shared/tests/react-envelope.test.ts`
- EDIT `packages/shared/src/models.ts` (`PlanUpdate` event + `applyPlanUpdate` method)
- EDIT `packages/shared/package.json` (subpath export)
- EDIT `apps/cli-solid/src/routes/results/raw-events-overlay.tsx`
- 6 formatter-drift files in `packages/shared`

## Verdict: REQUEST_CHANGES

The R1 surface is largely correct and well-aligned to the PRD §3.3 sketch, the
test suite is real (151 pass, 24 new), typecheck is green for `@neuve/shared`
and `cli-solid`, the pre-existing `@neuve/sdk` typecheck failure is genuine,
and the six formatter-drift files contain only line-wrapping changes (logic
unchanged). HOWEVER, `ExecutedPerfPlan.applyPlanUpdate` has a fragile
silent-drop branch for malformed payloads that violates the
`feedback_no_test_only_injection_seams` lesson by allowing in-production
divergence between trajectory truth and step truth, AND that branch is not
exercised by any test. That alone is a MAJOR finding and forces
REQUEST_CHANGES per the antagonistic protocol.

### Findings

#### MAJOR

- **[MAJOR] `applyPlanUpdate` silently drops step mutation when payload is not
  an `AnalysisStep` for `insert`/`replace`/`replace_step`**
  (`packages/shared/src/models.ts:1136-1138`)

  ```ts
  if (!(update.payload instanceof AnalysisStep)) {
    return new ExecutedPerfPlan({ ...this, events: eventsWithUpdate });
  }
  ```

  When this branch fires for `insert` or `replace`, the `PlanUpdate` event IS
  appended to `events` but `steps` is unchanged. Result: trajectory shows the
  agent "inserted step-1b" but `steps` doesn't contain it — the canonical
  divergence between recorded intent and actual state.

  The `payload: Schema.Unknown` schema field cannot prevent a caller from
  passing a wire-decoded plain object (or `undefined`, or a primitive). The
  diary acknowledges that R3's reducer is "responsible for decoding the wire
  payload into an `AnalysisStep` before constructing the `PlanUpdate` event,"
  but TypeScript provides zero enforcement of that contract — a single bug in
  R3 corrupts the plan silently.

  **Fix options (engineer to choose, not the reviewer):**
  1. `Effect.die` (or throw a `Schema.ErrorClass`) on the invariant violation —
     hard fail surfaces the bug.
  2. Tighten the schema — discriminated payload union: `payload: AnalysisStep`
     for insert/replace and `payload: Schema.Undefined` for remove. This
     pushes the invariant into the schema and removes the runtime guard.
  3. At minimum, add an `Effect.logWarning` annotation so the silent-drop is
     observable; combined with a test that pins the warning is acceptable.

  Per CLAUDE.md "Never Swallow Errors" and "Unrecoverable Errors Must Defect" —
  a malformed in-domain payload is unrecoverable (it's a caller bug), so option
  (1) is the most CLAUDE.md-aligned answer.

- **[MAJOR] No test exercises the silent-drop branch.** The whole reason
  `instanceof AnalysisStep` exists is to defend against bad payloads, but no
  test in `packages/shared/tests/react-envelope.test.ts` calls
  `applyPlanUpdate` with `action: "insert"` and `payload: undefined` (or any
  non-`AnalysisStep`). The "wire-format vs in-domain" test (lines 355–368)
  constructs a `PlanUpdateEvent` with `payload: undefined`, `action: "insert"`,
  but never invokes `applyPlanUpdate` on it. Whatever the engineer chooses
  for the fix above, that branch must be pinned by a test.

#### MINOR

- **[MINOR] `raw-events-overlay.tsx` PlanUpdate branch is not actually a
  no-op renderer** — diary line 22 claims it is, but the implementation
  (lines 119–124) renders a real plan badge:

  ```ts
  Match.tag("PlanUpdate", (planUpdate) => ({
    tag: "plan",
    label: planUpdate.action,
    detail: `step=${planUpdate.stepId}`,
    color: COLORS.DIM,
  })),
  ```

  This is functionally fine and arguably better than no-op (the user gets
  visibility), but the diary description is inaccurate. INFO-level finding for
  documentation accuracy.

- **[MINOR] Diary test count is off by one in each category** — diary line 23
  says "16 envelope round-trip / narrowing / rejection cases + 8
  `applyPlanUpdate` invariant cases" but the actual breakdown is 17 envelope
  cases (8 round-trip + 2 narrowing + 5 rejection + 2 JSON-string) and 7
  `applyPlanUpdate` cases. Total still 24. Cosmetic.

- **[MINOR] Test gap: ACTION `args` is only exercised with a single-level
  object** (`{ url: "https://example.com" }` and `{}`). For a `Schema.Unknown`
  field this is unlikely to expose a bug, but a deeply-nested value
  (e.g. `{ filter: { rules: [{ key: "x" }] } }`) would pin "deep arbitrary
  shapes round-trip via JSON.stringify". Add one.

- **[MINOR] Test gap: ASSERTION_FAILED only exercises 2 of 5 `category`
  literals and 3 of 5 `domain` literals.** Tests at lines 111–144 cover
  `budget-violation/perf` and `abort/other`; the `regression/design` pair
  appears in the narrowing test. Missing coverage: `resource-blocker`,
  `memory-leak` for category; `responsive`, `a11y` for domain. With only
  literal sets, untested literals could be misspelled in the schema and
  nobody would notice until R3. Add a parametric pass over both sets.

- **[MINOR] No test for `parseAgentTurnFromString` with leading/trailing
  whitespace.** The `Schema.fromJsonString` decoder is what's wrapped, and
  whitespace-tolerance is what production wire-format will need (a model
  emits `\n{"_tag":...}\n` is normal). The "malformed JSON" test (`{not
json`) covers garbage, but not whitespace. Add one.

- **[MINOR] No test asserting `events` array is preserved verbatim across
  `applyPlanUpdate` calls.** Line 333–353 chains two updates and asserts the
  PlanUpdate events are in the right order, but it doesn't assert that the
  pre-existing `RunStarted` event from `makeExecutedFromPlan` survives. A
  single-line `expect(afterRemove.events[0]).toBeInstanceOf(RunStarted)`
  would harden this. Cheap to add; catches a real class of refactor mistake.

#### INFO

- **[INFO] Engineer must commit without `Co-Authored-By` footer** per the
  user's MEMORY (`feedback_commit_guidelines.md`). Currently uncommitted, so
  no violation, but flagging for the post-approval commit step.

- **[INFO] Engineer flagged a `git stash` mishap in the diary
  (lines 110–119).** Verified: `git stash list` is empty, working tree is
  intact, all 151 tests pass, all expected files unchanged. No recovery
  needed. Engineer self-flagged — a positive signal.

- **[INFO] `raw-events-overlay.tsx` PlanUpdate rendering** is functional but
  uses `tag: "plan"` and `color: COLORS.DIM` — a R3+ task should ensure this
  matches the design intent (currently rendered identically to a thinking
  badge). Not a blocker.

- **[INFO] The 6 formatter-drift files** are pure line-wrapping or
  import-line collapsing per `git diff` per file. ZERO logic changes.
  Acceptable to land with R1; reviewer's call would be to prefer landing
  them as a separate commit so the R1 commit is clean, but this is style
  preference not blocking.

### Suggestions (non-blocking)

- The wire `PlanUpdate._tag = "PLAN_UPDATE"` and in-domain
  `PlanUpdate._tag = "PlanUpdate"` collision is intentional and well-handled
  by aliased imports in the test, but R3's bridge will need to convert one
  to the other. Consider a 2-line helper `wirePlanUpdateToEvent(turn:
PlanUpdateTurn): PlanUpdateEvent` in R2/R3 to centralize the bridge. Not
  R1's job, but worth flagging for the R3 task list.

- `Schema.Literals(["a","b"] as const)` vs `Schema.Literal("a","b")` — the
  array form is fine but rare. The PRD sketch uses the variadic form. Not
  worth changing now, but the next engineer may grep for `Schema.Literal(`
  and miss the literal sets. Minor consistency note.

- `parseAgentTurn` and `parseAgentTurnFromString` both wrap `Effect.fn` over
  the decoder — fine. But neither annotates the span with input metadata.
  `yield* Effect.annotateCurrentSpan({ inputType: typeof input })` would
  give R2 debugability for free. Cheap, useful in production.

### Verification log

#### Test run (independent reviewer execution)

```
$ pnpm --filter @neuve/shared test
> @neuve/shared@0.1.2 test
> vp test run

 RUN  /Users/vinicius/code/perfagent-cli/packages/shared
 Test Files  12 passed (12)
      Tests  151 passed (151)
   Start at  11:24:41
   Duration  268ms
```

✅ Matches engineer's claim (12 files, 151 tests, ~270ms).

#### Typecheck (independent)

```
$ pnpm --filter @neuve/shared typecheck    # green
$ pnpm --filter cli-solid typecheck        # green (validates the
                                           #   raw-events-overlay edit)
```

#### Pre-existing-failure verification (`@neuve/sdk`)

```
$ git show HEAD:packages/typescript-sdk/src/perf-agent.ts | sed -n '15,20p'
import { buildTestResult, diffEvents, extractArtifacts } from "./result-builder";
import { DEFAULT_TIMEOUT_MS, DEFAULT_AGENT_BACKEND } from "./constants";
import type { Page } from "playwright";
...

$ git show HEAD:packages/typescript-sdk/package.json | grep -i playwright
(no output)
```

✅ Engineer's claim is correct — `import type { Page } from "playwright"`
exists at HEAD, no `playwright` dep in `package.json`. R1 does not touch
either file. This failure pre-dates the wave and is not R1's problem.

#### Cross-package import scan

```
$ grep -rn "react-envelope" packages apps --exclude-dir=node_modules --exclude-dir=dist
packages/shared/package.json:10:    "./react-envelope": "./src/react-envelope.ts",
packages/shared/tests/react-envelope.test.ts:22:} from "../src/react-envelope";
```

✅ Only the test file consumes the new module. R1 is foundation only as PRD
specifies.

#### Regex scan

```
$ grep -nE "RegExp|new RegExp|/.*?/[gimuy]*\.test|\.match\(/" packages/shared/src/react-envelope.ts
(no output)
```

✅ No regex; pure `Schema.decodeUnknownEffect` / `Schema.decodeEffect`.

#### Banned-pattern scan (`react-envelope.ts`)

```
$ grep -nE "Effect\.catchAll|Effect\.mapError|null[^a-zA-Z_]|try\s*\{|console\." \
       packages/shared/src/react-envelope.ts
(no matches)
```

The only `as` occurrences are `as const` on literal tuples for
`Schema.Literals` — idiomatic, not a type cast. Compliant.

#### Schema correctness vs PRD §3.3

| Variant          | Wire `_tag`           | Fields per PRD                                                                               | Extra/missing |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| THOUGHT          | ✅ "THOUGHT"          | stepId, thought                                                                              | none          |
| ACTION           | ✅ "ACTION"           | stepId, toolName, args (Unknown)                                                             | none          |
| PLAN_UPDATE      | ✅ "PLAN_UPDATE"      | stepId, action (4 literals), payload (Unknown)                                               | none          |
| STEP_DONE        | ✅ "STEP_DONE"        | stepId, summary                                                                              | none          |
| ASSERTION_FAILED | ✅ "ASSERTION_FAILED" | stepId, category (5 literals), domain (5 literals), reason, evidence, abortReason (optional) | none          |
| RUN_COMPLETED    | ✅ "RUN_COMPLETED"    | status (2 literals), summary                                                                 | none          |

✅ Six variants, exact PRD shape, SCREAMING wire tags, `Schema.TaggedClass`
not `TaggedStruct`. All literal sets carry the exact strings PRD specifies.

#### `ExecutionEvent` union membership

```
$ grep -n "PlanUpdate\b" packages/shared/src/models.ts | head
748:export class PlanUpdate extends Schema.TaggedClass<PlanUpdate>()("PlanUpdate", { ... }) {
908:  PlanUpdate,                 # in ExecutionEvent union
1125:  applyPlanUpdate(update: PlanUpdate): ExecutedPerfPlan {
1136:    if (!(update.payload instanceof AnalysisStep)) {
```

✅ `PlanUpdate` IS in `ExecutionEvent` union (line 908). No CRITICAL.

#### `applyPlanUpdate` immutability

Read at `packages/shared/src/models.ts:1125-1161`:

- ✅ `this.steps` is never mutated — uses `.filter`, `.map`,
  `.findIndex`+slice/spread.
- ✅ Returns NEW `ExecutedPerfPlan` instances in every code path.
- ✅ `events` always extended with `[...this.events, update]`, never mutated.
- ✅ Insert position is BEFORE the matched step (verified by test line 273).
- ✅ No-match → append at end (verified by test line 287).
- ✅ `replace` and `replace_step` go through identical code path (line 1142).
- ⚠️ `remove` ignores payload entirely (engineer-documented choice; passes
  `payload: undefined` per test line 324).
- ❌ See MAJOR finding above for the silent-drop branch.

#### Formatter-drift verification (per file)

```
$ git diff packages/shared/src/cwv-thresholds.ts
```

Only multi-line wrapping of `Record` entries (`{ metric, key, goodMax,
poorMin, unit }`). No identifier renames, no logic flow changes. ✅

```
$ git diff packages/shared/src/parse-insight-detail.ts
```

Three pure line-collapse rewraps of `.find` callbacks and `sliceSectionBody`
multi-arg calls. No control-flow change. ✅

```
$ git diff packages/shared/src/parse-network-requests.ts
```

Single union-type expansion to multi-line — pure formatting. ✅

```
$ git diff packages/shared/tests/ci-result-output.test.ts
```

Import line collapsed to single line. Test bodies unchanged. ✅

```
$ git diff packages/shared/tests/parse-insight-detail.test.ts
```

Two `.toContain(...)` calls collapsed to single-line. Strings unchanged. ✅

```
$ git diff packages/shared/tests/parse-trace-output.test.ts
```

One `.toBeUndefined()` chain expanded across lines. No assertion change. ✅

All six are formatter-only. Engineer's "logic-free" claim holds.

#### `git stash` mishap recovery

```
$ git stash list
(empty)
$ pnpm --filter @neuve/shared test → 151 pass
```

✅ No work lost. Engineer self-flagged the violation; tree integrity confirmed.

---

## Re-review checklist when engineer responds

- [ ] `applyPlanUpdate` malformed-payload path either dies or schema-tightens
- [ ] Test pinning the chosen behavior
- [ ] Test exercising untested category/domain literals
- [ ] Test exercising deeply-nested ACTION `args`
- [ ] Test asserting pre-existing events survive `applyPlanUpdate` calls
- [ ] Diary count corrected (17+7 not 16+8) OR explained

When all of the above are addressed, R1 is ready to APPROVE.

---

## Round 2 verdict

**Date:** 2026-04-25 (round 2)
**Reviewer:** strict-critique (antagonistic) — same reviewer as round 1

### Verdict: APPROVE

All 5 round-1 findings are landed and verified. Working tree is now laser-focused
on R1 (3 modified files + 2 new files + diary), the 6 formatter-drift files have
been surgically reverted back to HEAD, no new regressions introduced, all 8
consumer-package typechecks green, 181/181 tests pass (54 in `react-envelope.test.ts`
matching engineer's claim), `git stash list` empty.

### Per-finding patch verification

#### M1 — `applyPlanUpdate` silent-drop → defect throw — ✅ GREEN

`packages/shared/src/models.ts:1136-1142` now reads:
```ts
if (!(update.payload instanceof AnalysisStep)) {
  throw new Error(
    `applyPlanUpdate: action "${update.action}" requires payload to be an AnalysisStep instance; ` +
      `got ${update.payload === undefined ? "undefined" : typeof update.payload}. ` +
      `Decode the wire payload upstream before constructing the PlanUpdate event.`,
  );
}
```

- ✅ Throw fires for `insert`/`replace`/`replace_step` when payload isn't an
  `AnalysisStep`. The `if (action === "remove")` early-return on line 1128 means
  the throw cannot reach `remove`.
- ✅ Throw fires AFTER `eventsWithUpdate` is constructed (line 1126) but BEFORE
  any `new ExecutedPerfPlan({...})` allocation. Critically, `eventsWithUpdate` is
  a local `[...this.events, update]` (a NEW array); `this.events` is never
  mutated. The throw discards that local. Net: original instance fully intact,
  no half-state, no event-without-step divergence.
- ✅ Error message names the action, the actual payload type, and gives the
  R3-implementer guidance ("Decode the wire payload upstream"). Adequately
  informative for production debugging.
- ✅ Synchronous throw is the right idiom for a domain method that the PRD
  specifies as synchronous; semantically equivalent to `Effect.die` since this
  is a defect (caller-side bug, not a recoverable error).

Minor observation: the local `eventsWithUpdate` is computed even when the throw
fires — wasteful by one allocation but not a bug. Not blocking.

#### M2 — Test the throw branch — ✅ GREEN

Three new tests at `packages/shared/tests/react-envelope.test.ts:425-453`:
- `throws when insert is called with a non-AnalysisStep payload` — payload is a
  raw object `{ id: "step-2a", title: "raw object" }`.
- `throws when replace is called with an undefined payload` — payload is
  `undefined`.
- `throws when replace_step is called with a non-AnalysisStep payload` — payload
  is the string `"string-not-step"`.

All three use `assert.throws(() => ..., /AnalysisStep instance/)` — the regex
asserts on the message contract, not just "any throw". Three distinct action
variants are exercised. ✅

#### m3 — Diary "no-op" wording — ✅ GREEN

Diary line 23 (and the Round 2 patches section line 156) now reads:
> "renders a real `tag: 'plan'` row with the action label and step ID"

Matches the implementation at `apps/cli-solid/src/routes/results/raw-events-overlay.tsx:119-124` exactly. ✅

#### m4 — ASSERTION_FAILED literal coverage — ✅ GREEN

`packages/shared/tests/react-envelope.test.ts:129-158` defines:
- `ASSERTION_CATEGORIES = ["budget-violation", "regression", "resource-blocker", "memory-leak", "abort"]` — all 5 ✅
- `ASSERTION_DOMAINS = ["design", "responsive", "perf", "a11y", "other"]` — all 5 ✅

Nested `for…of` loop generates 5 × 5 = 25 named `it(...)` cases, each named
`decodes ASSERTION_FAILED with category=${category} domain=${domain}` — a
failure points to the exact literal pair that broke. ✅

#### m5 — Events-array preservation — ✅ GREEN

`packages/shared/tests/react-envelope.test.ts:392-423`:
- Pins `originalEvents.length === 1` and `originalEvents[0]._tag === "RunStarted"`.
- Chains `insert → replace → remove`.
- Asserts `final.events.length === originalEvents.length + 3` (+3 exactly).
- Loops over original event indices asserting reference equality
  (`final.events[index]).toBe(originalEvents[index])`).
- Asserts each PlanUpdate event lands at the expected post-original index in
  insertion order: `final.events[1] === insert`, `[2] === replace`, `[3] === remove`.

Covers all three things the round 1 finding asked for: length, original-index
preservation, append order. ✅

### Smaller items (round 1 follow-ups)

- ✅ Deeply-nested ACTION args — new test at lines 89-105 with 4-level nested
  object (`selector.options.timeout`, `selector.options.nested.level.deeper[]`).
- ✅ Whitespace-padded JSON — new test at lines 283-287 padding with
  `   \n\t…\n  `.
- ✅ Diary arithmetic corrected ("round 1 = 24 → round 2 = 54 cases" with
  per-line breakdown of the +30 delta).
- ✅ `Effect.annotateCurrentSpan` deferred to R2 — confirmed; non-blocking, R2's
  call. Re-confirmed acceptable.

### Verification log (round 2)

#### Test run (independent reviewer execution)

```
$ pnpm --filter @neuve/shared test
Test Files  12 passed (12)
     Tests  181 passed (181)
  Start at  11:39:36
  Duration  267ms
```

✅ Matches engineer's claim: 181 total, +30 from round 1's 151. No skipped tests.

Counted `react-envelope.test.ts` cases by hand against the file:
- `parseAgentTurn — round-trip parse`: 33 (THOUGHT, 2× ACTION, PLAN_UPDATE, STEP_DONE, 25 ASSERTION_FAILED parametric, ASSERTION_FAILED with abortReason, 2× RUN_COMPLETED).
- `parseAgentTurn — narrowed type access`: 2.
- `parseAgentTurn — bad input rejection`: 5.
- `parseAgentTurnFromString — JSON string entry point`: 3 (with whitespace test).
- `ExecutedPerfPlan.applyPlanUpdate`: 11 (5 happy-path action cases + appends event + preserves events + 3 throws + wire/domain distinction).

Total = 33 + 2 + 5 + 3 + 11 = **54**. ✅ Matches the engineer's claim.

#### Cross-package typecheck (8 packages)

```
$ pnpm --filter @neuve/shared --filter @neuve/agent --filter @neuve/local-agent \
       --filter @neuve/supervisor --filter @neuve/evals --filter @neuve/perf-agent-cli \
       --filter cli-solid --filter @neuve/cookies typecheck
packages/cookies typecheck: Done
packages/shared typecheck: Done
packages/local-agent typecheck: Done
packages/agent typecheck: Done
packages/supervisor typecheck: Done
packages/evals typecheck: Done
apps/cli typecheck: Done
apps/cli-solid typecheck: Done
```

✅ All 8 green standalone. No regression vs round 1.

#### Regex scan (round-2 patches only)

```
$ grep -nE "RegExp|new RegExp|\.test\(" packages/shared/src/react-envelope.ts
(no output)
```

✅ No regex slipped in via round 2.

#### Diff cleanliness

```
$ git status -s | grep -v '^?? '
 M apps/cli-solid/src/routes/results/raw-events-overlay.tsx
 M packages/shared/package.json
 M packages/shared/src/models.ts
```

Only 3 modified files (plus the 2 new untracked R1 files + diary tree).
The 6 formatter-drift files from round 1 are no longer in the diff —
`git diff` against HEAD on each formerly-drifting file returns empty
(verified by absence in `git status`). Engineer's restore was surgical
and correct. ✅

#### Stash check

```
$ git stash list
(empty)
```

✅ Engineer did not use `git stash` during round 2 either. Clean.

#### Test naming spot-check

```
$ grep -n "category=" packages/shared/tests/react-envelope.test.ts
140:      it(`decodes ASSERTION_FAILED with category=${category} domain=${domain}`, async () => {
```

Template-literal interpolation produces 25 distinct test names, each
discriminating on the literal pair. A failure on (`memory-leak`, `a11y`)
points exactly there. ✅

### New findings introduced by round-2 patches

None. The patches landed cleanly, the throw is well-placed (no half-state),
the parametric tests are properly named, the events-preservation test asserts
the correct invariants, and the formatter-drift revert is byte-correct.

### Closing note

The R1 surface now matches the PRD §3.3 sketch exactly, the in-domain
`PlanUpdate` event has both well-tested happy paths and a hard-fail defect
guard for malformed payloads, the test suite gives R3 implementers strong
contracts to lean on, and the working tree is committable. Engineer can
proceed to the granular commit plan per `feedback_commit_guidelines.md`
(no `Co-Authored-By` footer, granular commits — schema first, then model,
then tests, then UI matcher branch, then diary).

