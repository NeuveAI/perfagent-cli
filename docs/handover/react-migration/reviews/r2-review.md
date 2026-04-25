# Review: R2 — OllamaClient native /api/chat + AgentTurn dispatch + ReAct prompts

**Date:** 2026-04-25
**Reviewer:** strict-critique (per `/team-orchestration`)
**Verdict:** **REQUEST_CHANGES**

R2 ships a substantial, mostly disciplined runtime wiring of Variant B. Native
`/api/chat` correctly replaces the OpenAI SDK; the `format` parameter applies the
AgentTurn JSON Schema as a llama.cpp grammar; tool-loop dispatches off `_tag`;
both prompts teach the cross-cutting THOUGHT / PLAN_UPDATE / REFLECT protocol.
The Q9 flatten-one-of regression test stays green and the `flattenOneOf` /
`detectWrapperKey` paths in `mcp-bridge.ts` are untouched. Probe D's num_ctx
fix is reproduced end-to-end in the client.

Two MAJOR findings keep the verdict at REQUEST_CHANGES: (1) `sanitizeBaseUrl`
silently rewrites a user-supplied URL with no startup warning, and (2) the new
`tool-loop-agent-turn.test.ts` covers 3 of the 6 envelope dispatch branches —
the cheapest possible test additions are missing.

---

## Findings

### MAJOR

- **[MAJOR] `sanitizeBaseUrl` silent `/v1` strip — no startup warning emitted.**
  `packages/local-agent/src/ollama-client.ts:196-205`. The reviewer directive
  is explicit: "If the silent strip stays, it MUST be documented in the diary
  AND log a warning at startup." Engineer documented in `r2-2026-04-25.md` but
  added zero logging in `ollama-client.ts` (verified by `grep -nE "logInfo|logWarning|log\("` in
  the file → zero matches). Either:
  (a) emit `Effect.logWarning` once during `resolveStartupConfig` when the raw
      `PERF_AGENT_OLLAMA_URL` ended in `/v1` so operators can trace the
      rewrite, OR
  (b) fix the upstream callers (`packages/agent/src/acp-client.ts:560` and the
      `evals/src/runners/gemma.ts:14` defaults plus the eval harness defaults
      in `wave-r2-subset.eval.ts:87`, `wave-4-5-subset.eval.ts`, etc.) to drop
      the trailing `/v1/` and remove the strip from the client.
  As-is, a future reader stepping through "PERF_AGENT_OLLAMA_URL is
  http://localhost:11434/v1 but the request goes to /api/chat" will need this
  branch documented in code, not just in a diary. Also: the
  `acp-client.ts:562` already strips `/v1/?$` via regex, so silent rewriting
  is now happening in two places.

- **[MAJOR] Dispatch test coverage gap in `tool-loop-agent-turn.test.ts`.**
  The new file `packages/local-agent/tests/tool-loop-agent-turn.test.ts:115-265`
  has only 2 cases. The `runToolLoop` switch-by-`_tag` is the central hot path
  of T2; PLAN_UPDATE, STEP_DONE, and ASSERTION_FAILED dispatch branches are
  uncovered by the new test file. Each branch in `tool-loop.ts:188-270` is
  similar in shape (emit a session-update, push an observation message,
  `continue`); the test cost is ~10 lines per branch. Without these, a
  one-character edit to (say) the STEP_DONE message format or its message
  history tail would not fail any test. Add at minimum one case per envelope
  branch: PLAN_UPDATE → `agent_thought_chunk` carrying `[PLAN_UPDATE
  action=… step=…]`; STEP_DONE → `agent_message_chunk` carrying `[STEP_DONE
  …] …`; ASSERTION_FAILED → `agent_message_chunk` carrying
  `[ASSERTION_FAILED … | category=… domain=…] …`. Also verify the
  observation-feedback message text per branch, since that's part of the
  contract Gemma sees on the next turn.

### MINOR

