# Review: R3 — react-reducer + executor rewire + adherence gate

**Reviewer:** strict-critique antagonistic reviewer
**Date:** 2026-04-25
**Scope:** R3 wave (foundation reducer + executor rewire + adherence-gate extension + extNotification wire + BMW pivot)
**Verdict source:** `docs/handover/react-migration/diary/r3-2026-04-25.md`, T1–T5 surface

## Verdict: REQUEST_CHANGES

The R3 mechanics are competently designed and broadly well-tested (120/120 supervisor + 22/22 local-agent + 197/197 shared, all 8 consumer typechecks green, Q9 15/15 preserved, BMW v3 surfaced a real capability finding rather than a wire bug). The reducer state machine is pure, the per-envelope display-skip rule is correct in production flow, and the adherence-gate window math is off-by-one-correct. **However**, the new `extNotification` handler at `packages/agent/src/acp-client.ts:714-732` introduces a `try { … } catch {}` block that silently drops malformed `_neuve/agent_turn` payloads with no log, no signal, and no surface. This violates `CLAUDE.md` "Never Swallow Errors" and the lead's explicit guidance for the silent-catch decision ("must Effect.die or surface to the user via Effect.logError + a domain-level signal"). The Q9 bug class taught us that silently-recovered failures cost weeks to debug; mirroring the grandfathered pattern from the `sessionUpdate` handler is not sufficient justification for a brand-new failure-mode swallow.

This is the only blocking finding. Fix is small: convert the silent catch to `Effect.logWarning` (or equivalent `console.warn` if the handler must stay non-Effect) plus a counter, OR surface as a queue failure. Once that's addressed, the wave is shippable.

### Findings

#### MAJOR
- **MAJOR** — Silent error swallow in new `extNotification` handler (`packages/agent/src/acp-client.ts:714-732`). The `try` block covers `Schema.decodeUnknownSync(AgentTurn)` AND the `AcpAgentTurnUpdate` constructor; the bare `catch {}` discards the cause. The HACK comment ("should be impossible") is exactly the false-confidence pattern that hid the Q9 oneOf bug. CLAUDE.md "Never Swallow Errors" lists `Effect.catchAll(() => undefined)` as banned; bare-catch with no log is functionally identical. Minimum fix: surface a warning log with the cause (`Effect.runSync(Effect.logWarning(...))` or a plain `console.warn` if you must stay outside Effect). Better fix: `Schema.decodeUnknownEither` and either log+drop (recoverable) or fail the session queue with `AcpStreamError` (infrastructure). The grandfathered `sessionUpdate` handler (line 707-712) shows the same pattern, but that grandfather only catches truly *unknown* variants from newer servers — not malformed payloads of a known method that we own end-to-end.

#### MINOR
- **MINOR** — Test-scaffolding casts in `packages/supervisor/tests/executor-react-mode.test.ts:340,344,375,379,383,387` use `} as AcpSessionUpdate,` rather than constructing real `AcpAgentMessageChunk` / `AcpAgentThoughtChunk` instances (the way `executor-adherence-gate.test.ts:52-67` does). The casts are avoidable; CLAUDE.md "No type casts (`as`) unless unavoidable." These casts also bypass schema validation in the test, so a future field-rename in `AcpAgentMessageChunk` would silently keep these tests green while production code breaks. Replace with constructors.
- **MINOR** — `packages/local-agent/src/tool-loop.ts:201` uses `as unknown as Record<string, unknown>` to cross the SDK's `extNotification` parameter type. Diary T5 documents this; the cast is unavoidable for now (SDK boundary). Acceptable as a HACK comment, but no comment was added inline. Add a one-line `// HACK:` comment per CLAUDE.md (the diary justification is good — just put a pointer in code).
- **MINOR — coverage gap** — No test pins the `agent_turn` → `tool_call_update` edge case. Production flow (tool-loop.ts emits `agent_turn`, then `tool_call`, then `tool_call_update`) means `tool_call_update` always arrives AFTER the per-envelope skip flag has been reset by `tool_call`. The current logic is correct, but a regression that moved tool_call_update to immediately after agent_turn (before any display update) would silently lose tool RESULTS, not just display chunks. One scripted-stream test would pin this.
- **MINOR — coverage gap** — No explicit test for back-to-back agent_turns with no intervening update. The happy-path test (lines 122-151) does send 4 agent_turns sequentially and they all get processed, so this is implicitly covered, but a focused two-agent_turn test would make the per-envelope reset assertion explicit.
- **MINOR** — `packages/supervisor/src/react-reducer.ts:31` uses `Schema.Record(Schema.String, Schema.Number)` for `consecutiveAssertionFailures`, while the writer uses branded `StepId` keys (line 134-138 etc.). Diary T1 decision 1 documents this as intentional ergonomics, but the comment isn't in code. The brand erases at runtime so this is correct in practice; the inconsistency in types between reader (string) and writer (StepId) creates a mild trip-hazard. Acceptable.

