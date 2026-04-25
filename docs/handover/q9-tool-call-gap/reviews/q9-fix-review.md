# Review: Q9 oneOf schema fix

Reviewer: `q9-reviewer`
Date: 2026-04-24
Commits reviewed: `8dd28bd7` (C1 fix), `60e4b063` (C2 probe), `b0ae25b1` (C3 tool-loop), `e693df9d` (C4 num_ctx), `cf6e565e` (C5 docs)

## Verdict: APPROVE

The fix works end-to-end (verified by a live re-run of the post-fix probe against Ollama
below). The implementation matches Option A of the diagnosis exactly: the three compound
schemas are flattened into a discriminated-enum-plus-hoisted-properties shape, the wrapper
property is dropped from the OpenAI surface, and `detectWrapperKey` still runs against the
ORIGINAL schema so call-time re-wrap continues to work. The unit test suite locks in each
of the three production compound tools plus the five flat pass-throughs plus
`detectWrapperKey` continuing to return `"action"`. All scope-creep flagged by team-lead in
the diff-stat is pure Prettier formatting drift — zero semantic change. No banned Effect
or error-handling patterns introduced; `repairAndParseJson` removal in tool-loop is the
correct direction (let the fiber die rather than paper over malformed JSON with a regex
repair → empty-object fallback, which per CLAUDE.md's "Never Swallow Errors" rule is
banned anyway).

Nothing rises to Critical or Major. A short list of Minor findings and non-blocking
suggestions follows.

## Verification command results

### 1. `flattenOneOf` fix logic — code read

Checked `packages/local-agent/src/mcp-bridge.ts:89-173`. The helper correctly handles
every compound shape declared by chrome-devtools-mcp:

- Early-exits for: non-object input (returns safe default `{ type: "object", properties: {} }`),
  missing `properties`, more than one top-level property, non-object wrapper schema,
  missing or empty `oneOf`, any variant that isn't a proper object with
  `properties.command.const: string` (lines 90-113).
- Hoists per-variant properties via a fresh shallow clone, stripping `description` before
  cloning and then re-attaching a merged description string (lines 133-149).
- The wrapper property is dropped — the flattened schema's `properties` contain only
  `command` + hoisted fields (lines 151-157).
- The helper **does not mutate** its input. The short-circuit branches return
  `inputSchema` by reference, but never write to it; the happy path builds new objects.
  Verified by inspection of every `return` path.
- `$schema` and top-level `description` are preserved when present (lines 164-171).
- Nested `anyOf` elsewhere (e.g. `select.option.anyOf`) is never touched because the
  helper only inspects the single-wrapper-property-with-`oneOf` pattern.