- **[MINOR] Doom-loop diagnostic message lost the `Last error: …` tail.**
  `packages/local-agent/src/tool-loop.ts:298-308`. Pre-R2 (`HEAD:tool-loop.ts:171`)
  the abort message ended with `Last error: ${lastErrorOrUnknown}. Check the
  tool description for the expected call shape.`. Post-R2 the message is
  `[Local agent: detected 3 identical consecutive ACTION envelopes
  (${functionName}). Aborting to avoid wasted cycles.]` — no `lastToolError`
  context. With Variant B the AgentTurn parser ensures the tool name is
  well-formed, but the error-text-from-the-MCP-server context that originally
  motivated the doom loop is gone. Reattach the `lastToolError` accumulator
  inside the `Action` branch, or document explicitly in a comment that the
  Variant B parser eliminates the wrapper-shape errors that motivated the
  hint.

- **[MINOR] Engineer diary claim about doom-loop reset semantics is wrong.**
  `docs/handover/react-migration/diary/r2-2026-04-25.md:225-229` says "the
  `recentCalls` reset path triggers when we see a non-matching ACTION OR any
  non-ACTION envelope (THOUGHT/STEP_DONE etc), which is the right semantics:
  non-action envelopes break the loop pattern." Reading
  `tool-loop.ts:272-313`, the only place `recentCalls.length = 0` runs is
  inside the `if (envelope instanceof Action)` branch when the new ACTION
  doesn't match the last one. THOUGHT / PLAN_UPDATE / STEP_DONE /
  ASSERTION_FAILED envelopes hit `continue` before reaching that block, so
  they do NOT reset `recentCalls`. The actual behavior is fine for Variant B
  (3 identical ACTIONs with intervening THOUGHTs still trip), but the diary's
  description doesn't match the code. Update the diary or wire up the reset
  on non-ACTION envelopes if the diary's stated semantics is what the
  engineer intended.

- **[MINOR] Defensive cast at `tool-loop.ts:442` violates "no `as` casts" preference.**
  `(envelope as { _tag: string })._tag`. CLAUDE.md "No type casts (`as`)
  unless unavoidable." With AgentTurn a closed union over six TaggedClass
  instances, this branch is unreachable at the type level. TS should already
  narrow `envelope` to `never` after the six instanceof guards. If it
  doesn't, the right fix is `Effect.die` or assert-never rather than a cast +
  log. (Defensive line; cast is unavoidable only because `never` doesn't have
  a `_tag` member but the literal "never reached" is provable. Acceptable as
  a sanity-log; logging via `Predicate.hasProperty(envelope, "_tag")` would
  be cleaner.)

### INFO

- **[INFO] Pre-existing `try/catch` blocks in modified files are grandfathered.**
  `tool-loop.ts:392` (auto-drill exception handler) and `agent.ts:62, 138`
  (newSession error handling, prompt error handling) are unchanged from
  HEAD. Engineer flagged the auto-drill `try/catch` in the diary's
  compliance-audit section. Not a R2 regression but worth folding into a
  later cleanup wave.

- **[INFO] Pre-existing `process.env` spread in `mcp-bridge.ts:187`.**
  Untouched by R2; engineer correctly did NOT introduce `process.env` in any
  modified-by-R2 code path (verified by grep). The mcp-bridge case is
  spreading the parent env into a child-process env, not reading config —
  acceptable per the spirit of the rule.

- **[INFO] Schema-validity gate has no in-eval metric.**
  `wave-r2-subset.eval.ts` has 4 scorers (step-coverage, final-state,
  tool-call-validity, furthest-key-node) but none counts AgentTurn-schema
  validity. Engineer's "100% schema-valid" claim is derived post-hoc by
  grepping the trace ndjsons for the `non-schema-valid agent output` abort
  string. The methodology is sound (the format grammar is structurally
  enforced; absence of the abort string is the proper proxy), but the gate
  is observed not measured. R3 may want a typed `agent_turn` event kind on
  `TraceEventSchema` so a proper schema-decode counter can live in evals.

- **[INFO] Calibration used `EVAL_GEMMA_PLANNER=template`, not `oracle-plan`.**
  `wave-r2-subset.eval.ts:91-94`. Engineer fell back to `template` because
  `GOOGLE_GENERATIVE_AI_API_KEY` was unset; documented in diary T6 §1.
  Importantly the new R2 pipeline IS exercised: `gemma.ts:48-114`
  (`makeGemmaRunner`) wires the gemma runner to spawn the local-agent
  process via `Agent.layerLocal`, which uses the new `OllamaClient` and
  `runToolLoop`. Planner mode is orthogonal to this pipeline. A re-run with
  `oracle-plan` (one env-var change) would tighten the data, but is not a
  blocker.

