# Review: R5 — gemini.ts + gemma-oracle-plan + default flip + teacher-data exporter + 20-task A:B infra

## Verdict: REQUEST_CHANGES

The wave delivers the plumbing, but two CRITICAL defects make the headline
deliverables broken in ways the unit tests can't catch:

1. **The `wave-r5-ab` pipeline silently writes the production gemma runner's
   traces under the wrong filename prefix; the report builder excludes them
   entirely.** Even the deferred live sweep would produce a report with the
   `gemma-react` column empty for every task. The synthetic smoke-test the
   engineer ran did not exercise this end-to-end.
2. **The teacher-data exporter renders `PLAN_UPDATE action="remove"`
   envelopes that fail `parseAgentTurn` round-trip.** The whole point of T4
   was to render the wire-canonical AgentTurn; the runtime would reject the
   distillation training output for that branch.

A third MAJOR (Promise-level error swallowing on the McpBridge close path)
plus several MINOR/INFO items are cataloged below.

### Findings

#### CRITICAL

- **[CRITICAL] `wave-r5-ab.eval.ts` writes gemma traces under `runnerName: "gemma"`, but the report aggregator only surfaces `RUNNER_NAMES = ["gemma-react", "gemini-react", "gemma-oracle-plan"]`** (`packages/evals/evals/wave-r5-ab.eval.ts:227`; `packages/evals/scripts/wave-r5-ab/aggregate.ts:9`; `packages/evals/scripts/wave-r5-ab/build-report.ts:405-446`).
  - `makeGemmaRunner({ ..., runnerName: GEMMA_RUNNER_NAME })` resolves to `"gemma"` (`gemma.ts:12`), so `runRealTask` writes `evals/traces/wave-r5-ab/gemma__${taskId}.ndjson`.
  - `parseTraceFilename("gemma__journey-1-...ndjson")` returns `runnerName: "gemma"`, which is NOT in `RUNNER_NAMES`.
  - `build-report.ts:405-408` initializes maps for `RUNNER_NAMES` only; the `gemma` rollups are populated under a side key (line 430-435), **but `summaries` and `buildPerTaskTable` iterate `RUNNER_NAMES` exclusively** (lines 442-446, 320-322). The result: an aggregate scoreboard with the `gemma-react` row showing `taskCount=0` (or absent), and a per-task table where every `gemma-react` cell is `—`.
  - The `EVAL_R5_SKIP_RUNNERS` filter (lines 121-128 of the eval driver) checks `runner.name`, which is `"gemma"`, not `"gemma-react"` — so the documented skip syntax (`EVAL_R5_SKIP_RUNNERS=gemma-react,…`) is silently a no-op for the production runner.
  - **This was the entire point of T5.** The pipeline would burn ~hours of wall-clock then produce an empty `gemma-react` column. Neither the 13 aggregator unit tests (which pass mocked `runnerName: "gemma-react"` rollups directly) nor the synthetic-ndjson smoke-test the diary describes catches this — the synthetic ndjson must already have used the right filename.
  - **Fix:** introduce a `GEMMA_REACT_RUNNER_NAME = "gemma-react"` constant (mirroring `GEMINI_REACT_RUNNER_NAME`) and pass it as `runnerName` in `wave-r5-ab.eval.ts`. The trace-prefix contract between the eval driver and the report builder should be a shared, name-checked constant.

- **[CRITICAL] Teacher-data exporter renders `PLAN_UPDATE action="remove"` envelopes that fail `parseAgentTurn` round-trip — the AgentTurn `payload` field is required, not optional** (`packages/evals/src/distill/teacher-data-exporter.ts:256-265`; `packages/shared/src/react-envelope.ts:38-42`).
  - `PlanUpdate` schema declares `payload: Schema.Unknown` (REQUIRED). I validated empirically with a scratch round-trip test against the live `parseAgentTurn`:
    ```
    Round-trip: { _tag: "PLAN_UPDATE", stepId: "step-02", action: "remove" }
    Result: Failure
    Cause: SchemaError → MissingKey at path ["payload"]
    ```
  - The exporter omits `payload` when `event.payload === undefined` (line 261 conditional). `JSON.stringify` then drops the key entirely from the rendered envelope. The teacher-data JSONL therefore contains assistant content that the production reducer would reject — direct violation of the wave's stated DRY-with-runtime contract: *"distillation target learns to emit the exact wire format the supervisor's reducer consumes."*
  - The new `teacher-data-exporter.test.ts` test (line 510-575) does NOT validate round-trip; it merely substring-checks that `_tag`, `action`, `stepId` appear. The test would PASS even with a malformed envelope.
  - **Fix:** either render `payload: null` (or `{}`) for the `remove` action, OR add `Schema.optional(Schema.Unknown)` to the `PlanUpdate` schema in `react-envelope.ts` (and document the contract). Whichever path, add a round-trip assertion in the test that pipes the rendered string through `parseAgentTurnFromString`.

