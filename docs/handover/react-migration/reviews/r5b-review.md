# Review: R5b-T1 — dotenv + schema flatten + non-mock smoke probe

## Verdict: APPROVE

### Findings

- [INFO] No CRITICAL or MAJOR issues. All nine adversarial scenarios verified independently.

#### Verification log (executed by reviewer, not trusted from diary)

1. **Typecheck (`pnpm exec tsgo --noEmit -p packages/evals/tsconfig.json`):** zero errors, exit 0.
2. **Live smoke probe (`pnpm --filter @neuve/evals test gemini-live-smoke`):** 1/1 passed, 1.73s wall, hits live `gemini-3-flash-preview`, asserts `Thought` instance.
3. **No-key skip (`env GOOGLE_GENERATIVE_AI_API_KEY="" pnpm --filter @neuve/evals test gemini-live-smoke`):** 1/1 SKIPPED in 213ms, no failure — engineers without the key still get green CI as required.
4. **Schema-flatten correctness (probe `/tmp/probe-flatten-review.mjs` over the actual `inlineJsonSchemaRefs` walker against `Schema.toJsonSchemaDocument(AgentTurn)`):**
   - `$defs` stripped from output ✓ (verified `grep '\$defs|\$ref'` on flattened JSON returns zero matches).
   - `additionalProperties: false`, `required`, `enum`, `type` all preserved on each leaf branch ✓.
   - Nested `$ref` (def → ref → def) inlines correctly ✓ (synthetic probe with `Outer.inner → Inner` returns fully resolved leaf).
5. **Cross-check coverage (`grep -rn "Schema.toJsonSchemaDocument" packages/`):** exactly two call sites — `gemini-react-loop.ts` (Google) and `local-agent/tool-loop.ts` (Ollama, tolerates `$ref`). The other Google-bound `generateObject` callers (`plan-decomposer.ts`, `llm-judge.ts`) use Zod, not Effect Schema, so the `$ref` regression cannot reach them. Engineer's "one Google-bound call site" claim verified.
6. **Smoke test integrity:** zero `MockLanguageModel*` imports; imports the production `AGENT_TURN_RESPONSE_SCHEMA` constant directly; `Effect.timeout("30 seconds")` plus vitest `{ timeout: 35_000 }`; asserts `assert.instanceOf(envelope, Thought)` plus elapsed-time bound. Regression guard hits the production code path.
7. **`Effect.tapError` placement (`gemini-react-loop.ts:269-278`):** correctly attached after `Effect.tryPromise` so logs fire on the failure channel before propagating; payload includes `sessionId`, `round`, `modelId`, `cause`. Re-fail semantics intact.
8. **Effect-TS rules:**
   - No `catchAll`/`mapError`; the only `null` match is a legitimate `value !== null` runtime guard at `gemini-react-loop.ts:112` (pre-existing).
   - `Effect.fn("GeminiReactLoop.run")` retained on the public entry; `GeminiReactCallError` is `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`.
   - No new explicit return-type annotations; no new `try`/`catch` blocks.
   - Single `as JSONSchema7` cast at `gemini-react-loop.ts:98` is the documented spec-bridge between `draft-2020-12` (Effect) and `JSONSchema7` (AI SDK) — engineer collapsed the prior double-cast IIFE to a single cast.
9. **Repo hygiene:** `git status --short` shows exactly the expected diff (modifications to `wave-r5-ab.eval.ts` + `gemini-react-loop.ts`, untracked `gemini-live-smoke.test.ts` + `r5b-2026-04-26.md`, plus the 10 pre-existing Q9 probe artifacts). No stray `probe-*.ts`/`probe-*.mjs` in `packages/evals/` or repo root. The 20 valid `gemma-react__*.ndjson` traces under `packages/evals/evals/traces/wave-r5-ab/` are intact (`ls | grep gemma-react | wc -l` = 20). Full evals suite: 17 files / 172 tests / all pass / 2.06s.

#### Pre-existing lint claim verified
`pnpm --filter @neuve/evals lint` fails with `Failed to load config: vite.config.mjs … defineConfig() from "oxlint"`. Same failure on `pnpm --filter @neuve/shared lint`. Error is in `oxlint@1.55.0`'s JS config loader, not in T1's diff. Not a regression introduced by this work.