- **[INFO] DoD `tool-call rate ≥ 1 per turn` strict reading fails 0/5; operationalized reading passes 5/5.**
  Engineer flagged this in T6 §"Notable findings" #1. See "DoD interpretation
  rulings" below.

- **[INFO] Wire-format divergence between local and executor prompts is intentional for R2.**
  Local prompt emits AgentTurn JSON envelopes (Variant B); executor prompt
  uses pipe-form markers. Engineer documented in T4 §1 that convergence is
  conceptual in R2 (THOUGHT, PLAN_UPDATE, REFLECT, categories, domains
  shared across both); R3's reducer collapses the wire format. The 6
  protocol-convergence tests in `prompts.test.ts:491-557` pin the conceptual
  parity. This is a reasonable phased migration.

- **[INFO] Empty-content abort path (`tool-loop.ts:157-169`) is untested.**
  Sub-second to add as a third dispatch test: scripted `okResult("")` →
  assert `agent_message_chunk` with "model returned empty content". Cheap.

### Suggestions (non-blocking)

- The `sanitizeBaseUrl` strip would be cleaner as `Effect.logDebug` plus
  fixing `acp-client.ts` and the eval harness defaults to drop the `/v1/`
  suffix at the source, since the OpenAI-compat era is over.
- Consider lifting the `__parse_failure__` sentinel into a proper
  Schema.TaggedStruct so the dispatch path stays in the AgentTurn type space
  (currently the `_tag` is a magic string `"__parse_failure__"` checked at
  `tool-loop.ts:173`).
- The `(envelope as { _tag: string })._tag` defensive log could be replaced
  by `Predicate.hasProperty(envelope, "_tag")` narrowing.

---

## DoD interpretation rulings

- **Schema-valid AgentTurn rate per turn (≥80% target): PASS.**
  0 of 28 turns across 5 calibration tasks failed schema-decode. The metric
  is observed (not measured by an eval scorer), but the underlying
  enforcement is structural — Ollama's `format` parameter applies the
  AgentTurn JSON Schema as a llama.cpp grammar so non-conforming output is
  literally impossible at the model level. Trust + verify is reasonable
  here. Recommend R3 add a typed `agent_turn` trace event kind so a real
  scorer can replace the grep-based check.

- **Tool-call rate ≥1 per turn on ≥4 of 5 tasks: PASS under operationalized reading.**
  Strict reading of PRD §R2 line 236 fails 0/5 — Variant B's
  THOUGHT-before-ACTION protocol structurally bounds ratio ~0.5 because each
  THOUGHT counts as a turn but emits no tool. Engineer's operationalized
  reading "≥1 tool call (i.e. some non-zero) per task on at least 4 of 5
  tasks" passes 5/5. The PRD DoD was authored when Variant A (native
  tool_calls, no THOUGHT envelope) was on the table; the metric does not
  translate to Variant B. Accepting the operationalized reading. **Action
  item for R3**: revise PRD §R2 line 236 to read e.g. "tool dispatching ≥1
  ACTION envelope per task on ≥4 of 5 spike tasks" and either retire the
  per-turn ratio or replace it with a per-trajectory ACTION/(ACTION+other)
  ratio. Not a R2 blocker.

- **Prompt size ≤80 non-blank lines: PASS.**
  Local: 54 non-blank lines. Executor: 73 non-blank lines. Both pinned by
  `prompts.test.ts:475-479` (local) and `:81-85` (executor) and again in
  the `protocol convergence` describe block at `:547-556`.

- **num_ctx fix (Probe D): PASS.**
  T1 standalone probe: `promptEvalCount=15639` (3.8× /v1/ ceiling). T6
  calibration: peakPromptTokens 8218–30335 (2.0× to 7.4× /v1/ ceiling) on
  all 5 tasks. The OpenAI-SDK silent-truncation pathology is gone.