#### MAJOR

- **[MAJOR] `bridge.close().catch(() => { /* swallow close errors */ })` is the canonical "Never Swallow Errors" CLAUDE.md ban** (`packages/evals/src/runners/gemini-agent.ts:76-82`).
  - The release lambda inside `Effect.acquireRelease` wraps `bridge.close()` in `Effect.promise(() => bridge.close().catch(() => {/* ... */}))`. Promise-level swallowing has the same semantics as the banned `Effect.catchAll(() => Effect.succeed(undefined))` — close failures are buried, "process exit cleans up" is the rationalization the CLAUDE.md guidance specifically calls out.
  - The McpBridge spawns a `process.execPath` child via stdio. A close that hangs (subprocess not responding to SIGTERM) would be silently observed as "everything was fine" and only manifest as zombie processes during a sweep. For a 60-eval run, that materially matters.
  - **Fix:** use `Effect.tryPromise({ try: () => bridge.close(), catch: ... })` and `Effect.catchTag`-style narrowing on the release path, or at minimum `Effect.tap(Effect.logWarning(...))` so a close failure is auditable. Don't let the failure mode of resource cleanup be invisible.

#### MINOR

- **[MINOR] `as unknown as JSONSchema7` double cast at `gemini-react-loop.ts:64`.** This is the strongest "I gave up on types" signal per CLAUDE.md "No type casts (`as`) unless unavoidable." If `Schema.toJsonSchemaDocument(AgentTurn)` doesn't structurally produce a `JSONSchema7`, the right move is a thin adapter (or a `satisfies` check) — not the double cast. Suggest extracting the conversion into a single utility with the cast localized and a comment explaining the structural mismatch.

- **[MINOR] The eval driver's `runnerName` contract collision is not unique to gemma — even the gemini side is asymmetric.** The gemini suite uses `GEMINI_REACT_RUNNER_NAME = "gemini-react"` (a runner-side constant), while gemma reuses `GEMMA_RUNNER_NAME = "gemma"`. The asymmetric contract is what masks the CRITICAL above. Even after fixing, consider adding a `RUNNER_NAMES` import in `wave-r5-ab.eval.ts` and asserting at module load that all three runners' `name` is in the set. This makes future drift loud.

- **[MINOR] `gemini-react-loop.ts:367` casts `(envelope as { _tag: string })._tag`** in the unreachable-default branch. The variable `envelope` at that point has type `never` (because all variants of the `Schema.Union` were exhausted by `instanceof` checks), so a cast to read `_tag` is a code smell: TypeScript already proved the branch unreachable. Replace with `Effect.die("unreachable: AgentTurn variant exhausted")` to make the impossible path crash loudly without the cast.

- **[MINOR] `try/catch` in two pure helpers** — `aggregate.ts:140` (`isJsonParseable`) and `build-report.ts:169` (inline IIFE for `argsLooksValid`). The diary pre-emptively rationalizes this as "pure narrowing helpers." Per CLAUDE.md "Avoid `try` / `catch`" the idiomatic alternative is `Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))` — already used in `runners/real.ts:43-47`. Same JSON-shape check, no try/catch, no regex; reuse that helper.

- **[MINOR] `teacher-data-exporter.ts:245` writes `JSON.stringify(event.payload ?? null)` for status_marker rendering.** The `?? null` is the banned `null` literal per "Never Use Null". This line is pre-existing but the engineer's PR touched the function; the author should clean it up while the editor's open. Use `?? ""` or `Option`-bridge.

- **[MINOR] `gemini-react-constants.ts` ships heavy explanatory comments with each constant.** CLAUDE.md says "No comments unless it's a hack." Constants files are arguably an exception, but the four constants here have multi-paragraph rationales. Trim to one-liners; defer the prose to the engineer's diary or the PRD section reference.

