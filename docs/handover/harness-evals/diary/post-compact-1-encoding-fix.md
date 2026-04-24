# Post-Compact 1 — Fix ACP ToolCall encoding mismatch + URL extraction failure

**Owner:** `encoding-eng`
**Tasks:** #1 + #2 (real-runner-encoding team)
**Status:** Feature-complete; reviewer pending.

## Context

Today's post-compaction baseline run (`EVAL_RUNNER=real EVAL_BACKEND=gemini`
against `packages/evals/evals/wave-4-5-subset.eval.ts`) was the first live
exercise of the real-runner + ACP + chrome-devtools-mcp pipeline end-to-end —
every earlier wave had used mock / static-diff / pre-captured replay traces.
All three calibration tasks scored 25% with `reached=0`, `final="-"`, and
`tool-call-validity=1.0`. The captured traces looked like this:

```json
// Before fix — Gemini live (evals/traces/real__calibration-3-two-step-docs.ndjson @ pre-fix)
{"type":"tool_call","ts":…,"turn":2,"id":"tc-000","name":"{\"action\":{\"command\":\"snapshot\"}}","args":"{}"}
{"type":"tool_result","ts":…,"id":"tc-000","result":"undefined","ok":true}
```

Two failure modes were visible:

1. **Bug 1 — tool_call encoding:** the trace's `name` field carried the
   JSON-stringified tool *arguments*, and `args` was the literal string
   `"{}"`. The real input never reached `event.input`.
2. **Bug 2 — tool_result encoding:** `result` was the literal string
   `"undefined"` because `serializeToolResult(undefined)` returns
   `String(undefined)`. The navigated URL that the agent clearly reached
   (agent text said "Navigated to https://docs.python.org/3/") was never
   extractable.

Consequence: `extractUrlFromToolInput` saw `"{}"` → no URL, and
`extractUrlFromToolResult` saw `"undefined"` → no URL. `reachedKeyNodes` and
`finalUrl` stayed empty for every task.

## Root cause

**One issue in one file:** `packages/shared/src/models.ts`
`ExecutedPerfPlan.addEvent`'s `tool_call` and `tool_call_update` handlers
assume the Claude-style ACP shape (`title` = human-readable label, `rawInput`
present, `rawOutput` present). They do not gracefully degrade when
`rawInput` / `rawOutput` are absent — which is exactly what Gemini CLI's
ACP adapter emits for MCP-backed tools.

Evidence from Gemini CLI's ACP adapter
(`node_modules/.pnpm/@google+gemini-cli@0.35.3/dist/src/acp/acpClient.js:654-672`):

```js
// tool_call — in_progress
await this.sendUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: callId,
    status: 'in_progress',
    title: invocation.getDescription(),   // JSON-stringified action for MCP tools
    content: [],
    locations: invocation.toolLocations(),
    kind: toAcpToolKind(tool.kind),
    // no rawInput
});
// …tool runs…
// tool_call_update — completed
await this.sendUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: callId,
    status: 'completed',
    content: content ? [content] : [], // wrapped ACP content blocks — no rawOutput, no title
});
```

- **Title is misused:** `invocation.getDescription()` returns the stringified
  action object for chrome-devtools-mcp's MCP tools (e.g.
  `{"action":{"command":"snapshot"}}`). The ACP spec says `title` is a
  human-readable label, so this is a Gemini adapter quirk — we cannot
  change it upstream.
- **`rawInput` is omitted entirely.**
- **`rawOutput` is never populated** on the `tool_call_update`. The actual
  result text lives inside `update.content`, wrapped as an array of
  `AcpToolCallContent` entries each of which has `type: "content"` and an
  inner ACP content block with the text.