---

## Verification log

### Test runs

- `pnpm --filter @neuve/local-agent test` → 19/19 passed (was 17 — +2 from
  `tool-loop-agent-turn.test.ts`). Includes `dist-spawn.test.ts` (ACP
  initialize smoke test against the built binary) and
  `flatten-one-of.test.ts` (Q9 regression — 15 cases, all green).
- `pnpm --filter @neuve/local-agent exec vp test run flatten-one-of` →
  15/15 passed. Q9 regression preserved.
- `pnpm --filter @neuve/shared test` → 197/197 passed (was 181 — +16 from
  prompts.test.ts: 3 retired + 11 new local + 3 new executor + 6 new
  convergence = +17 net additions, +14 net = +16 net per engineer's count;
  reviewed each retirement, see "Retired prompt assertions" below).

### Typecheck

- `pnpm typecheck` → 6 successful, only `@neuve/sdk#typecheck` failed.
  Verified the failure is byte-identical to HEAD `f0d1e756` via
  `git show HEAD:packages/typescript-sdk/src/perf-agent.ts | sed -n '15,20p'`
  → `import type { Page } from "playwright";` — pre-existing playwright
  import without dep, R1 already documented this. The cascading
  `cli-solid:typecheck`, `@neuve/perf-agent-cli:typecheck`,
  `@neuve/evals:typecheck` ELIFECYCLEs are turbo's parallel-group abort
  signaling, not real failures (per R1 diary's verification).

### Compliance grep results

- **Regex on AgentTurn / NDJSON parsing:**
  `grep -nE "RegExp|new RegExp|\.match\(|/[^/].*?/[gimuy]*\.test\(" tool-loop.ts ollama-client.ts`
  → **zero hits**. PASS.
- **`null`:** `grep -nE "\bnull\b" tool-loop.ts ollama-client.ts agent.ts mcp-bridge.ts`
  → 2 hits, both pre-existing `typeof !== null` type-guards in agent.ts:174
  and mcp-bridge.ts:38. PASS.
- **Banned Effect operators:**
  `grep -nE "Effect\.(catchAll|mapError|orElseSucceed|option|ignore)\b"` →
  **zero hits**. PASS.
- **`try`/`catch`:** `grep -nE "\bcatch\s*\(" tool-loop.ts ollama-client.ts agent.ts mcp-bridge.ts`
  → tool-loop.ts:392 (auto-drill, pre-existing), mcp-bridge.ts:262-263
  (.catch(), pre-existing), agent.ts:62,138 (pre-existing). All flagged in
  engineer's compliance audit. None are R2 regressions. PASS.
- **`process.env`:** `grep -nE "process\.env"` → mcp-bridge.ts:187
  (pre-existing, child-process env spread, not config). PASS.
- **`Effect.fn` span name on `OllamaClient.chat`:** confirmed at
  ollama-client.ts:268. PASS. `OllamaClient.checkHealth` at line 366. PASS.
- **`Schema.ErrorClass` for all 4 errors:** `OllamaRequestError` (95),
  `OllamaTransportError` (105), `OllamaStreamError` (114),
  `OllamaHealthCheckError` (123) — all use `Schema.ErrorClass` with explicit
  `_tag: Schema.tag(...)` and a `message` class field. PASS.
- **`Effect.die` for SchemaError on chunk decode:** confirmed at
  ollama-client.ts:328 (EOF flush) and 342 (per-line). Per CLAUDE.md
  "Unrecoverable Errors Must Defect". PASS.
- **`Config.string` not `process.env`:** confirmed at ollama-client.ts:208,
  211 with `withDefault` for both `PERF_AGENT_OLLAMA_URL` and
  `PERF_AGENT_LOCAL_MODEL`. Names align with `acp-client.ts:556, 559`. PASS.

### Critical-path correctness

- **NDJSON streaming edge cases (ollama-client.ts:305-346):**
  - **Multiple JSON objects in one chunk:** Handled — the inner
    `while (true)` loop scans for `\n`, slices off complete lines, and keeps
    the remainder in `buffer`. PASS.
  - **Partial JSON across chunks:** Handled — `buffer += decoder.decode(value, { stream: true })`
    accumulates raw bytes; a partial line stays in `buffer` until the
    completing chunk arrives. The `decoder` is a TextDecoder in stream mode,
    which correctly handles UTF-8 split across boundaries. PASS.
  - **Malformed line:** `decodeChatChunk(line).pipe(Effect.catchTags({ SchemaError: Effect.die }))`
    → defect (per CLAUDE.md "Unrecoverable Errors Must Defect"). Acceptable;
    a malformed line means the wire protocol diverged from the schema — a
    bug, not a recoverable error.
  - **Stream EOF before `done:true`:** The trailing-flush at line 325-331
    decodes any remaining buffer content. If no `done:true` chunk arrives,
    `state.usage` and `state.doneReason` remain `undefined` — the result is
    still returned with whatever content/tool_calls accumulated. The caller
    (tool-loop) does check `if (result.usage)` before sending usage_update,
    so undefined-usage is gracefully handled. PASS.
- **`Schema.toJsonSchemaDocument(AgentTurn)` once at module load:**
  `tool-loop.ts:35-38` — IIFE assigning to module-scope const
  `AGENT_TURN_FORMAT`. Reused at line 118. Confirmed not regenerated per
  call. PASS.
- **Q9 flattenOneOf path unchanged:** `mcp-bridge.ts:89-173` (`flattenOneOf`)
  and `:51-62` (`detectWrapperKey`) match HEAD verbatim. The `listTools`
  rename to `listTools` (was `listToolsAsOpenAI`) is the only mcp-bridge
  surface change. The wrapping/unwrapping logic in `callTool` (lines
  235-240) uses the same `detectWrapperKey` original-schema path. PASS.
- **AgentTurn dispatch covers all 6 `_tag` values:**
  - `Thought` (188-201): `agent_thought_chunk` + observation. ✓
  - `PlanUpdate` (203-219): `agent_thought_chunk` + observation. ✓
  - `StepDone` (221-237): `agent_message_chunk` + observation. ✓
  - `AssertionFailed` (239-255): `agent_message_chunk` + observation. ✓
  - `RunCompleted` (257-270): `agent_message_chunk` + return. ✓
  - `Action` (272-439): MCP tool dispatch, preserves auto-drill, doom-loop,
    wrapper-key auto-wrap (via mcp-bridge.callTool). ✓
  All 6 branches present. PASS.
- **Doom-loop detector + auto-drill + MAX_TOOL_ROUNDS=15:**
  - `MAX_TOOL_ROUNDS = 15` → tool-loop.ts:25. PASS.
  - `DOOM_LOOP_THRESHOLD = 3` → tool-loop.ts:26. PASS.
  - Doom-loop detector → tool-loop.ts:277-313. Logic preserved (3 identical
    consecutive ACTIONs trip). MINOR finding above re: lost
    `lastToolError` context.
  - Auto-drill on trace-stop → tool-loop.ts:344-432. Logic preserved
    verbatim from HEAD:tool-loop.ts:240-321 (the engineer's stated
    line range was off by ~30 lines but the code matches by structure
    — same `parseTraceOutput` → `collectAutoDrillTargets` → forEach
    analyze flow with the same `try/catch` exception handler).

### `sanitizeBaseUrl` /v1 strip analysis

- Engineer's call site: `ollama-client.ts:196-205`.
- Strip is silent (no `Effect.logWarning` at startup).
- Strip is documented in:
  - `r2-2026-04-25.md` T6 §"Files changed" entry for `ollama-client.ts`.
  - Inline comment at `ollama-client.ts:199-202`.
- Strip is required by current callers: `wave-r2-subset.eval.ts:87`
  defaults `EVAL_OLLAMA_URL` to `http://localhost:11434/v1/`;
  `gemma.ts:14` defaults `GEMMA_DEFAULT_BASE_URL` to the same;
  `acp-client.ts:560` defaults `PERF_AGENT_OLLAMA_URL` to the same.
- Per the reviewer directive: "Silent + undocumented = MAJOR." Documented
  but silent is in the gray zone; the directive says "MUST be documented
  AND log a warning." Both required. Marked MAJOR — engineer must add a
  startup `Effect.logWarning` (or fix all 3+ callers). Suggest the warning
  approach since it's a one-liner; cleanup-the-callers can be a R3 task.

### 3 retired prompt assertions verified

- **Backtick-wrapped tool names** (`expect(prompt).toContain("`interact`")` →
  `expect(prompt).toContain("interact")`): the new prompt's
  `<tool_catalog>` block uses `- interact —` (no backticks). Retirement is
  honest. The bare-word check is weaker but functionally adequate.
  ACCEPTABLE.
- **`'YOU MUST call \`trace\`' directive`**: pre-R2 assertion was
  `expect(prompt).toContain('YOU MUST call \`trace\` with command="analyze" for EACH insight')`.
  Retired and replaced with `expect(prompt).toContain("Drill every insight returned by `trace stop`")`.
  Reading the new prompt at `prompts.ts:147`: the `<rules>` block contains
  `- Drill every insight returned by \`trace stop\`: emit ACTION → trace { action: { command: "analyze", insightSetId, insightName } } for each insight name (...). Skipping insights leaves the report incomplete.`
  The "must drill every insight" directive concept is preserved (re-worded
  imperatively as `Drill every insight…`). ACCEPTABLE.
- **JSON analyze example** (`'"command": "analyze"'` and
  `'"insightSetId": "NAVIGATION_0"'`): retired. Replaced by the inline call
  shape `ACTION → trace { action: { command: "analyze", insightSetId, insightName } }`
  in the rules block. The runtime JSON Schema (the `format` grammar)
  enforces the call shape, so prompt-level pinning is no longer load-bearing.
  Slight reduction in prompt-level coverage of the call shape but the
  envelope grammar is structurally enforced. ACCEPTABLE.

### Hygiene

- `git stash list` → empty. PASS.
- `git status --short` → all expected R2 paths + 9 pre-existing untracked
  paths (Q9 probe artifacts + `.claude/scheduled_tasks.lock`). PASS.
- `Co-Authored-By` enforcement → INFO; engineer is uncommitted, will apply
  at commit time.

---

## Summary for the lead

R2 is structurally sound. The native /api/chat migration is competent, the
AgentTurn dispatch is comprehensive across all 6 envelope branches, and the
prompt + grammar machinery is wired correctly. Two MAJOR findings need fixing
before this can land:

1. Add a startup `Effect.logWarning` (or remove `/v1/` from upstream
   callers) to address the silent base-URL rewrite per reviewer directive.
2. Add 3 dispatch tests in `tool-loop-agent-turn.test.ts` for PLAN_UPDATE,
   STEP_DONE, and ASSERTION_FAILED — each is ~10 lines and they cover the
   hot path.

The DoD ambiguity on tool-call rate is a PRD-revision question, not a R2
defect. Recommend revising PRD §R2 line 236 in R3 once the wire format
collapses.

---

## Round 2 verdict

**Date:** 2026-04-25 (continued)
**Reviewer:** strict-critique (round 2 verification of round-1 patches)
**Verdict:** **APPROVE**

Engineer addressed all 4 round-1 findings cleanly without introducing new
issues. Tests pass at the claimed counts. The 3 untouched callers were
verified untouched (Option A, not B). The Round 2 patches section in the
diary documents each fix with code snippets and verification log lines.

### Per-finding patch verification

- **[MAJOR] M1 — Silent /v1 strip → APPROVE.** `ollama-client.ts:196-224`.
  - The old `sanitizeBaseUrl` helper is gone (verified via
    `grep -nE "sanitizeBaseUrl" packages/local-agent/src/` → zero matches).
  - Trim/detect logic inlined into `resolveStartupConfig`. The pure helper
    `stripTrailingSlashes` (line 196) handles the `/`-strip; the `/v1`
    detection happens inside the `Effect.gen` chain.
  - `Effect.logWarning` (line 215) sits inside the
    `if (trimmedBaseUrl.endsWith("/v1"))` branch — not behind a flag, not
    in a finally, fires whenever the strip fires.
  - Annotations include both `rawBaseUrl` (the original user-supplied
    value) AND `sanitizedBaseUrl` (the post-strip URL that the client will
    actually use). Diagnostically unambiguous.
  - Detection runs AFTER `stripTrailingSlashes`, so `endsWith("/v1")` is
    the trailing-component check, not a substring match. Confirmed
    precise:
    - `/v1beta` (any trailing-slash variant): no match (ends in `/v1beta`).
    - `/api/v1/foo` (any trailing-slash variant): no match (ends in `/foo`).
    - `/v1` and `/v1/`: matches (correctly strips).
  - **Minor edge case (INFO, non-blocking):** a URL with a deeper path
    `http://example.com/api/v1/` would also match (after slash-trim it
    ends in `/v1`) and get rewritten to `http://example.com/api`. In
    practice no Ollama proxy sits at that path; the warning fires loudly
    so an operator would notice. Not flagging as MINOR — the warning is
    the safety net the directive asked for.
  - `resolveStartupConfig` runs once via `Effect.runSync` at
    `createOllamaClient()` time (line 270 area), not per request. No log
    flooding.
  - Verified the 3 callers were NOT touched (Option A confirmed):
    `git diff HEAD packages/agent/src/acp-client.ts` → empty;
    `git diff HEAD packages/evals/src/runners/gemma.ts` → empty;
    `wave-r2-subset.eval.ts` `EVAL_OLLAMA_URL` default still
    `"http://localhost:11434/v1/"` at line 87 (unchanged from round 1).

- **[MAJOR] M2 — Dispatch test coverage → APPROVE.**
  `tool-loop-agent-turn.test.ts:266-388`.
  - 3 new `it` cases added: PLAN_UPDATE (line 306), STEP_DONE (line 332),
    ASSERTION_FAILED (line 357). All exercised via the new
    `runDispatchScenario(midTurnEnvelope)` helper (line 273).
  - PLAN_UPDATE assertion (line 318-323) requires the dispatched
    `agent_thought_chunk` text to contain `"PLAN_UPDATE"`, `"step-02"`,
    AND `"insert"` — pins the marker format `[PLAN_UPDATE action=insert
    step=step-02]` produced by `tool-loop.ts:210`.
  - STEP_DONE assertion (line 343-348) requires `agent_message_chunk`
    text to start with `"[STEP_DONE step-01]"` — pins the marker format
    `tool-loop.ts:228`.
  - ASSERTION_FAILED assertion (line 371-379) requires
    `agent_message_chunk` text to start with `"[ASSERTION_FAILED
    step-03"` AND contain `"category=budget-violation"` AND
    `"domain=perf"` — pins the marker format `tool-loop.ts:246`.
  - Each test asserts `calls.length, 0` so an accidental bypass into the
    ACTION branch would fail loudly.
  - Each test pins the message-history sequence
    `system → assistant (envelope) → user (observation) → assistant (RUN_COMPLETED)`
    via `assert.deepStrictEqual(messages.map((m) => m.role), [...])`.
  - File-level test count: 2 → 5 (matches engineer's claim).
  - Whole `@neuve/local-agent` package: 19 → **22 tests** (verified by
    independent run, see verification log below).

- **[MINOR] m3 — Doom-loop `Last error: …` tail → APPROVE.**
  `tool-loop.ts:104, 299, 306, 330-332`.
  - `let lastToolError: string | undefined` declared at line 104,
    OUTSIDE the for-loop (run-scoped, persists across iterations). ✓
  - Set ONLY when `isError === true` at line 330-332:
    ```
    if (isError) {
      lastToolError = text;
    }
    ```
    Happy-path tool results do NOT overwrite it. ✓
  - Threaded into abort message at line 306 verbatim:
    `... Aborting to avoid wasted cycles. Last error: ${lastErrorOrUnknown}. Check the tool description for the expected call shape.` ✓
  - Fallback `?? "unknown"` at line 299 (`lastToolError ?? "unknown"`).
    Sensible default when no MCP error has been seen yet.
  - Wording matches pre-R2 abort message except for the (correct)
    "ACTION envelopes" terminology in place of "tool calls".

- **[MINOR] m4 — Diary text aligned → APPROVE.**
  `docs/handover/react-migration/diary/r2-2026-04-25.md:224-233`.
  - New text says `recentCalls` is mutated **only inside the ACTION
    branch**: matching ACTION pushes, non-matching ACTION clears,
    non-ACTION envelopes leave it untouched.
  - The example trajectory `ACTION_X → THOUGHT → ACTION_X → THOUGHT →
    ACTION_X` correctly identifies the third ACTION_X as tripping the
    detector (intervening THOUGHTs don't reset the count).
  - Reasoning matches the actual code at `tool-loop.ts:273-313`: the
    only `recentCalls.length = 0` site is at line 282, inside
    `if (envelope instanceof Action)`. Non-ACTION branches all hit
    `continue` before reaching that block.

### Verification log (round 2)

- `pnpm --filter @neuve/local-agent test` → **22/22 passed** (3 test
  files: `dist-spawn.test.ts`, `flatten-one-of.test.ts`,
  `tool-loop-agent-turn.test.ts`). Round-1 count was 19; +3 new dispatch
  tests = 22. ✓
- `pnpm --filter @neuve/shared test` → 197/197 passed (unchanged from
  round 1). ✓
- `pnpm --filter @neuve/local-agent build` → green. `dist/main.js` 38.29
  kB (engineer's claim was ~38 kB; matches). ✓
- `pnpm --filter @neuve/local-agent exec vp test run flatten-one-of` →
  15/15 passed. Q9 regression preserved. ✓
- 8-package consumer typecheck: all green
  (`@neuve/shared`, `@neuve/cookies`, `@neuve/local-agent`,
  `@neuve/agent`, `@neuve/supervisor`, `@neuve/evals`,
  `@neuve/perf-agent-cli` (apps/cli), `cli-solid`).
- Full repo `pnpm typecheck`: only pre-existing `@neuve/sdk#typecheck`
  Playwright failure (byte-identical to HEAD `f0d1e756`, verified in
  round 1).
- Compliance grep:
  - `grep -nE "sanitizeBaseUrl" packages/local-agent/src/` → **zero**
    (helper deleted). ✓
  - `grep -nE "Effect\.logWarning" packages/local-agent/src/ollama-client.ts`
    → **1 match at line 215**. ✓
  - `grep -nE "RegExp|new RegExp|\.match\(|/[^/].*?/[gimuy]*\.test\("`
    on tool-loop.ts and ollama-client.ts → zero. ✓
  - `grep -nE "\bnull\b"` on tool-loop.ts and ollama-client.ts → zero. ✓
  - `grep -nE "Effect\.(catchAll|mapError|orElseSucceed|option|ignore)\b"`
    on the 4 modified files → zero. ✓
  - `git diff HEAD packages/local-agent/src/tool-loop.ts | grep "^\+.*\bcatch\s*\("`
    → zero new try/catch additions. ✓
- Hygiene:
  - `git stash list` → empty. ✓
  - `git status --short` → only the R2 surface (modified set listed in
    teammate-message) + the round-1 untracked paths + the new
    `r2-review.md` (created by reviewer in round 1). ✓
- Untouched-callers spot-check (Option A confirmed):
  - `git diff HEAD packages/agent/src/acp-client.ts` → empty. ✓
  - `git diff HEAD packages/evals/src/runners/gemma.ts` → empty. ✓
  - `packages/evals/evals/wave-r2-subset.eval.ts` (untracked from round
    1) — `EVAL_OLLAMA_URL` default still `http://localhost:11434/v1/`
    at line 87, unchanged from round 1. ✓

### New issues introduced by round-2 changes

None. The patches are minimal, surgical, and don't touch unrelated code
paths. The one minor edge case (deep-path `/api/v1/` false-positive on
the `/v1` strip) is theoretical and the warning would alert an operator
if it fired unexpectedly — not blocking.

### Summary

All 4 round-1 findings (2 MAJOR + 2 MINOR) are cleanly addressed. Tests
pass at the claimed counts. No regressions. No new majors. **APPROVE.**

The lead can instruct the engineer to commit per the granular plan. The
INFO items from round 1 (PRD DoD wording revision for tool-call rate,
schema-validity counter as eval scorer, missing oracle-plan calibration
data) remain as R3 carry-overs, not blockers for landing R2.
collapses.