### Suggestions (non-blocking)

- `gemini-react-loop.ts:74-93` — `inlineJsonSchemaRefs` will stack-overflow on a self-referential `$defs` entry (verified: a synthetic `Tree → items: $ref Tree` definition crashes with "Maximum call stack size exceeded"). Current AgentTurn has no recursive types so this is latent, not active. Worth adding a `seenRefs` guard the next time someone touches this walker — or migrating to Effect's own ref-flattener if/when one ships.
- Same walker silently substitutes `undefined` (and JSON-stringifies to a missing key) when `definitions[refName]` is absent. Effect's `Schema.toJsonSchemaDocument` always emits matching `$defs`, so this is unreachable in practice — but a defensive `throw new Error("missing definition: " + refName)` would surface a typo or schema-bug loudly instead of producing an under-specified schema Google would reject with a less actionable message.
- `gemini-live-smoke.test.ts:89` — `void AgentTurn;` reads as a leftover. The `AgentTurn` import isn't used elsewhere in the test (the schema constant `AGENT_TURN_RESPONSE_SCHEMA` is what the test exercises). Either drop the import or document why the side-effect import is required.
- The `as JSONSchema7` cast at `gemini-react-loop.ts:98` lost its rationale comment when the IIFE was rewritten. The `inlineJsonSchemaRefs` block above documents the `$ref`/`$defs` problem, but a one-line reminder that the cast bridges Effect's `draft-2020-12` output to AI SDK's `draft-07` parameter type would save the next reader a `git blame`.

---

**Reviewer attestation:** Ran `pnpm exec tsgo --noEmit -p packages/evals/tsconfig.json`, `pnpm --filter @neuve/evals test gemini-live-smoke` (with key + with empty key), `pnpm --filter @neuve/evals test` (full suite), `pnpm --filter @neuve/evals lint`, `pnpm --filter @neuve/shared lint`, and inspected ALL nine adversarial scenarios per the seed checklist. No Critical, no Major. APPROVE.

---

## Round 2 — synthetic RunCompleted termination

## Verdict: APPROVE

### Findings

- [INFO] No CRITICAL or MAJOR issues. Eight adversarial scenarios + the lead-flagged shape discrepancy verified independently.

#### Resolution of lead-flagged "abort shape discrepancy"

The seed prompt cited a spot grep showing `abortReason: Schema.optional(Schema.String)` (flat string) and asked me to challenge whether the engineer reported one shape (`{ reason: string }` nested struct) and shipped another (flat string). **The discrepancy was a false alarm.** Read of `packages/shared/src/react-envelope.ts`:

- Line 55 — `AssertionFailed.abortReason: Schema.optional(Schema.String)` (pre-existing flat string field on the `ASSERTION_FAILED` envelope, unchanged).
- Line 70 — `RunCompleted.abort: Schema.optional(Schema.Struct({ reason: Schema.String }))` (the new field, nested struct).

Two different envelope classes. The lead's grep matched the unrelated `AssertionFailed` field. The new `RunCompleted.abort` shape mirrors `RunFinished.abort` at `models.ts:740` exactly (`Schema.optional(Schema.Struct({ reason: Schema.String }))`), so the reducer's one-line `abort: envelope.abort` forward at `react-reducer.ts:310` is structurally compatible with no shape transform required. **Engineer reported and shipped the same nested-struct shape.**

#### Verification log (executed by reviewer, not trusted from diary)

1. **Typecheck (3 packages, all touched by the schema change):**
   - `pnpm exec tsgo --noEmit -p packages/evals/tsconfig.json` — exit 0.
   - `pnpm exec tsgo --noEmit -p packages/supervisor/tsconfig.json` — exit 0.
   - `pnpm exec tsgo --noEmit -p packages/shared/tsconfig.json` — exit 0.
2. **Test suites (3 packages):**
   - `pnpm --filter @neuve/evals test` — 17 files / 173 tests / all pass / 1.92s. (Was 172 pre-T3; +1 max-rounds test confirmed.)
   - `pnpm --filter @neuve/supervisor test` — 14 files / 134 tests / all pass / 1.53s. Existing reducer tests still green with the schema extension (optional field stays optional on the natural happy path).
   - `pnpm --filter @neuve/shared test` — 15 files / 231 tests / all pass / 336ms.