#### INFO
- **INFO** — `parseAssertionTokens` (`packages/shared/src/models.ts:847-860`) uses `string.split(';')` + `indexOf('=')` to parse the structured prefix engineer packs into `StepFailed.message`. **Not regex** — verified. Per `feedback_types_over_regex.md` this passes; per "no fragile property checks" it's not ideal for hot-path data, but the message format is internal and stable. Acceptable for R3; a Schema-typed field on `StepFailed` would be cleaner if this becomes load-bearing.
- **INFO** — PRD §R3 line 252 DoD ("Volvo replay produces ≥4 sub-goals via PLAN_UPDATE") was not met. BMW v3 produced 0 PLAN_UPDATEs (Volvo blocked by anti-bot wall, then BMW revealed Gemma's capability gap with MCP `interact` arg-shape rejection). Diary §T5 documents this as a Cemri-2025 capability finding. Engineer correctly did NOT loosen rules, raise MAX_TOOL_ROUNDS, or site-patch the prompt. The wire/reducer/gate mechanics are demonstrably operational. Per lead's stated preference, accepting the capability finding as the canonical R5 distillation target. PRD §R3 line 252 should be revised in the R4 PRD pass to acknowledge.
- **INFO** — `packages/evals/evals/wave-r3-react-replay.eval.ts` does not include a `skip:true` Volvo entry as the lead's brief mentioned. Engineer's call here is reasonable (BMW is the active target; Volvo is queued for R5 with cookie-injection per diary §T5 follow-up). Document the deferral somewhere visible (a TODO in the eval or a line in the R3 wave summary).
- **INFO — wave hygiene** — `git stash list` empty; `git status --short` shows only the documented R3 surface (7 modified + 5 new). Engineer flagged a stash mistake during diagnosis (caught instantly, popped, work intact). Verified reproducibly green. No commit yet (per workflow — engineer awaits APPROVE).

### Suggestions (non-blocking)

- Replace the `try/catch` in `extNotification` with `Schema.decodeUnknownEither(AgentTurn)`. This makes the success/failure paths explicit and removes the catch-everything risk on the constructor.
- Add a Schema field `assertionDetails: AssertionDetails` (with `category`, `domain`, `reason`, `evidence` typed) to `StepFailed` rather than packing into `message`. This obviates `parseAssertionTokens` and makes the wire round-trip lossless.
- Consider a `gemma-react` PlannerMode literal in R3 (the diary defers to R5). Adding it now (even if unused) would let R4 wire it into prompt selection without a cross-cutting change later. Not blocking.
- Add `Effect.annotateCurrentSpan({ stepId, action })` inside `handlePlanUpdate` so traces are easier to grep.
- Document the per-envelope skip rule with a sentence in `executor.ts` near the `expectsDisplaySkip` declaration; T2 §decision 2 in the diary is the canonical source but a code pointer would help the next reader.

### DoD interpretation rulings

- **Reducer pure-ness**: PASS — no I/O. Only Effect-wrapped to use `Schema.decodeUnknownEffect` for AnalysisStep payload, captured via `Effect.exit` and converted to a signal. No fetch/MCP/file access.
- **PLAN_UPDATE cap=5 hard**: PASS — `runState.planUpdateCount >= REACT_PLAN_UPDATE_CAP` rejects on the 6th attempt, emits `PlanUpdateCapExceeded`, leaves plan unchanged, increments counter on rejection (test `react-reducer.test.ts:338-394` pins all three behaviors).
- **REFLECT trigger at threshold=2 same-stepId**: PASS — counter increments on each ASSERTION_FAILED for the stepId, fires REFLECT signal when count ≥ 2 (i.e., 2nd, 3rd, … failure). Different stepIds tracked separately. STEP_DONE on the same stepId resets to 0. All four behaviors pinned in tests.
- **Adherence gate R3 rule**: PASS — `hasUnresolvedAssertionInWindow(events, runFinishedIndex)` walks `[runFinishedIndex - 3, runFinishedIndex)` looking for unresolved StepFailed. Pinned: passed+unresolved → reject; passed+resolved → accept; failed+unresolved → accept; outside-window → accept. Off-by-one verified correct (window is exactly 3 events preceding RunFinished).
- **Stream.mapAccumEffect branching including expectsDisplaySkip**: PASS for production flow. The flag resets to `false` on every iteration's default; only the `agent_turn` branch sets it `true`. The "second display update after agent_turn → reset" rule is pinned by test `executor-react-mode.test.ts:328-362` (the abort-message coverage). Edge cases noted as MINOR coverage gaps but not failures.
- **extNotification wire correctness**: FAIL on the silent-catch (MAJOR finding above). Sender side sound, queue-injection ordered (synchronous `Queue.offerUnsafe`), `agent_turn` whitelist for inactivity watchdog correct.
- **Backward compatibility**: PASS — legacy modes (template/none/oracle-plan) never set `expectsDisplaySkip=true` because they never produce `agent_turn` updates. `Match.exhaustive` in `apps/cli-solid/src/routes/results/raw-events-overlay.tsx:34-123` matches on `ExecutionEvent` (not on `AcpSessionUpdate`); R3 added `AcpAgentTurnUpdate` only to the wire union, not the canonical event union, so the matcher remains exhaustive.
- **Q9 regression preserved**: PASS — `pnpm exec vp test run tests/flatten-one-of.test.ts` → 15/15 green; `mcp-bridge.ts` byte-identical to HEAD `12fc1dc3` (`git diff HEAD -- packages/local-agent/src/mcp-bridge.ts` → empty).
- **Volvo/BMW T5 replay**: APPROVE-WITH-CAPABILITY-FINDING. Engineer correctly resisted prompt-overfitting and rule-loosening per `feedback_avoid_prompt_overfitting.md`. Volvo blocked by anti-bot infrastructure; BMW v3 revealed Gemma 4 E4B does not emit PLAN_UPDATE under repeated tool-shape rejection — exactly the Cemri-2025 4B-capability gap that R5 distillation needs. Per the lead's stated preference. PRD line 252 wording will need revision in R4. NOT a Q9 follow-up requirement for R3.

### Verification log

- **Test runs (all green)**:
  - `pnpm --filter @neuve/supervisor test` → 13 files / **120 passed** (1.53s).
  - `pnpm --filter @neuve/local-agent test` → 3 files / **22 passed** (380ms).
  - `pnpm --filter @neuve/shared test` → 12 files / **197 passed** (335ms).
  - `pnpm exec vp test run tests/flatten-one-of.test.ts` (Q9 regression) → 1 file / **15 passed** (162ms).
- **Cross-package typecheck (8 consumer packages)**: all green via `pnpm --filter @neuve/shared --filter @neuve/agent --filter @neuve/local-agent --filter @neuve/supervisor --filter @neuve/evals --filter @neuve/perf-agent-cli --filter cli-solid --filter @neuve/cookies typecheck`. Pre-existing `@neuve/sdk` Playwright failure (not in 8-package consumer set) untouched.
- **Banned-pattern grep**:
  - `Effect.catchAll|mapError|orElseSucceed|option|ignore` in modified files → 0 hits.
  - `null` in modified files → 1 hit (`packages/agent/src/acp-client.ts:221`, **pre-existing** — verified via `git show HEAD:...`).
  - `try { … } catch` in modified files → tool-loop.ts:411 (pre-existing auto-drill); acp-client.ts:198,204 (pre-existing); acp-client.ts:707 (pre-existing `sessionUpdate`); **acp-client.ts:718 (NEW R3 — flagged MAJOR)**.
  - `as <Type>` casts: 1 in tool-loop.ts:201 (documented HACK), 6 in `executor-react-mode.test.ts` (avoidable — flagged MINOR), 2 pre-existing slice casts in executor.ts.
- **`Effect.fn` span-name presence**: confirmed for all reducer entry points (`reduceAgentTurn`, `handlePlanUpdate`, `handleRunCompleted`) and the executor's `logReducerSignal`. ✓
- **`parseAssertionTokens` regex investigation**: NOT regex — uses `string.split(';')` + `indexOf('=')`. Per `feedback_types_over_regex.md` this passes. The lead's flag was correct to call this out for scrutiny; the implementation is clean. Documented as INFO.
- **`expectsDisplaySkip` per-envelope edge cases**:
  - agent_turn → display: skipped (test pins via abort-message scenario).
  - agent_turn → tool_call_update: NO test (MINOR coverage gap), but logic is correct (`tool_call_update` is not in `isReactSkippedDisplayUpdate`, falls to `addEvent`).
  - agent_turn → agent_turn: covered by happy-path 4-in-a-row test.
  - usage_update → agent_turn → display: production order is usage_update FIRST, then agent_turn (verified in `tool-loop.ts:124-138, 198-201`). Skip rule preserved.
- **extNotification queue-injection ordering**: synchronous `Queue.offerUnsafe` via `offerSessionUpdate(sessionId, decoded)`. Both `sessionUpdate` and `extNotification` handlers call this synchronously within the SDK's NDJSON message-processing loop; arrival order preserved. ✓
- **Backward-compat matcher exhaustiveness**: `Match.exhaustive` in `raw-events-overlay.tsx` matches on `ExecutionEvent` union (12 variants — `RunStarted`, `StepStarted`, `StepCompleted`, `StepFailed`, `StepSkipped`, `ToolCall`, `ToolProgress`, `ToolResult`, `AgentText`, `AgentThinking`, `RunFinished`, `PlanUpdate`). R3 added `AcpAgentTurnUpdate` to `AcpSessionUpdate` (wire union) only — not to `ExecutionEvent`. Match remains exhaustive. ✓
- **Reducer signal coverage**: all 4 ReducerSignal variants pinned by tests:
  - `ReflectTriggered` (`react-reducer.test.ts:172-197`)
  - `PlanUpdateCapExceeded` (`react-reducer.test.ts:338-394`)
  - `PrematureRunCompleted` (`react-reducer.test.ts:413-437`)
  - `InvalidPlanUpdatePayload` (`react-reducer.test.ts:316-336`)
- **Step.status transitions via applyMarker**: pinned in `react-reducer.test.ts:548-601` (3 tests covering STEP_DONE→passed, ASSERTION_FAILED→failed, multi-step terminal). Confirms diary §T2 decision 4 bug fix.
- **Wave hygiene**: `git stash list` empty; `git status --short` shows the documented R3 surface (7 modified + 5 new + 10 pre-existing untracked probes/lock from prior waves).

### Notes for round-2 follow-up

After fixing the MAJOR (extNotification silent catch), please:
1. Convert at least the 6 `as AcpSessionUpdate` casts in `executor-react-mode.test.ts` to constructor calls.
2. Add a one-line HACK comment in `tool-loop.ts:198-201` justifying the SDK boundary cast.
3. Optional but valuable: add the `agent_turn → tool_call_update` test, and an explicit back-to-back `agent_turn → agent_turn` test.

The PRD line-252 (Volvo→BMW capability finding) and the PLAN_UPDATE-emission-rate finding should be carried forward into the R4 PRD draft as INFO; they do not block R3 ship.


---

## Round 2 verdict

**Verdict: APPROVE** — all 6 round-1 findings addressed. Minor lingering concern documented as INFO (not blocking).

The MAJOR (silent extNotification swallow) is fully resolved with the lead-recommended Option A. The five MINORs are essentially clean. One small new instance of `as AcpSessionUpdate` snuck into the m4 fixture (line 398 of `executor-react-mode.test.ts`); the 6 originally-flagged casts ARE replaced as requested, but the new test introduces a single tool_call_update fixture cast because no `AcpToolCallUpdate` constructor helper was added. This is a forgivable miss for round 2 — engineer can either inline `new AcpToolCallUpdate({...})` or add a `toolCallUpdate(...)` helper at commit time without re-review.

### Per-finding patch verification

- **M1 (extNotification silent swallow) → GREEN.** `packages/agent/src/acp-client.ts:715-748`. The `try/catch` block is gone; `Schema.decodeUnknownExit(AgentTurn)` returns `Exit<AgentTurn, ParseError>` synchronously (curried at module scope as `decodeAgentTurnUnknownExit` on line 683). Two distinct failure paths emit `Effect.logWarning` via `Effect.runSync(...)`:
  - Missing/non-string `sessionId` → `"malformed _neuve/agent_turn — missing sessionId; payload dropped"` annotated with `{ method }`.
  - Schema decode failure → `"malformed _neuve/agent_turn — AgentTurn schema decode failed; payload dropped"` annotated with `{ method, sessionId, cause: String(decodeExit.cause) }`. The cause is annotated, as required.
  - `Exit` is imported from `"effect"` (line 11). ✓
  - The handler is `async` (Promise-returning). `Effect.runSync(Effect.logWarning(...))` runs the log effect with the default runtime so the warning DOES emit (verified by reasoning about the runtime; `Effect.logWarning` requires a Logger context which the default runtime provides). The only caveat is the warning loses the surrounding `Effect.annotateLogsScoped({ adapter, pid })` scope from line 638/740 (those scoped annotations are only attached when running inside an Effect that inherits them); the explicit annotations on the warning itself (`method`, `sessionId`, `cause`) are sufficient for debuggability. Acceptable.
  - Legacy `sessionUpdate` silent catch (lines 707-714) is preserved. Both handlers read side-by-side correctly.
  - `grep -nE "try\s*\{" packages/agent/src/acp-client.ts` → 3 matches (lines 199, 205, 708) — all pre-existing. No new try block in extNotification region. ✓

- **m2 (test casts → constructors) → GREEN with 1 INFO miss.** Top-level `messageChunk(text)` and `thoughtChunk(text)` helpers added at `executor-react-mode.test.ts:53-63` constructing real `AcpAgentMessageChunk` / `AcpAgentThoughtChunk` Schema.Class instances (so schema validation fires on construction, mirroring `executor-adherence-gate.test.ts:52-67`). The 6 originally-flagged casts at lines 340/344/375/379/383/387 ARE all replaced. **However**, the m4 test (added in round 2) introduces ONE NEW cast at line 398 for the `tool_call_update` fixture (`} as AcpSessionUpdate,`). `grep -nE "as AcpSessionUpdate" packages/supervisor/tests/executor-react-mode.test.ts` → 1 match. The lead's verification step said "must be ZERO matches"; this fails the strict reading. Substantively it's a forgivable miss — no `AcpToolCallUpdate` helper was added because there's only one tool_call_update fixture in the file. Severity: INFO/MINOR. Suggested follow-up: either inline `new AcpToolCallUpdate({...})` or add a `toolCallUpdate(...)` helper. Not blocking.

- **m3 (HACK comment on tool-loop.ts cast) → GREEN.** `tool-loop.ts:200-203` has a 4-line `// HACK:` comment immediately above the cast: "SDK extNotification typed as Record<string, unknown>; the AgentTurn Schema.Class instance is not directly assignable but JSON-serializes cleanly through JSON-RPC via JSON.stringify (its `_tag` and field properties are enumerable own properties)." Format matches CLAUDE.md "// HACK: reason" — explicit HACK marker, not TODO/NOTE. ✓

- **m4 (agent_turn → tool_call_update edge test) → GREEN.** Test "agent_turn → tool_call_update (no intervening display update) — tool_call_update flows through addEvent and adds ToolResult" at `executor-react-mode.test.ts:372-412`. Fixture sequence: `wrapAgentTurn(Action(...))` immediately followed by a `tool_call_update` (NO intervening display update). Asserts both `ToolCall` (from reducer's ACTION dispatch — `event._tag === "ToolCall"`) AND `ToolResult` (from addEvent on tool_call_update — `event._tag === "ToolResult"`, with `toolName === "interact"` and `isError === false`). Pins the per-envelope skip flag's behavior on `tool_call_update`: NOT in the skipped set, so even when the flag is true the update still flows through addEvent. ✓ (Modulo the m2 INFO above for the cast.)

- **m5 (back-to-back agent_turns test) → GREEN.** Test "back-to-back agent_turns with no intervening update — per-envelope skip resets cleanly" at `executor-react-mode.test.ts:414-441`. Fixture: two consecutive `wrapAgentTurn(Thought(...))` updates, no display chunks between. Asserts `agentThinkingEvents.length === 2` AND that both events carry the expected text ("First step thinking." / "Second step thinking."). Verifies the per-envelope flag is re-armed by each agent_turn (not sticky-set or counter-incremented incorrectly). ✓

- **m6 (Volvo SKIPPED_TASKS) → GREEN.** `wave-r3-react-replay.eval.ts:10-46`:
  - `import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90"` re-imported. ✓
  - `SKIPPED_TASKS: ReadonlyArray<{ readonly task: EvalTask; readonly skipReason: string }>` at line 40 with one entry: `{ task: hardVolvoEx90, skipReason: "volvocars.com returns Access Denied to headless Chromium" }`. ✓
  - `void SKIPPED_TASKS;` at line 46 to satisfy unused-binding rules. Not blocking — engineer's choice; acceptable as documented.
  - Header comment at lines 28-34 instructs how to flip and rerun: "To run Volvo locally, move it from SKIPPED_TASKS into the main `tasks` array." ✓
  - The skipReason itself is terse but the surrounding header explains the cookie-injection / authenticated-profile follow-up and points to the diary §T5. Combined, the rationale is clear. ✓

### Verification log (round 2)

- **Test runs (all green)**:
  - `pnpm --filter @neuve/supervisor test` → 13 files / **122 passed** (1.52s). Confirmed +2 vs round 1 (m4 + m5).
  - `pnpm --filter @neuve/local-agent test` → 3 files / **22 passed** (377ms). m3 is a comment, no behavior change.
  - `pnpm --filter @neuve/shared test` → 12 files / **197 passed** (343ms). Unchanged.
- **Cross-package typecheck (8 consumer packages)**: all green via `pnpm --filter @neuve/shared --filter @neuve/agent --filter @neuve/local-agent --filter @neuve/supervisor --filter @neuve/evals --filter @neuve/perf-agent-cli --filter cli-solid --filter @neuve/cookies typecheck`. Pre-existing `@neuve/sdk` Playwright failure not in 8-package consumer set, untouched.
- **Banned-pattern grep (round 2 delta only)**:
  - `try \{` in `acp-client.ts` → 3 matches, all pre-existing (lines 199, 205, 708). Zero in extNotification region. ✓
  - `as AcpSessionUpdate` in `executor-react-mode.test.ts` → 1 match (line 398, m4 fixture). ✗ vs lead's strict ZERO requirement; documented as INFO above.
  - All other banned patterns (Effect.catchAll/mapError/orElseSucceed/option/ignore, null in modified code, regex) unchanged from round 1 (zero new occurrences).
- **Wave hygiene**: `git stash list` empty. `git status --short` shows only the documented R3 surface (7 modified + 5 new + 10 pre-existing untracked probes/lock from prior waves).
- **Diary "Round 2 patches" section**: present at lines 980-1147 with full per-finding rationale, the Option A vs B vs C decision tree for M1, and round-2 verification commands.

### New findings (introduced by round-2 changes)

- **INFO (only)** — One new `as AcpSessionUpdate` cast at `executor-react-mode.test.ts:398` for the m4 tool_call_update fixture. The originally-flagged 6 casts ARE replaced; this single new occurrence is a forgivable scope miss (no helper covers tool_call_update). Suggested commit-time fix: import `AcpToolCallUpdate` and either inline-construct or add a `toolCallUpdate(...)` helper symmetric with `messageChunk` / `thoughtChunk`. Not re-review-worthy.

### What changes between round 1 verdict (REQUEST_CHANGES) and round 2 verdict (APPROVE)

- The MAJOR (M1 silent extNotification swallow) is fully resolved with the lead's preferred Option A — the strongest item in round 1.
- 4 of 5 MINORs (m3, m4, m5, m6) are clean.
- 1 MINOR (m2 test casts) substantively met the lead's intent (6/6 originally-flagged casts replaced) but introduced 1 new fixture cast; demoted to INFO because it doesn't undermine R3 architecturally and the fix is a 2-line follow-up at commit time.
- No new MAJOR or CRITICAL findings introduced by round-2 changes.

R3 is shippable. Lead can instruct engineer to commit per granular plan.