Claude's ACP adapter
(`node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.24.2/dist/acp-agent.js:1462-1550`)
sends both `rawInput` (deep-cloned from `chunk.input`) and `rawOutput`
(the tool's content array), so Claude was never affected by Bug 1 or
Bug 2. We confirmed this empirically — see `after-fix-claude` trace below.

### Hypothesis resolution

Hypothesis A said Bug 2 would disappear once Bug 1 was fixed. Hypothesis B
said they were independent. **B was correct** — Bug 1 is the `tool_call`
encoding (fix at input field), Bug 2 is the `tool_call_update` encoding
(fix at output field). Fixing only Bug 1 would still have left `result:
"undefined"`, starving the extract-from-result path. Both fixes are
required.

### Blast radius

- Bug 1 affects only backends that omit `rawInput` (observed: Gemini).
  Claude's `rawInput` path stays the winner in `deriveToolCallInput`.
- Bug 2 affects only backends that omit `rawOutput` (observed: Gemini).
  Claude's `rawOutput` path stays the winner in `deriveToolCallResult`.
- No Claude trace regression — the `after-fix-claude` smoke (see below)
  shows the same `result: "[{...}]"` shapes we had pre-fix, since
  `rawOutput` takes precedence over the new content fallback.

## Fix

**File:** `packages/shared/src/models.ts`

Added two helpers + wired them into `addEvent`:

```ts
// Prefer rawInput (Claude); fall back to decoded title JSON (Gemini MCP);
// default to empty object. Schema.fromJsonString + Predicate.isObject —
// no regex, per `feedback_types_over_regex.md` memory.
const StructuredToolInput = Schema.fromJsonString(Schema.Unknown);
const decodeStructuredToolInput = Schema.decodeUnknownOption(StructuredToolInput);

const deriveToolCallInput = (update: AcpToolCall | AcpToolCallUpdate): string => {
  if (update.rawInput !== undefined) return JSON.stringify(update.rawInput);
  const title = update.title;
  if (typeof title === "string" && title.length > 0) {
    const decoded = decodeStructuredToolInput(title);
    if (Option.isSome(decoded) && Predicate.isObject(decoded.value)) {
      return JSON.stringify(decoded.value);
    }
  }
  return JSON.stringify({});
};

// Prefer rawOutput (Claude); fall back to unwrapped content[] array
// (Gemini). Unwrapping projects `{type:"content", content:{type:"text",
// text:"..."}}` → `{type:"text", text:"..."}`, which is exactly what
// url-extraction already parses for the bare-content-array path
// (packages/evals/src/runners/url-extraction.ts:148-151).
const deriveToolCallResult = (update: AcpToolCallUpdate): string => {
  if (update.rawOutput !== undefined) return serializeToolResult(update.rawOutput);
  if (update.content !== undefined && update.content !== null && update.content.length > 0) {
    return serializeToolResult(unwrapToolCallContent(update.content));
  }
  return serializeToolResult(update.rawOutput);
};
```

Both call sites in `addEvent` now use these helpers:

- `tool_call` → `ToolCall.input = deriveToolCallInput(update)`
- `tool_call_update` status completed/failed → `ToolResult.result =
  deriveToolCallResult(update)`
- `tool_call_update` rawInput update → `ToolCall.input =
  deriveToolCallInput(update)` (replay path preserved)
- `tool_call_update` progress path now also triggers when `content` is
  non-empty (not just `rawOutput !== undefined`), so Gemini streaming
  progress still emits `ToolProgress` events.

`toolName` continues to be `update.title` — that's the only name-like
field ACP surfaces. For Gemini's MCP tools the trace's `name` still
carries the JSON title (Gemini's protocol misuse), but since `input`
and `result` now have the real data, URL extraction and scoring work.
Cosmetically ugly, semantically correct.

### Why not fix this in the eval layer?

Fixing it in `ExecutedPerfPlan.addEvent` benefits **both** production
(the CLI's supervisor stream) and the evals pipeline. The production
CLI's `reporter.ts` already uses `event.input` to pull navigation URLs
out of tool calls — Gemini users hitting that code path would have
previously seen empty insights too. One fix, one surface.

## Test coverage

**Locked in at `packages/evals/tests/real-runner.test.ts:536-640`.**
Two new tests:

1. `recovers input from title JSON when rawInput is absent (Gemini
   tool_call shape)` — builds a Gemini-shape `AcpToolCall` with
   `title: JSON.stringify({action:{command:"navigate",url:"..."}})`
   and no `rawInput`, asserts `trace.toolCalls[0].arguments["input"]`
   round-trips to the expected object and `finalUrl` = example.com.
2. `recovers result from content[] when rawOutput is absent (Gemini
   tool_call_update shape)` — builds a Gemini-shape tool_call_update
   with a content array holding a wrapped text block containing
   `uid=1_0 RootWebArea … url="https://example.com/"`, asserts
   `reachedKeyNodes.length === 1` and `finalUrl = "https://example.com/"`.

The pre-existing 117 tests (the Claude-shape path, plus url-extraction
contract tests, plus scorer tests) still pass — **119/119 green**.

## Verification

```
pnpm --filter @neuve/shared typecheck   # green
pnpm --filter @neuve/evals  typecheck   # green
pnpm --filter @neuve/shared test        # 118/118
pnpm --filter @neuve/evals  test        # 119/119 (117 + 2 new)
```

### Live smoke: Gemini

`EVAL_RUNNER=real EVAL_BACKEND=gemini pnpm exec evalite run
./evals/wave-4-5-subset.eval.ts`

| Task | Before | After |
|------|--------|-------|
| calibration-1-single-nav-python-docs | 25%, reached=0, final="-" | **75%, reached=1, final="ok"** |
| calibration-2-single-nav-news        | 25%, reached=0, final="-" | **75%, reached=1, final="ok"** |
| calibration-3-two-step-docs          | 25%, reached=0, final="-" | **75%, reached=2, final="ok"** |

First clean Gemini run after the fix (`duration≈122s`). Smoke saved at
`packages/evals/evals/traces/real__calibration-1-single-nav-python-docs.ndjson.after-fix-gemini`.
Preview:

```json
{"type":"tool_result","ts":…,"id":"tc-000","result":"[{\"type\":\"text\",\"text\":\"Successfully navigated to https://docs.python.org/3/.\\n## Pages\\n1: https://docs.python.org/3/ [selected]\"}]","ok":true}
{"type":"tool_call","ts":…,"turn":2,"id":"tc-000","name":"{\"action\":{\"command\":\"snapshot\"}}","args":"{\"action\":{\"command\":\"snapshot\"}}"}
{"type":"tool_result","ts":…,"id":"tc-000","result":"[{\"type\":\"text\",\"text\":\"## Latest page snapshot\\nuid=1_0 RootWebArea \\\"3.14.4 Documentation\\\" url=\\\"https://docs.python.org/3/\\\"…}]","ok":true}
```

- `args` now has the decoded JSON (`{"action":{"command":"snapshot"}}`)
  instead of `"{}"`.
- `result` now carries the MCP text payload (`[{...}]`) instead of the
  literal string `"undefined"`.
- URL extraction matches the `uid=1_0 RootWebArea ... url="..."` pattern
  from the snapshot response → `finalUrl = https://docs.python.org/3/`.

### Live smoke: Claude

`EVAL_RUNNER=real EVAL_BACKEND=claude pnpm exec evalite run
./evals/wave-4-5-subset.eval.ts`

| Task | Score |
|------|-------|
| calibration-1-single-nav-python-docs | **75%, reached=1, final="ok"** |
| calibration-2-single-nav-news        | **75%, reached=1, final="ok"** |
| calibration-3-two-step-docs          | **75%, reached=2, final="ok"** |

Duration ≈ 240s. Smoke saved at
`packages/evals/evals/traces/real__calibration-1-single-nav-python-docs.ndjson.after-fix-claude`.
Preview:

```json
{"type":"tool_call","ts":…,"turn":2,"id":"tc-000","name":"ToolSearch","args":"{}"}
{"type":"tool_result","ts":…,"id":"tc-000","result":"[{\"type\":\"tool_reference\",\"tool_name\":\"mcp__browser__interact\"},…]","ok":true}
{"type":"tool_call","ts":…,"turn":3,"id":"tc-001","name":"mcp__browser__interact","args":"{}"}
{"type":"tool_result","ts":…,"id":"tc-001","result":"[{\"type\":\"text\",\"text\":\"Successfully navigated to https://docs.python.org/3/…\"}]","ok":true}
```

Claude traces carry proper tool names (`ToolSearch`,
`mcp__browser__interact`) — the `rawInput` / `rawOutput` path is
preserved; no regression.

The 75% ceiling on both backends is one failing scorer out of four.
Not our fix's responsibility — worth a follow-up.

## Out-of-scope adjacent bug discovered

Gemini CLI's ACP adapter sends tool calls that require *permission
confirmation* via `connection.requestPermission(params)` — NOT via a
`sessionUpdate` (`acpClient.js:618-637`). Our `AcpClient` handler
auto-approves those permission requests but does **not** synthesize a
matching `AcpToolCall` session update, so the initial navigate's
`tool_call` is silently swallowed. The subsequent
`tool_call_update { status: "completed" }` still arrives, so we get a
`tool_result` event with no matching `tool_call` event. The
calibration-1 Gemini trace line 2 shows this — a tool_result appears
before any tool_call.

This doesn't block URL extraction (the navigate URL is still in the
tool_result content, and our fix recovers it), but it does mean the
Gemini trace's tool-call count is under-reported vs Claude. Filing as
a new team task (#4) for follow-up; out of scope for tasks #1/#2.

## Files changed

- `packages/shared/src/models.ts` (+62/-4) — helpers + addEvent wiring
- `packages/evals/tests/real-runner.test.ts` (+105/-0) — two new
  Gemini-shape lock-in tests

---

## Round 2 patches

Reviewer round 1 at
`docs/handover/harness-evals/reviews/post-compact-1-review-round-1.md`
returned REQUEST_CHANGES with one MAJOR + two minor findings (attribution
error on `evalite.config.ts` ignored per lead's instruction). Patches
below.

### MAJOR 1 — `pnpm check` fails (merge blocker)

**Finding:** `models.ts:1047` was a 114-char line violating the format
gate. HEAD's models.ts passes; the round-1 diff failed. The other 6
`@neuve/shared` format failures are pre-existing drift (confirmed via
`git stash` check — same 6 files fail on HEAD without my changes).

**Fix:** Extracted the long predicate into a named `hasContent` local:

```ts
const hasContent =
  update.content !== undefined && update.content !== null && update.content.length > 0;
if (update.rawOutput !== undefined || hasContent) { ... }
```

`pnpm --filter @neuve/shared format:check` now reports only the 6
pre-existing drift files — `src/models.ts` is no longer in the list.

**Process gap Minor 3:** I ran `typecheck + test` in round 1 but not
`pnpm check`. Added `pnpm check` to the personal checklist for this and
future work; that's what would have caught the long line before
handoff.

### Minor 1 — degenerate edge case in `deriveToolCallResult`

**Finding:** When BOTH `rawOutput` AND `content` are absent, the
function fell through to `serializeToolResult(update.rawOutput)` —
which returns the literal string `"undefined"`, recreating exactly the
Bug 2 regression on the both-absent edge.

**Fix:** Explicit `return "[]"` on the both-absent path so downstream
extractors see a decodable-but-empty envelope:

```ts
const deriveToolCallResult = (update: AcpToolCallUpdate): string => {
  if (update.rawOutput !== undefined) return serializeToolResult(update.rawOutput);
  const content = update.content;
  if (content !== undefined && content !== null && content.length > 0) {
    return serializeToolResult(unwrapToolCallContent(content));
  }
  return "[]";
};
```

Why `"[]"` and not `Option.none()` / upstream refactor: the consumer
shape is `ToolResult.result: Schema.String` (non-optional), and
`extractUrlFromToolResult` already handles the bare-content-array path
by decoding the string. Returning the empty-array JSON keeps the
existing lock-in tests happy (the "records agent messages, tool events…"
test at line 232 uses `rawOutput: "navigated"` which is serialized as
`"\"navigated\""` — unchanged) while making the both-absent degenerate
case safe.

**Lock-in test** added at `packages/evals/tests/real-runner.test.ts:658`
(`emits empty-array result when both rawOutput and content are absent`).
Scripts a minimal tool_call_update with neither field and asserts the
emitted trace's `result` is `"[]"` and explicitly *not* `"undefined"`.

### Minor 2 — eager computation of `updatedInput`

**Finding:** At round-1 `models.ts:1016`, `updatedInput = deriveToolCallInput(update)`
was computed unconditionally on every `tool_call_update` even though
it's only read inside the `rawInput !== undefined` branch.

**Fix:** Moved the assignment inside the branch. Zero-op for correctness
but avoids a JSON.stringify call on every progress-only update when
rawInput isn't being changed.

## Round 2 verification

```
pnpm --filter @neuve/shared typecheck       # green
pnpm --filter @neuve/evals  typecheck       # green
pnpm --filter @neuve/shared format:check    # only 6 pre-existing drift
pnpm --filter @neuve/evals  format:check    # all clean
pnpm --filter @neuve/shared test            # 118/118
pnpm --filter @neuve/evals  test            # 120/120 (+1 Minor-1 lock-in)
pnpm check                                   # fails ONLY on 6 pre-existing drift
```

The `pnpm check` residual (`@neuve/shared:check ... Found formatting
issues in 6 files`) is exactly the same set that fails on HEAD before
my changes — verified by `git stash` → `pnpm --filter @neuve/shared
format:check` → same 6 files listed. Per lead's direction, those are
pre-existing drift and not in scope here.

### Live Gemini smoke after round 2

`EVAL_RUNNER=real EVAL_BACKEND=gemini pnpm exec evalite run
./evals/wave-4-5-subset.eval.ts` — 68.9s wall time.

| Task | After-round-1 | After-round-2 |
|------|---------------|---------------|
| calibration-1-single-nav-python-docs | 75% reached=1 final="ok" | **75% reached=1 final="ok"** |
| calibration-2-single-nav-news        | 75% reached=1 final="ok" | **75% reached=1 final="ok"** |
| calibration-3-two-step-docs          | 75% reached=2 final="ok" | 25% reached=0 final="-" |

Calibration-3 aborted immediately (stream_terminated at t+0.3s with
remainingSteps=2 — Gemini killed the session before any tool was
attempted). This is the same Gemini session flakiness I documented in
the round-1 retry (cal-2 aborted then, cal-3 aborts now). Orthogonal to
the encoding fix — when a tool_call actually fires, the encoding path
still produces clean data. Trace saved at
`evals/traces/real__calibration-1-single-nav-python-docs.ndjson.after-round2-gemini`:

```json
{"type":"tool_result","ts":…,"id":"tc-000","result":"[{\"type\":\"text\",\"text\":\"Successfully navigated to https://docs.python.org/3/.\\n## Pages\\n1: https://docs.python.org/3/ [selected]\"}]","ok":true}
{"type":"tool_call","ts":…,"turn":2,"id":"tc-000","name":"{\"action\":{\"command\":\"snapshot\"}}","args":"{\"action\":{\"command\":\"snapshot\"}}"}
{"type":"tool_result","ts":…,"id":"tc-000","result":"[{\"type\":\"text\",\"text\":\"## Latest page snapshot\\nuid=1_0 RootWebArea \\\"3.14.4 Documentation\\\" url=\\\"https://docs.python.org/3/\\\"\\n…\"}]","ok":true}
```

Same clean encoding shape as after-round-1: `args` carries the decoded
action JSON (not `"{}"`), `result` carries the MCP content array (not
`"undefined"`), URL extraction hits the `RootWebArea … url="…"` pattern.

### Round 2 files changed

- `packages/shared/src/models.ts` (+5/-3 vs round-1) — long line broken,
  both-absent edge returns `"[]"`, `updatedInput` moved inside branch.
- `packages/evals/tests/real-runner.test.ts` (+56/-0 vs round-1) — new
  Minor-1 lock-in test.

## Follow-up

- Reviewer pass on `real-runner-encoding` team task #3.
- Optional follow-up: propagate permission-request-bundled tool_call
  data through the sessionUpdate stream so Gemini's confirmed
  navigations produce complete tool_call + tool_result pairs in the
  trace (team task #4, to be filed).