3. **Live partial sweep — independent reproduction:** `EVAL_R5_SKIP_RUNNERS=gemma-react,gemma-oracle-plan EVAL_TASK_FILTER=calibration-3-two-step-docs pnpm --filter @neuve/evals eval:wave-r5-ab` exited cleanly in **20,956ms** (well under the 90s threshold; pre-fix this same task burned the full 600s testTimeout). Trace `gemini-react__calibration-3-two-step-docs.ndjson` ends with `{"type":"stream_terminated","ts":...,"reason":"run_finished:passed","remainingSteps":0}`. My run hit the natural happy path (status=passed at round 7); engineer's earlier evidence run hit max-rounds at 48s. Both paths terminate cleanly.
4. **Round-trip parser probe (independent test added + removed by reviewer):** authored `packages/shared/tests/r5b-roundtrip.test.ts` constructing the wire payload `{_tag: "RUN_COMPLETED", status: "failed", summary: "...", abort: {reason: "doom-loop"}}`, ran through `parseAgentTurn`, asserted `instanceOf RunCompleted` + `abort.deepEqual({reason: "doom-loop"})`. PASS in 2ms. Synthetic envelope round-trips through the wire schema correctly. Test deleted post-verification.
5. **Schema consumer audit (`grep -rn "RunCompleted\b" packages/`):** 9 consumer sites in `packages/`. Only `packages/supervisor/src/react-reducer.ts:310` reads `envelope.abort`; the other consumers (`trajectory.ts:102`, `tool-loop.ts:289`, executor handler tests) read `status`/`summary` only. Adding the optional field is fully backward-compatible — all existing consumers keep working without code changes.
6. **Three early-exit emit ordering (`gemini-react-loop.ts:362-382`, `:416-434`, `:437-452`):**
   - Doom-loop: `emitToolCallStarted` → `emitMessageChunk` → `Effect.logWarning` → **`emitAgentTurn(RunCompleted)` → `return`** ✓.
   - Unexpected-envelope: `Effect.logWarning` → `emitMessageChunk` → **`emitAgentTurn(RunCompleted)` → `return`** ✓.
   - Max-rounds: `emitMessageChunk` → `Effect.logWarning` → **`emitAgentTurn(RunCompleted)`** (no return needed; falls off end of `Effect.fn`) ✓.
   In all three sites the `agent_turn` is emitted on the queue BEFORE control leaves the loop, so the supervisor's `Stream.takeUntil(executed.hasRunFinished)` predicate fires on the synthetic terminal envelope rather than waiting on testTimeout.
7. **Test integrity:**
   - Doom-loop extension (lines 293-306): filters `agent_turn` updates, picks the LAST one, `instanceOf RunCompleted` (precise type narrowing, not loose `assert.ok`), `status === "failed"`, `deepStrictEqual({reason: "doom-loop"})`. Strong assertions.
   - Max-rounds new test (lines 310-353): feeds `MAX_TOOL_ROUNDS + 5` THOUGHTs (no shortcut/lower constant), asserts EXACTLY `MAX + 1` agent_turns (15 thought + 1 synthetic terminal), `instanceOf` + status + deepStrictEqual + summary regex match + zero MCP dispatches. Strong assertions.
   - Unexpected-envelope skip (lines 356-365): documented inline AND in diary §"What I changed". Rationale verified — the existing `schema-violation guard` test at line 400 demonstrates that `parseAgentTurn`/`generateObject`'s schema validation rejects unknown `_tag` upstream of the loop's `instanceof` chain, making the path defense-in-depth only.
   - All tests use `MockLanguageModelV4` for control-flow only; no live network calls in unit tests (live coverage already in `gemini-live-smoke.test.ts` from T1).