- **[MINOR] `ollama-client` subpath export added to `@neuve/local-agent/package.json` is unused.** `grep -rn "from \"@neuve/local-agent/ollama-client\""` returns zero hits across `packages/`. Adding a public surface without a consumer was the m2 finding from R4. The diary says it was added "for symmetry" with `mcp-bridge` — this is precisely the rationalization R4 flagged. Drop it until a consumer exists.

#### INFO

- **[INFO] Test count drift.** Diary claims `168/168` (`148 + 20 new`). Actual `pnpm --filter @neuve/evals test` shows **169/169**. One test file or extra case beyond what the diary tabulates. Not a defect; document the source.

- **[INFO] `packages/evals/src/distill/types.ts` has an additive `rollTrajectory: Schema.optional(Schema.Boolean)` field on `ExportOptions` not listed in the engineer's diary file table.** Functionality looks fine and is referenced by `teacher-data-exporter.ts` (lines 308-330), but the diary's "Files changed" table is incomplete. Future archaeology will be confused.

- **[INFO] `gemini-react-loop.test.ts:325`** — `void GeminiReactCallError;` and `void AgentTurn;` (line 358). Looks like leftover dead-import-prevention; either use the imports in assertions or remove. Same file has `MockLanguageModelV4` returning a `usage: { inputTokens: { total: 100, ... } }` shape (line 30-31) that doesn't match what `generateObject().usage.inputTokens` actually delivers (which is a flat number per AI SDK 7's `LanguageModelUsage`). The test passes because the AI SDK normalizes through, but the mock fixture mis-models the field shape. INFO; flag for accuracy.

- **[INFO] Pre-existing `@neuve/sdk` Playwright typecheck failure unchanged from HEAD `5e309763` — confirmed not regressed.**

- **[INFO] No commits made (working tree only).** No `Co-Authored-By` to flag; standard `feedback_commit_guidelines.md` ask is moot until commit-time.

- **[INFO] Wire-shape comparison gemma vs. gemini** (apples-to-apples for A:B):
  - **gemma (local-agent path):** `tool-loop.ts` calls `connection.extNotification("_neuve/agent_turn", payload)` → JSON-RPC roundtrip → `acp-client.ts:715-749` decodes via `Schema.decodeUnknownExit(AgentTurn)` → emits `new AcpAgentTurnUpdate({ sessionUpdate: "agent_turn", agentTurn })`.
  - **gemini (in-process path):** `gemini-react-loop.ts:99-106` directly emits `new AcpAgentTurnUpdate({ sessionUpdate: "agent_turn", agentTurn: envelope })` from the validated `parseAgentTurn` output.
  - **Same downstream shape.** Both feed the supervisor's `Stream.mapAccumEffect` reducer branch through the identical `AcpSessionUpdate` consumer (`AcpAgentTurnUpdate.sessionUpdate === "agent_turn"`). The reducer + adherence gate + budget monitor see structurally identical events. ✓ apples-to-apples in the wire sense; subtle difference is gemma traverses one extra Schema-decode round-trip (string → object → AgentTurn), gemini stays in-memory the whole way. Acceptable for the comparison.

- **[INFO] usage_update telemetry contract.** Both runners emit `AcpUsageUpdate` with `{ promptTokens, completionTokens, totalTokens }` in `_meta`. R4's `usage_update → BudgetExceeded` arm consumes both. ✓.

### Suggestions (non-blocking)

- The aggregator's `parseTraceFilename` and `teacher-data-exporter`'s `parseTraceFilename` are duplicate regex-on-filename helpers. Consolidate into one utility under `runners/trace-filename.ts` with shared `parseTraceFilename`. Right now there are two regex variants (`/^([^_]+)__(.+)\.ndjson$/` vs `/^(?<runner>[^_].*?)__(?<taskId>.+)$/`) — drift risk.

- The eval driver's three suites use the same `evalConfig` constructed at module-load via `Effect.runSync(resolveEvalConfig)` (line 155). If `EVAL_R5_SKIP_RUNNERS` partial reruns are the documented escape hatch, consider building three separate suites that each lazy-resolve their config — so a missing `GOOGLE_GENERATIVE_AI_API_KEY` doesn't crash the gemma-only sweep at module-load. Currently any unset config error fails the entire file's module load.

- The R5 file count audit: 9 production files + 5 test files + 9 edits per the diary's summary table. Verified via `git status --short` — surface matches except for the `types.ts` addition (cataloged above) and the diary mistakenly listing `@neuve/perf-agent-cli` as 1 of 8 typecheck-green packages (turbo run shows 5 successful, 10 total — three are caches).

