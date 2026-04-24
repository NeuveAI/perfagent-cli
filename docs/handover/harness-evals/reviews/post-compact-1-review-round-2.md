# Review: Post-Compact 1 — ACP ToolCall encoding + URL extraction fix (Round 2)

**Reviewer:** `reviewer` (team `real-runner-encoding`)
**Round 1 doc:** `docs/handover/harness-evals/reviews/post-compact-1-review-round-1.md`
**Files changed this round (working tree vs. HEAD):**
- `packages/shared/src/models.ts` (+68/-5 vs. HEAD; +7 lines vs. round-1 state — predicate extraction + explicit `"[]"` fallback + moved `updatedInput`)
- `packages/evals/tests/real-runner.test.ts` (+176/-0 vs. HEAD; +54 lines vs. round-1 — new Minor-1 lock-in test)
- `packages/evals/evalite.config.ts` — **ignored**, lead-owned per round-1 correction

## Verdict: APPROVE

All four round-1 items are genuinely resolved. `pnpm check` now fails only on the six pre-existing drift files (none of which the engineer has touched). No regressions introduced to previously-accepted behavior. Live Gemini smoke shows 2/3 tasks at 75% with fully correct `name`/`args`/`result` encoding; the 1/3 flake (calibration-1 this run) is Gemini session-stability — the trace contains zero tool events, so the encoding path is not exercised and cannot be the cause.

## Verification executed (independent, not taken on faith)

| Command | Outcome |
|---|---|
| `git diff --stat` | 3 tracked files (models.ts, real-runner.test.ts, evalite.config.ts). Round-1 scope preserved; evalite.config.ts ignored per lead's round-1 correction. |
| `pnpm --filter @neuve/shared typecheck` | ✅ green |
| `pnpm --filter @neuve/evals typecheck` | ✅ green |
| `pnpm --filter @neuve/shared test` (×2) | ✅ 118/118, deterministic |
| `pnpm --filter @neuve/evals test` (×2) | ✅ 120/120 (was 119, +1 Minor-1 lock-in), deterministic |
| `pnpm check` repo-wide | ❌ still fails, but on **exactly 6 files** — `src/cwv-thresholds.ts`, `src/parse-insight-detail.ts`, `src/parse-network-requests.ts`, `tests/ci-result-output.test.ts`, `tests/parse-insight-detail.test.ts`, `tests/parse-trace-output.test.ts`. **None of these are in the engineer's diff.** All pre-existing drift (same category as `final-state.ts` reverted in commit `137feb09`). |
| `pnpm --filter @neuve/shared exec vp check --no-lint src/models.ts` | ✅ `All 1 file are correctly formatted` — round-1 MAJOR 1 is genuinely fixed at the file level |
| `pnpm --filter @neuve/evals exec vp check --no-lint tests/real-runner.test.ts` | ✅ `All 1 file are correctly formatted` |
| `EVAL_RUNNER=real EVAL_BACKEND=gemini pnpm exec evalite run ./evals/wave-4-5-subset.eval.ts` | Overall score 58%. Task-level: cal-1 **25%** (reached=0, tools=0, final=-); cal-2 **75%** (reached=1, tools=1, final=ok); cal-3 **75%** (reached=2, tools=3, final=ok). Duration 62s. |

**Gemini smoke trace inspection (cal-1 flake is not a regression):**
Full trace of `real__calibration-1-single-nav-python-docs.ndjson` — only 2 lines:
```
{"type":"agent_message","ts":…,"turn":1,"content":"I am starting the evaluation…\nSTEP_START"}
{"type":"stream_terminated","ts":…,"reason":"stream_ended","remainingSteps":2}
```
Stream terminated 120 ms after the first message, before any tool_call was attempted. Zero tool events, therefore zero encoding exposure. Matches the round-1 "Gemini session kill at t+0.3s" flake pattern the engineer described. **Not encoding-caused**, confirmed by absence of tool events.

**Gemini smoke trace inspection (cal-2/cal-3 encoding is correct):**
Spot-checked `real__calibration-2-single-nav-news.ndjson` and `real__calibration-3-two-step-docs.ndjson`:
- `args` now carries the decoded JSON object (e.g. `"{\"action\":{\"command\":\"snapshot\"}}"`, `"{\"action\":{\"uid\":\"1_42\",\"command\":\"click\"}}"`), not `"{}"`.
- `result` carries the MCP content-array envelope (e.g. `"[{\"type\":\"text\",\"text\":\"Successfully navigated to https://www.bbc.com/news…\"}]"`), not `"undefined"`.
- URL extraction reaches `finalUrl` and increments `reachedKeyNodes` as expected.
- Three distinct tool operations (navigate, snapshot, click) all encode correctly in cal-3, proving the decode-title + content-unwrap paths aren't snapshot-specific.