Critical ordering check (team-lead's explicit concern): `mcp-bridge.ts:201` calls
`detectWrapperKey(tool.inputSchema)` BEFORE `mcp-bridge.ts:206` calls
`flattenOneOf(tool.inputSchema)`. Both take the original schema. Since `flattenOneOf` also
does not mutate, the ordering is safe either way, but the existing ordering and the
explanatory comment at line 198 document the intent clearly. Call-time re-wrap in
`callTool` (lines 235-240) is therefore correctly receiving `"action"` and rebuilding
`{ action: { command, ... } }` for the MCP server.

### 2. Unit test quality

File: `packages/local-agent/tests/flatten-one-of.test.ts` — 15 `it(...)` blocks
(confirmed by `grep -c`). Seed prompt's "15 cases claimed" checks out.

Breakdown:

- **Compound tools** (3): `interact`, `observe`, `trace` — each asserts `type: "object"`,
  `required: ["command"]`, **no** residual `oneOf` anywhere in the flattened output (deep
  recursive walk via `containsOneOfDeep`), full set of discriminator `const` values present
  in the command enum, every expected hoisted field exists, and the `action` wrapper
  property is removed.
- **Flat tools** (5 pass-through + 1 nested-anyOf): `click`, `fill`, `hover`, `select`,
  `wait_for` each assert `===` reference equality (i.e. the helper returned the *exact*
  same object, proving no accidental transform); the extra nested-`anyOf` test pins
  `select.option.anyOf` surviving intact.
- **`detectWrapperKey` lock-in** (2): one asserts `"action"` for all 3 compound tools
  (the highest-risk interaction — if detection regresses, call-time auto-wrap silently
  breaks and MCP calls get "command required" errors); one asserts `undefined` for flat
  tools.
- **Edge cases** (4): non-object input returns the safe default; schema without `oneOf`
  returns the same reference; variants whose discriminator isn't literally named
  `command` (e.g. `kind`) pass through unchanged — pinning the "only the specific pattern
  is rewritten" contract; description merging produces `"count for x / count for y"`.

All tests are meaningful (no "function exists" placebos). The fixture
(`browser-mcp-tools.json`) is the actual listTools output captured by
`probes/list-tools.mjs`, so the suite tests the production shape, not a hand-crafted
mock.

Run output:

```
> @neuve/local-agent@0.1.0 test /Users/vinicius/code/perfagent-cli/packages/local-agent
> vp test run

 Test Files  2 passed (2)
      Tests  17 passed (17)
   Start at  21:00:12
   Duration  217ms
```

15 flatten tests + 2 in `dist-spawn.test.ts` = 17. Nothing skipped.

### 3. Scope-creep in `agent.ts` (C1)

`git show 8dd28bd7 -- packages/local-agent/src/agent.ts` — all 17 changed lines are pure
Prettier reformatting:

- Multi-line `import type { ChatCompletionMessageParam, ChatCompletionTool }` collapsed to a
  multi-line block because the single line exceeded Prettier's width budget.
- Three method signatures (`initialize`, `newSession`, `authenticate`) collapsed from
  multi-line param + return-type form to single-line form because they fit under the budget.

Zero semantic change. The commit message acknowledges this explicitly ("Incidental
formatting drift in agent.ts, ollama-client.ts, package.json picked up by `pnpm format`
during the fix."). A cleaner git history would have split this into `chore(fmt):` + the
Q9 fix itself, but the changes are inspection-safe. Minor scope finding only.

### 4. `ollama-client.ts` delta split across two commits

The seed prompt's "17 lines changed" is the sum of two commits:

- `8dd28bd7` (C1): 9 lines of Prettier drift — multi-line import types, multi-line
  `OllamaClient.complete` signature. No semantic change.
- `e693df9d` (C4): 8 lines — 1 constant value change (`DEFAULT_NUM_CTX: 32768 → 131072`)
  plus a 6-line explanatory comment and one blank line for separation.

Neither commit silently modifies any other default. `DEFAULT_MODEL`,
`DEFAULT_TEMPERATURE`, and the `@ts-expect-error` on `num_ctx` all survive unchanged.
Verified by inspection of the full post-fix file.

### 5. `package.json` delta

`git show 8dd28bd7 -- packages/local-agent/package.json` — two lines changed, both
`"type": "module"` moving from position 5 (above `bin`) to position 8 (below `bin`).
Pure `pnpm format` key ordering. **No dependency adds, no version bumps, no script
changes.** Safe.

### 6. `tool-loop.ts` delta (C3)

`git show b0ae25b1` — `tryParseJson` and `repairAndParseJson` deleted (pre-fix
lines 50-72, 23 lines); call site replaced with a direct `JSON.parse(rawArgs) as Record<string, unknown>`
plus a 6-line explanatory comment.

Critical checks:

- **Does `JSON.parse` failure get swallowed?** No. No `try/catch`, no `.catch`, no
  `Effect.catchAll`. A `SyntaxError` propagates up out of `runToolLoop`'s `async`
  function and rejects the promise — exactly what the commit message claims and what
  CLAUDE.md demands ("Never Swallow Errors", "Unrecoverable Errors Must Defect"). The
  earlier best-effort `return {}` fallback would have tripped the downstream
  `DOOM_LOOP_THRESHOLD` detector with garbage args-hashes — removing it improves signal
  quality in the eval harness.
- **Does the removed code have other callers?** Grep of `packages/local-agent` — no other
  references to `repairAndParseJson` or `tryParseJson`. Safe to delete.
- **Does the removal alter observable behavior when Ollama emits well-formed tool-calls?**
  No. `JSON.parse` on a valid JSON string returns the same object the regex fallback
  would have returned via its `tryParseJson(direct)` fast path.

### 7. End-to-end probe re-run

Ollama reachable on `localhost:11434` (`gemma4:e4b` present), `apps/cli/dist/browser-mcp.js`
present. Probe output:

```
$ node docs/handover/q9-tool-call-gap/probes/probe-b-post-fix.mjs
request: 8 tools (oneOf flattened), system=1936 chars, user="Start by navigating to the MDN Web Docs page for JavaScript."
---
HTTP 200
finish_reason: tool_calls
tool_calls count: 1
  → interact({"command":"navigate","url":"https://developer.mozilla.org/en-US/docs/Web/JavaScript"})
content.length: 0
---
VERDICT: Gemma emitted tool calls ✓ (Q9 flatten fix works end-to-end)
```

**The fix works.** Expected signature match: `finish_reason: "tool_calls"`,
`tool_calls.length >= 1`, content empty, the emitted call carries exactly the
`{command, url}` shape the LLM derived from the flattened schema (and `detectWrapperKey`
at call time would rewrap it into `{action: {command, url}}` for the MCP server — not
exercised by this probe but covered by the unit test).

**Probe-helper ↔ production-helper drift check.** Diff-by-inspection of the probe's
inline `flattenOneOf` (probe-b-post-fix.mjs:24-93) vs. production
(mcp-bridge.ts:89-173):

- `isObject` guard — same predicate.
- Every early-return short-circuit is present in both (non-object input, missing
  properties, ≠ 1 keys, no oneOf / empty oneOf, malformed variants).
- Hoisting loop — same structure: skip `command`, clone + strip description on first
  sighting, accumulate descriptions, deduplicate by `includes`, merge with `" / "`.
- Output construction — same keys (`type`, `properties`, `required`), `$schema` and
  top-level `description` propagated only when strings.

The probe's JS port is a faithful transliteration of the TS production helper. Probe
running green against the production-generated `listTools()` output is therefore valid
evidence that the ship helper works on the real schemas. Drift risk is real but low; the
unit test is the authoritative contract and would catch a future production regression
before the probe would.

### 8. `detectWrapperKey` lock-in test

`flatten-one-of.test.ts:242-252`:

```ts
it("still detects `action` as the wrapper for the 3 compound tools", () => {
  for (const toolName of ["interact", "observe", "trace"]) {
    const parameters = getParameters(toolName);
    assert.strictEqual(
      detectWrapperKey(parameters),
      "action",
      ...
    );
  }
});
```

The fixture (`browser-mcp-tools.json`) is the unmodified listTools output, so this test
is calling `detectWrapperKey` with exactly the same input the production bridge hands it.
If a future change to `schemaHasCommandProperty` or `detectWrapperKey` breaks the
`"action"` detection for any compound tool, the test fails. This is the single
highest-risk interaction in the change, and it is locked in.

### 9. Typecheck + full test suite

```
$ pnpm --filter @neuve/local-agent typecheck
> @neuve/local-agent@0.1.0 typecheck
> tsgo --noEmit
(clean)

$ pnpm --filter @neuve/local-agent test
> @neuve/local-agent@0.1.0 test
> vp test run

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

No failures, no skips.

### 10. Commit hygiene

- No `Co-Authored-By` footers on any of C1..C5.
- One logical commit per task in the diary:
  - T1 flatten helper + unit test → C1 `8dd28bd7`
  - T2 probe-b-post-fix end-to-end verification → C2 `60e4b063`
  - T3 drop `repairAndParseJson` → C3 `b0ae25b1`
  - T4 bump `DEFAULT_NUM_CTX` → C4 `e693df9d`
  - T5 docs (diagnosis, diary, probe index) → C5 `cf6e565e`
- Commit messages are descriptive and explain the "why", not just the "what". C1's
  message includes the full shape rewrite contract. C3's message cites the downstream
  failure-recording rationale. C4's message flags the "orthogonal but co-located"
  nature of the bump so a future reader doesn't expect it to be causal.
- No `--no-verify` or `--amend`.

## Findings

- [MINOR] (packages/local-agent/src/agent.ts, packages/local-agent/src/ollama-client.ts, packages/local-agent/package.json, C1 `8dd28bd7`) — Formatting drift folded into the fix commit rather than split into a preceding `chore(fmt):`. Each change is inspection-safe (pure Prettier re-layout, key reorder, no semantic change), the commit body discloses it, and I was able to verify each line visually in under a minute. Not blocking; future refactors should split drift.

- [MINOR] (packages/local-agent/src/tool-loop.ts:141) — `JSON.parse(rawArgs) as Record<string, unknown>` uses an `as` cast. CLAUDE.md says "No type casts (`as`) unless unavoidable." `JSON.parse` returns `any`, so the cast is idiomatic, but a strict reading of the rule would prefer `Schema.decodeEffect` or a `Predicate.isRecord` narrowing. Given this file is plain async/await (not Effect-wrapped) and the downstream `mcpBridge.callTool` already accepts `Record<string, unknown>`, the cost of a refactor outweighs the purity benefit. Accept.

- [MINOR] (packages/local-agent/tests/flatten-one-of.test.ts:104-126) — The test asserts `text` is present as a hoisted property on the flattened `interact` schema, but does not assert which variant's type wins in the `type.text: string` vs `wait_for.text: array` collision. First-seen wins by construction (the diary documents this as acceptable and the MCP server tolerates unknown fields), but a future reorder of the variants in chrome-devtools-mcp would silently flip the hoisted type without a test failure. Not blocking — tolerable per the diagnosis — but if chrome-devtools-mcp ever reorders its `oneOf`, this test won't catch it.

- [MINOR] (docs/handover/q9-tool-call-gap/probes/probe-b-post-fix.mjs:28-93) — The `flattenOneOf` helper is duplicated inline rather than imported from `@neuve/local-agent`. The diary explicitly documents this trade-off (the package ships a single bundled binary, no individually importable helper; adding `tsx`/`jiti` for one probe was rejected). Drift risk is real but low: the unit test is the authoritative contract and would fire before a probe re-run would. Consider exporting `flattenOneOf` from a small helpers entrypoint that the probe can `import` without spinning up a TS loader — future work, not blocking.

- [INFO] (packages/local-agent/src/ollama-client.ts:16, C4 `e693df9d`) — `DEFAULT_NUM_CTX` bumped 32768 → 131072. On Gemma 4 E4B Q4_K_M this is ~4× KV-cache allocation; first-token latency and peak RAM both go up. The commit message's operational note is accurate; keep an eye on the re-baseline run for latency deltas that might force revising this constant back down if they exceed the cache-miss cost.

- [INFO] (docs/handover/q9-tool-call-gap/probes/probe-b-post-fix.mjs:173) — Probe hardcodes `num_ctx: 32768` even though production is now 131072. Not a defect (the probe is about verifying the flatten transform, not context-window sizing), but a reader comparing probe vs. production behavior might be confused. Consider aligning or adding a comment.

## Suggestions (non-blocking)

- Export `flattenOneOf` from a standalone module that the probe can import without a TS
  loader, eliminating the drift-risk caveat in the diary entirely. E.g. factor the helper
  into `packages/local-agent/src/flatten-one-of.ts` and re-export from `mcp-bridge.ts`;
  the probe becomes `import { flattenOneOf } from "../../../../packages/local-agent/src/flatten-one-of.js";`
  once the package builds or runs via node's native TS support.

- Lock the "first-seen wins on prop-name collisions" contract with a dedicated test case
  (e.g. a synthetic schema where `type.text` is `string` and `wait_for.text` is `array` in
  that specific order) so chrome-devtools-mcp variant reordering can't silently flip the
  hoisted schema shape.

- Consider splitting future formatting drift into preceding `chore(fmt):` commits for
  cleaner git log narrative, per the existing team convention.