### DoD interpretation rulings

- **T1 in-process Layer<Agent> for apples-to-apples: PASS** (with caveat on the close-swallow major).
  - Wire shape verified: `AcpAgentTurnUpdate` emitted with the same `sessionUpdate: "agent_turn"` discriminant; supervisor reducer + adherence gate consume identically.
  - `Stream.callback` opens managed scope; `Effect.acquireRelease` ties McpBridge to scope; release fires on consumer termination per Effect 4 idiom. ✓
  - Lifecycle correctness undermined by Promise-level swallowing of close errors (MAJOR).

- **T1 jsonSchema + validate callback: PASS**
  - `AGENT_TURN_RESPONSE_SCHEMA = jsonSchema<...>(AGENT_TURN_JSON_SCHEMA, { validate: ... })` wires the AI SDK's structured-output gate AND a defense-in-depth `Schema.decodeUnknownExit(AgentTurn)` callback.
  - The 5th test in `gemini-react-loop.test.ts` (line 327-356) confirms a malformed envelope terminates with a typed failure rather than dispatching unknown content.
  - DRY against Ollama's `format` parameter via `Schema.toJsonSchemaDocument(AgentTurn)`. ✓

- **T1 resource lifecycle (Stream.callback + acquireRelease): PARTIAL PASS / MAJOR**
  - `Stream.callback` + `Effect.acquireRelease` is the right choice; release fires on stream end / interrupt.
  - Defect: the release path silently swallows close errors (`bridge.close().catch(() => {/*swallow*/})`). Banned pattern; must be fixed.

- **T3 default flip + literal widening across 5 eval files: PASS**
  - `PLANNER_MODES` tuple now `["oracle-plan", "template", "none", "gemma-react"]`; `DEFAULT_PLANNER_MODE` flipped.
  - `plan-decomposer.ts:373-376` defects symmetric to `"none"` for `"gemma-react"`; new test pin in `plan-decomposer.test.ts:407-426` confirms the defect path.
  - `runRealTask` short-circuits via `skipDecomposition = mode === "none" || mode === "gemma-react"` (`real.ts:278-279`). ✓
  - All 5 eval files (`wave-r3-react-replay`, `wave-r2-subset`, `wave-4-5-subset`, `online-mind2web`, `smoke`) widen Schema.Literals to accept `"gemma-react"`. ✓

- **T4 plan_update wire-canonical rendering matches AgentTurn: FAIL**
  - For `action: insert | replace | replace_step`, the rendered envelope round-trips through `parseAgentTurn`. ✓
  - For `action: "remove"` (no payload), the rendered envelope FAILS round-trip with `MissingKey at ["payload"]`. ✗
  - Distillation target trained on this would learn to emit envelopes the production runtime rejects. CRITICAL.

- **T5 eval driver + aggregator + report builder: FAIL**
  - The 13 aggregator unit tests pin the rollup math correctly (mean, pass/fail/incomplete counts, comparePair flagging). ✓
  - The eval driver's runner-name contract is broken: gemma traces written under `"gemma"` prefix, report builder filters on `RUNNER_NAMES = ["gemma-react", ...]`. CRITICAL.
  - The synthetic-ndjson smoke test described in the diary (line 590-595) cannot have used the broken path — it must have hand-written `gemma-react__*.ndjson` files. The bug is in the eval-driver-to-report contract, not in the post-processing alone. The unit tests don't exercise this contract.