8. **Sibling-code parity (`packages/local-agent/src/tool-loop.ts`):** read of lines 280-501 confirms the same three gaps exist (doom-loop @ 317-342, unexpected-envelope @ 477-489, max-rounds @ 492-501). All three return without emitting a synthetic RunCompleted. Engineer's "DO NOT touch local-agent per task spec" is correct AND the audit memo at `~/.claude/projects/.../memory/project_local_agent_termination_audit.md` accurately documents the gap. Spot-check of 3 gemma-react traces (`calibration-1`, `journey-1-bmw`, `hard-volvo-ex90`) confirms Gemma terminates via `run_finished:passed` or `stream_ended` — Gemma never tripped the early-exit paths during the wave-r5 sweep, so the gap is dormant on the production runner. MEMORY.md line 20 contains the audit pointer.
9. **`Effect.tapError` from T1 still in place** (`gemini-react-loop.ts:271`) — round-1 fix not regressed.
10. **Effect-TS rules (no new banned patterns):** `grep -nE "catchAll|mapError|\bnull\b|: Effect\.Effect"` across the four touched files returns one match — `value !== null` runtime guard at `gemini-react-loop.ts:113` (pre-existing, not introduced by T3). `git diff HEAD` filtered for those patterns shows zero T3 additions. New `as RunCompleted` casts in tests (lines 304, 348) follow the same `instanceOf`-then-cast pattern as the pre-existing `as PlanUpdateTurn` (line 239) — pragmatic test-only narrowing after a runtime check.
11. **Repo hygiene:** `git status --short` from repo root shows exactly the 6 modified files (3 production sources, 1 test, 1 eval driver, 1 diary) plus the pre-existing 10 Q9 probe artifacts under `docs/handover/q9-tool-call-gap/probes/` plus `.claude/scheduled_tasks.lock`. NO probe-* leftovers in `packages/evals/`. The 20 valid `gemma-react__*.ndjson` traces are still on disk (`ls | grep gemma-react | wc -l` = 20). No new commits yet — engineer commits post-APPROVE per `feedback_commit_guidelines.md`.

### Suggestions (non-blocking)

- The `EVAL_TASK_FILTER` knob is acknowledged scope creep relative to the strict T3 scope, but the diary justifies it for the partial-sweep verification, mirrors `EVAL_R5_SKIP_RUNNERS` exactly, and is purely additive (default empty = no behavior change). Consider committing it as a separate granular commit during the post-APPROVE commit split, so a future rollback of the termination fix doesn't accidentally drop the verification knob.
- The live partial sweep run I executed regenerated `gemini-react__calibration-3-two-step-docs.ndjson` — it now ends with `run_finished:passed` (my run got lucky and Gemini terminated naturally) instead of the engineer's earlier `run_finished:failed / max-rounds` evidence. The fix is still proven (the engineer's `/tmp/wave-r5-ab-r5b/r5b-t3-doom-loop-fix.log` retains the 48,395ms max-rounds trace), but if the team wants the failure-mode trace as a permanent artifact, snapshot it to `evals/traces/wave-r5-ab/_evidence/` outside the auto-overwrite path.
- The `unexpected-envelope` synthetic emit is documented as defense-in-depth. If/when AgentTurn grows a new variant (e.g. an R6 envelope class), make sure to update both the `runGeminiReactLoop` `instanceof` chain AND the `tool-loop.ts` chain in the same change to keep behavior parity — currently the gemini-react path now emits a clean terminal envelope on this branch but `tool-loop.ts` still does not.

---

**Reviewer attestation:** Ran `pnpm exec tsgo --noEmit` across all 3 packages (`evals`, `supervisor`, `shared` — all exit 0), ran the full test suite for all 3 packages (17/173, 14/134, 15/231 — all pass), ran the live partial sweep myself (20.9s clean exit on `calibration-3-two-step-docs`), authored my own `parseAgentTurn` round-trip probe and verified the synthetic envelope decodes correctly through the wire schema, audited every consumer of `RunCompleted` in `packages/`, read `local-agent/tool-loop.ts` to verify the audit memo's gap claims, and resolved the lead-flagged abort-shape "discrepancy" as a false alarm (lead's grep matched the unrelated `AssertionFailed.abortReason` field; the new `RunCompleted.abort` is in fact the nested `Schema.Struct({reason})` shape the engineer reported, mirroring `RunFinished.abort` exactly). No Critical, no Major. APPROVE.