## Resolution confirmation — round-1 findings

### [MAJOR 1] `pnpm check` format violation at `models.ts:1047` — **RESOLVED**

Engineer extracted the long conditional into a named local:
```ts
const hasContent =
  update.content !== undefined && update.content !== null && update.content.length > 0;
if (update.rawOutput !== undefined || hasContent) {
```
The `hasContent` predicate is the same boolean shape used inside `deriveToolCallResult` line 775 for consistency. `pnpm --filter @neuve/shared exec vp check --no-lint src/models.ts` passes. `models.ts` is no longer in the 7-file failure list; only the 6 pre-existing drift files remain. Fix is targeted and correct.

### [MINOR 1] `deriveToolCallResult` fallback returned the literal string `"undefined"` — **RESOLVED**

Engineer replaced the silent `serializeToolResult(update.rawOutput)` fallthrough at `models.ts:779` with an explicit `return "[]";`, annotated by a three-line comment that names the degenerate case and cites the downstream decoder shape. New lock-in test at `real-runner.test.ts:684` constructs a `tool_call_update` with status=completed, `title: "mcp__browser__observe"`, `rawInput: {}`, and no content/rawOutput; asserts both the positive (`resultField === "[]"`) and negative (`resultField !== "undefined"`) properties. The test reads the actual persisted ndjson (not just the in-memory model) — correct shape for a trace-format regression gate.

Accepting the engineer's design call on string-return. `ToolResult.result: Schema.String` is non-optional, and `"[]"` decodes cleanly through `url-extraction.ts:148` (`decodeContentArray` → empty array → `urlFromContentArray` returns undefined). Threading `Option.none()` through `ToolResult.result` would require schema-wide changes not warranted by a degenerate edge case.

### [MINOR 2] Eager `updatedInput` computation at `models.ts:1016` — **RESOLVED**

`const updatedInput = deriveToolCallInput(update);` is now inside the `if (update.rawInput !== undefined)` guard (line 1022 in round-2). No unused-value computation on the common Gemini path where `rawInput === undefined`.

### [MINOR 3] Engineer did not run `pnpm check` — **ACKNOWLEDGED**

Lead reports engineer has added `pnpm check` to their personal verification checklist. Independent confirmation: the engineer's round-2 verification list includes `pnpm check` with an accurate report of the 6-file pre-existing drift. Good process discipline.

## New findings (round 2)

### [SUGGESTION] Lock-in test uses `as`-cast where a Schema decode would be cleaner — `packages/evals/tests/real-runner.test.ts:707`

```ts
const toolResult = raw.find((event) => decodeWireEnvelope(event).type === "tool_result");
assert.ok(toolResult !== undefined, "tool_result event should be emitted");
const resultField = (toolResult as { result: unknown }).result;   // ← type cast
```

The project's CLAUDE.md rule ("no type casts (`as`) unless unavoidable") prefers Schema-decode over casts. `packages/evals/src/runners/trace-recorder.ts:35-42` exports `ToolResultEvent` — a typed schema for exactly this event — so the idiomatic form is:
```ts
const decoded = Schema.decodeUnknownSync(ToolResultEvent)(toolResult);
assert.strictEqual(decoded.result, "[]");
```
Non-blocking. The `as { result: unknown }` cast is narrow (not widening to `any`), the test asserts the right values, and this file has no similar precedent today. Flagging so the pattern doesn't propagate.

## Non-findings (investigated, clean)

- **Claude regression risk:** No — `deriveToolCallInput` still prefers `rawInput` first; `deriveToolCallResult` still prefers `rawOutput` first; Claude's wire format hits those branches and never touches the title-decode or content-unwrap paths.
- **Sibling code:** No change from round 1. `local-agent/src/tool-loop.ts`, `evals/src/runners/{mock,real,gemma}.ts` all unaffected.
- **Determinism:** Both shared and evals test suites ran twice with identical 118/118 and 120/120 counts.
- **Diary claim re: "one fix, one surface":** Still half-true (production reporter doesn't decode nested-action shape), but lead filed this as task #5 — out of scope for this PR.
- **Out-of-scope tasks #4 and #5:** Both confirmed out of scope prior round; not revisited.

## Recommendation

APPROVE for merge. The engineer resolved all four round-1 items cleanly and introduced one new lock-in test that closes the degenerate-edge regression surface. The one new suggestion (Schema-decode over `as`-cast in the lock-in test) is non-blocking and can be addressed in a follow-up or ignored.

Lead-owned `evalite.config.ts` change still pending a disclosed chore commit per the round-1 correction message — tracking but not gating this engineer's work.