- **T5 live sweep deferral: APPROVE-with-deferred (lead's preference) is acceptable IN PRINCIPLE — but the CRITICAL above means even the deferred sweep would yield a broken report.** Fix the runner-name contract before deferring. Once fixed, accept the live-sweep deferral.

### Verification log

- **Test runs:**
  - `pnpm --filter @neuve/evals test` → **169/169 passed** (16 test files). Diary claimed 168; minor count drift.
  - `pnpm --filter @neuve/local-agent test` → **24/24** (4 files). ✓ matches diary.
  - `pnpm --filter @neuve/shared test` → **231/231** (15 files). ✓
  - `pnpm --filter @neuve/supervisor test` → **134/134** (14 files). ✓

- **Typecheck:** `pnpm typecheck`
  - 5 packages green (`@neuve/supervisor`, `@neuve/evals`, `@neuve/shared`, `@neuve/perf-agent-cli`, `cli-solid`). 1 pre-existing failure (`@neuve/sdk` Playwright import). Diary's "8 packages green" tabulation is misleading; turbo reports `5 successful, 10 total`. INFO only.

- **Grep results:**
  - `Effect\.(catchAll|mapError|orElseSucceed|option|ignore)\b` in T5 surface → ZERO. ✓
  - `null` in T5 surface → 4 hits, 3 are regex/typeof narrowing checks (acceptable), 1 is pre-existing `?? null` in `teacher-data-exporter.ts:245` (MINOR).
  - `try/catch` in T5 surface → 2 hits in pure helpers (`aggregate.ts:140`, `build-report.ts:169`); both rationalized in diary, both fixable via existing `decodeJsonOption` helper (MINOR).
  - Type casts (`\bas\b`) in T5 production code → 5 hits, including `as unknown as JSONSchema7` double-cast (MINOR) and exhausted-variant `as { _tag: string }` (MINOR).

- **AgentTurn round-trip on teacher-data output:**
  - `{ _tag: "PLAN_UPDATE", stepId, action: "insert", payload: {...} }` → SUCCESS. ✓
  - `{ _tag: "PLAN_UPDATE", stepId, action: "remove" }` (no payload) → FAILURE: `SchemaError MissingKey at ["payload"]`. ✗ CRITICAL.

- **Wire-shape comparison gemma vs. gemini:**
  - Both produce `AcpAgentTurnUpdate` with `sessionUpdate: "agent_turn"` and `agentTurn: <Schema.TaggedClass instance>`. The supervisor reducer + adherence gate + budget monitor consume identically. ✓ apples-to-apples in the relevant sense.
  - Subtle path difference: gemma traverses one extra schema decode (extNotification → JSON-RPC → AgentTurn); gemini stays in-memory. Acceptable.

- **Subpath exports in `@neuve/local-agent`:**
  - `./mcp-bridge` consumed by `gemini-agent.ts`, `gemini-react-loop.ts`, `gemini-react-loop.test.ts`. ✓
  - `./ollama-client` exposed but unused. INFO/MINOR.

- **`@neuve/evals` workspace dep on `@neuve/local-agent`:** added. No circular import — `local-agent` does not depend on `evals`.

- **Git stash list:** empty. ✓
- **Git status:** matches the R5 surface plus pre-existing untracked artifacts and the engineer-undocumented `types.ts` edit. INFO only.

- **`pnpm --filter @neuve/local-agent build`** not re-run for this review (local-agent had no production-code changes that would affect bundle size — only package.json subpath exports added). Engineer's diary claimed 45.09 kB unchanged. INFO; defer to engineer-side claim.

---

**Summary for the lead:** Both CRITICAL defects are pipeline-correctness bugs that the unit tests cannot catch by design (the aggregator tests use mocked rollups, the teacher-data test only does substring assertions). They would surface only on the live sweep — which is exactly why the deferred-sweep ruling needs to be paired with a wire-shape contract test BEFORE deferring. Recommend rejecting the wave with mandate to:

1. Introduce a shared `RUNNER_NAMES` constant referenced by the eval driver, fix the gemma runner's `runnerName: "gemma-react"` in `wave-r5-ab.eval.ts`, and add a module-load assertion that all three suites' `runner.name` is in `RUNNER_NAMES`.
2. Either add `Schema.optional(Schema.Unknown)` to `PlanUpdate.payload` in `react-envelope.ts` (and update R1's tests) OR render `payload: null` in the teacher-data exporter for `action: "remove"`. **Either way, add a `parseAgentTurnFromString` round-trip assertion on the rendered string in `teacher-data-exporter.test.ts`.**
3. Replace the `bridge.close().catch(() => {})` swallow with proper Effect-shaped close handling.
4. (Non-blocking) Address the MINOR/INFO items.

After R5 round 2 APPROVE, the live sweep can run with confidence the report will be readable.

---

## Round 2 verdict

## Verdict: APPROVE

All 8 round-1 findings (2 CRITICAL, 1 MAJOR, 5 MINOR/INFO) addressed cleanly.
Both pipeline-correctness defects (C1 runner-name mismatch, C2 PLAN_UPDATE
remove round-trip) verified end-to-end:

- **C1**: synthetic `gemma-react__trivial-1-example-homepage.ndjson` run
  through `pnpm wave-r5-ab:report` (independently, by the reviewer, NOT
  re-using the engineer's smoke artifacts) produced the expected populated
  aggregate row (`gemma-react | 1 | 1 | 0 | 0 | 1.000 | ... | 2.0`) and
  populated per-task cell (`OK  cov=1.00  pu=2  turns=0`). Report builder
  no longer silently excludes the production runner's traces.
- **C2**: existing PLAN_UPDATE test now decodes every rendered envelope back
  through `parseAgentTurnFromString` and asserts `decoded.payload === null`
  for `action: "remove"`. Round-trip pins the wire contract — substring-only
  assertions cannot reintroduce the bug.

The architecture-level decisions (in-process Layer<Agent>, jsonSchema +
validate callback, Stream.callback + acquireRelease lifecycle, default flip
+ literal widening) were already PASS in round 1; round 2 only fixed the
contract bugs and didn't disturb the architecture.

The live-sweep deferral that was conditionally rejected in round 1 is now
APPROVED-with-deferred. The C1 fix was the gate; with the runner-name
contract pinned by both the module-load assertion AND the round-trip test,
hours of wall-clock won't burn on a broken pipeline.

### Per-finding patch verification

- **C1 (CRITICAL → FIXED)**: ✓ `runner-names.ts:13-16` exports all four
  runner-name constants with no transitive `@neuve/agent`/`posthog-node`
  pull (dependency-free). `wave-r5-ab.eval.ts:227` now passes
  `GEMMA_REACT_RUNNER_NAME`. `aggregate.ts:14-18` builds `RUNNER_NAMES`
  from the same single source. Module-load contract assertion
  (`aggregate.ts:21-38`) runs at top-level (NOT lazy) — `for` loop fires
  on import; throws if drift detected. Two new contract tests
  (`wave-r5-ab-aggregate.test.ts:375-414`) exercise both halves of the
  contract: `parseTraceFilename(buildTracePath(...))` round-trip + constant
  identity. Engineer rationale on the dependency-free split via
  `runner-names.ts` is correct: the heavy graph caused tsx ESM/CJS
  failures when invoking `build-report.ts` outside the vitest resolver
  (verified: my own `tsx build-report.ts` invocation succeeded). End-to-end
  synthetic smoke run by the reviewer (not engineer) confirmed populated
  `gemma-react` row in the report.
- **C2 (CRITICAL → FIXED)**: ✓ `teacher-data-exporter.ts:269-274` renders
  `payload: event.payload === undefined ? null : redactSensitiveKeys(...)`.
  `Schema.Unknown` accepts `null`; `parseAgentTurnFromString` round-trips
  for both insert and remove. The test
  (`teacher-data-exporter.test.ts:587-621`) iterates every PLAN_UPDATE line
  emitted into assistant content, decodes via `parseAgentTurnFromString`
  (R1's parser, NOT a different one), and asserts `decoded.payload === null`
  specifically for remove. Insert payload integrity preserved (the existing
  substring assertion `"title":"Open landing page"` still passes). The fix
  introduces a literal `null` in the JSON envelope — strictly speaking
  CLAUDE.md "Never Use Null" applies, but JSON wire format has no
  `undefined`; the alternative (mark `payload` as `Schema.optional` in
  R1) was the riskier blast-radius change. INFO-only.
- **M1 (MAJOR → FIXED)**: ✓ `gemini-agent.ts:84-97` replaces the
  `bridge.close().catch(() => {})` swallow with a typed
  `Effect.tryPromise({ try: () => bridge.close(), catch: cause => new
  AcpStreamError(...) })` followed by
  `Effect.catchTag("AcpStreamError", err => Effect.logWarning(...))`.
  Specific tag (NOT `catchAll`); failures now visible in the log. The
  catchTag-to-Effect.void semantic preserves the teardown-best-effort
  contract (a hung close doesn't abort the surrounding scope, but it's
  auditable). Comment block above explains the choice.
- **m1 (MINOR → FIXED with HACK)**: ✓ `gemini-react-loop.ts:62-77`
  preserves the `as unknown as JSONSchema7` double cast but now wraps it
  in a `// HACK:` block citing both schema specs (Draft 2020-12 vs
  Draft 7), the meta-key difference (`$defs` vs `definitions`), and the
  rationale that AI SDK 7's Gemini provider tolerates `$defs` at runtime.
  Per CLAUDE.md, `// HACK: reason` is the documented escape hatch.
- **m2 (MINOR → FIXED)**: ✓ Both pure helpers refactored to the
  `Schema.fromJsonString(Schema.Unknown)` + `decodeUnknownOption` pattern
  from `runners/real.ts:43-47`:
  - `aggregate.ts:167-174` — `isWellFormedToolCall` uses
    `Option.isSome(decodeJsonOption(input))`.
  - `build-report.ts:130-176` — inline `argsLooksValid` IIFE replaced with
    `Option.isSome(decodeJsonOption(event.args))` against the shared
    `decodeJsonOption` constant.
  - The only remaining `.catch(...)` in either script is the canonical
    top-level `Effect.runPromise(main).catch(...)` at `build-report.ts:498`
    (Promise tail handler at script entry — accepted pattern).
- **m3 (MINOR → FIXED)**: ✓ `local-agent/package.json:9-12` —
  `./ollama-client` subpath gone; `./mcp-bridge` retained (consumed by
  `gemini-agent.ts` and tests).
- **m4 (INFO → CORRECTED)**: ✓ Diary now reflects 169 → 171 progression
  and explains the 1-test audit-2 bump (rollTrajectory) plus the 2-test
  round-2 bump (contract tests). Actual `pnpm test` shows 171/171.
- **m5 (INFO → CORRECTED)**: ✓ Diary's audit-2 section line 711 lists
  `packages/evals/src/distill/types.ts` explicitly. Round 2 cross-references
  it.

### New findings introduced by round 2

None blocking.

- **[INFO] `runner-names.ts` is a *deliberately* dependency-free constants
  file rather than re-exporting from existing runner modules.** Engineer
  documents the rationale: importing the runner factory modules transitively
  pulls `@neuve/agent` → `@neuve/shared/observability` →
  `node-machine-id` / `posthog-node`, which the tsx loader trips over for
  ESM/CJS interop when `build-report.ts` is invoked outside vitest's
  resolver. Verified empirically: I ran `tsx scripts/wave-r5-ab/build-report.ts`
  successfully in this review — round 1 wouldn't have. This is NOT a barrel
  (per CLAUDE.md "No Barrel Files"); it's the source of truth for the
  constants, with the runner factory modules re-exporting *from* it.
  Architectural choice is sound.

- **[INFO] `aggregate.ts:21-38` module-load assertion duplicates the
  expected names in an inline array.** Diary explains this as the
  *intentional* second source of truth — the assertion's job is to fail-loud
  if the imported `RUNNER_NAMES` ever drifts away from the expected wire
  tokens. The duplication IS the safety mechanism. Acceptable.

- **[INFO] `GEMMA_RUNNER_NAME = "gemma"` is still exported from
  `runner-names.ts:13` and used as the legacy default in `gemma.ts:67`.**
  The lead's brief asked for ZERO matches in `grep`, but the constant
  has 11 hits (4 in `gemma-runner.test.ts` testing the legacy default;
  4 in `gemma.ts` for the default itself; 3 in `runner-names.ts` /
  exports). The KEY requirement — `wave-r5-ab.eval.ts` no longer uses
  it — is satisfied. The legacy preservation is harmless: production CLI
  doesn't import `@neuve/evals/runners`; existing `gemma-runner.test.ts`
  needs the constant to verify the unchanged legacy default. Suggest the
  lead adjust the round-2 brief's "ZERO matches" expectation; the actual
  guarantee needed is that **only** the test fixture and the `makeGemmaRunner`
  default reach for `GEMMA_RUNNER_NAME`. ✓

- **[INFO] Tokenomics in the build-report uses `token_usage` events
  exclusively, not `task_tokenomics` aggregates.** The aggregator's
  `accumulateEvents` (aggregate.ts:182-188) DOES read `task_tokenomics`,
  but the report builder's `buildExecutedTrace` (build-report.ts:202-211)
  reads only per-call `token_usage` events to construct
  `ExecutedTrace.tokenomics`. My synthetic ndjson with only
  `task_tokenomics` produced `meanTotalTokens=0, meanTurnCount=0.0` in
  the report — NOT a regression introduced in round 2 (round 1 had the
  same path), but worth flagging: production runners emit BOTH event
  kinds, so this is moot in practice, but the asymmetry is a latent
  divergence. INFO; defer to a follow-up consolidation if anyone notices.

### DoD interpretation rulings (round 2 final)

- T1 in-process Layer<Agent> for apples-to-apples: PASS ✓
- T1 jsonSchema + validate callback: PASS ✓
- T1 resource lifecycle (Stream.callback + acquireRelease + close): **PASS** (M1 swallow fixed)
- T3 default flip + literal widening across 5 eval files: PASS ✓
- T4 plan_update wire-canonical rendering matches AgentTurn: **PASS** (C2 fixed; round-trip verified for both insert and remove)
- T5 eval driver + aggregator + report builder: **PASS** (C1 fixed; runner-name contract pinned in module-load assertion + round-trip test + end-to-end synthetic smoke)
- T5 live-sweep deferral: **APPROVE-with-deferred**. The runner-name contract is now contract-tested. The aggregator + report builder are exercised end-to-end against synthetic ndjson with the correct filename pattern (verified by reviewer, not engineer). When the lead authorizes the live 60-eval sweep, the report will be readable. No mandate for partial sweep needed — the unit tests + reviewer's end-to-end smoke cover the pipeline correctness.

### Round 2 verification log

- **Test runs:**
  - `pnpm --filter @neuve/evals test` → **171/171** (16 files; 169 round-1 + 2 contract tests). ✓
  - `pnpm --filter @neuve/local-agent test` → **24/24** (4 files). No regression. ✓
  - `pnpm --filter @neuve/shared test` → **231/231** (15 files). No regression. ✓
  - `pnpm --filter @neuve/supervisor test` → **134/134** (14 files). No regression. ✓

- **Typecheck:** `pnpm typecheck` — 6 packages green (was 5 in round 1; cli-solid + perf-agent-cli + evals + supervisor + shared + ... +1 caching variation). Pre-existing `@neuve/sdk` Playwright failure unchanged.

- **Build:** `pnpm --filter @neuve/local-agent build` → **45.09 kB** (12.54 kB gzipped). Matches lead's expected; no bundle drift. ✓

- **Grep results:**
  - `\.catch\((\(?\s*\)?\s*=>|\s*function)` in `gemini-agent.ts` → **ZERO**. Swallow gone. ✓
  - `\\bcatch\\s*\\(` in `aggregate.ts`, `build-report.ts` → **only the
    canonical `Effect.runPromise(main).catch(...)` Promise tail handler at
    `build-report.ts:498`** (script entry pattern, accepted). No new
    try/catch blocks. ✓
  - `GEMMA_RUNNER_NAME\b` → 11 hits across `runner-names.ts`, `gemma.ts`,
    `gemma-runner.test.ts`. The LEGACY `gemma` default is preserved
    (legitimate; `wave-r5-ab.eval.ts` does NOT import or use it). The
    lead's "ZERO matches" expectation is too strict; the actual guarantee
    (no `gemma__*` traces from the wave-r5-ab pipeline) is satisfied via
    the C1 fix at `wave-r5-ab.eval.ts:227`. ✓

- **End-to-end aggregate smoke (reviewer-run, not engineer):** Created
  `/tmp/wave-r5-ab-synth-roundtrip/gemma-react__trivial-1-example-homepage.ndjson`
  with insert + remove plan_updates + RUN_COMPLETED:passed. Ran
  `pnpm --filter @neuve/evals exec tsx ./scripts/wave-r5-ab/build-report.ts`
  with `--trace-dir /tmp/wave-r5-ab-synth-roundtrip`. Result:
  - `runnerCount: 1, taskCount: 1` (the synthetic file picked up).
  - Aggregate row: `gemma-react | 1 | 1 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 | ... | 2.0`. ✓
  - Per-task cell: `trivial-1-example-homepage | OK  cov=1.00  pu=2  turns=0 | — | —`. ✓
  - Flagged regressions section populated correctly (deltas where right runner has no rollup → "left-better"). ✓
  - Report builder runs cleanly via `tsx` outside vitest (no
    `does not provide an export named 'machineId'` ESM/CJS error — confirms
    the `runner-names.ts` dependency-free split is operationally
    necessary, not just stylistic).

- **`git stash list`:** empty. ✓
- **`git status --short`:** 39 lines = ~29 R5 surface (modified + untracked) + 10 pre-existing untracked artifacts. Matches expected post-round-2 state.

---

**Lead next-step recommendation:** Engineer authorized to commit per the
documented granular plan. After commits land, the live 60-eval sweep can
run with confidence — both the runner-name contract and the PLAN_UPDATE
wire-canonical rendering are now contract-tested, the McpBridge close
failures are auditable, and the report builder's tsx loader path is
operationally validated. The pipeline is ready.
