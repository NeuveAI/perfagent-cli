# Review: Post-Compact 1 — ACP ToolCall encoding + URL extraction fix (Round 1)

**Reviewer:** `reviewer` (team `real-runner-encoding`)
**Tasks under review:** #1 (investigate) + #2 (fix) by `encoding-eng`
**Diary:** `docs/handover/harness-evals/diary/post-compact-1-encoding-fix.md`
**Files changed (working tree):**
- `packages/shared/src/models.ts` (+62/-4)
- `packages/evals/tests/real-runner.test.ts` (+122/-0)
- `packages/evals/evalite.config.ts` (+1/-1) **← not disclosed in diary**
- `docs/handover/harness-evals/diary/post-compact-1-encoding-fix.md` (new)

## Verdict: REQUEST_CHANGES

Two merge-blocking issues: a format-check failure the engineer introduced in `models.ts:1047`, and an undisclosed out-of-scope change to `evalite.config.ts` (testTimeout 30s → 600s). The encoding logic itself is sound; tests faithfully represent the Gemini wire format; Claude path is not regressed; sibling code scan is clean. Fix the two blockers and this is ready.

## Verification executed

| Command | Outcome |
|---|---|
| `git diff --stat && git status` | **3 tracked files modified** (not 2 as implied by diary) + diary. Scope drift detected: `packages/evals/evalite.config.ts` was touched. |
| `pnpm --filter @neuve/shared typecheck` | ✅ green |
| `pnpm --filter @neuve/evals typecheck` | ✅ green |
| `pnpm --filter @neuve/shared test` | ✅ 118/118 |
| `pnpm --filter @neuve/evals test` (run 1) | ✅ 119/119 |
| `pnpm --filter @neuve/evals test` (run 2, determinism) | ✅ 119/119 — deterministic |
| `pnpm check` repo-wide | ❌ **FAIL** — `@neuve/shared:check` reports format issues in 7 files. `models.ts:1047` is **new** drift introduced by this PR (confirmed by reformatting engineer's file in a temp location; HEAD's models.ts passes format check, engineer's does not). The other 6 files are pre-existing formatter drift (same pattern as commit `137feb09`). |
| `pnpm --filter @neuve/shared check --no-lint src/models.ts` on HEAD version | ✅ pass |
| `pnpm --filter @neuve/shared check --no-lint src/models.ts` on engineer version | ❌ fail (line 1047 too long) |
| Diff-only verification of post-fix traces (`traces/*.after-fix-gemini`, `*.after-fix-claude`) | Gemini: `args` now carries decoded JSON, `result` carries MCP text array, URL matches expected pattern. Claude: tool names remain `ToolSearch`/`mcp__browser__interact`, rawOutput path preserved — no regression. |

**Did NOT re-run live smoke** (`EVAL_RUNNER=real EVAL_BACKEND=…`). Rationale: the diary reports smoke durations of ~122s (gemini) and ~240s (claude), and the saved post-fix traces show the expected shapes post-decode. Re-running would consume two live model budgets without further signal because the unit-level recovery paths are already locked in by the two new tests (`real-runner.test.ts:546-601` and `:603-656`) which use the same wire-format fixtures as live traces. If re-validation is required before merge, please say so explicitly and I will run both backends.

## Findings

### [MAJOR] `pnpm check` fails because engineer introduced a format violation — `packages/shared/src/models.ts:1047`

The line
```ts
if (update.rawOutput !== undefined || (update.content !== undefined && update.content !== null && update.content.length > 0)) {
```
is 114 characters long and `vp fmt` wants to break it onto four lines. I verified this is **new drift introduced by this PR**: I copied the engineer's file to a temp location, ran `pnpm exec vp fmt --write` against it, and diffed — the only change was reformatting this one conditional at line 1047. I then reverted the engineer's models.ts to HEAD (using `cp`, not `git checkout`, to be safe) and confirmed HEAD passes format on its own.

Why it matters: the reviewer contract (`docs/handover/harness-evals/review-system-prompt.md` line 19) requires `pnpm check` to pass before APPROVE. The other six `@neuve/shared` files that fail format check are pre-existing drift (same category as `packages/evals/src/scorers/final-state.ts` in commit `137feb09`) — the engineer is not responsible for those, but **they are responsible for not adding a seventh**.

**Fix:** run `pnpm --filter @neuve/shared exec vp check src/models.ts --fix` (or equivalently reformat the conditional as the formatter requests — break after `||` and wrap the inner `&&` chain).

### [MAJOR] Undisclosed scope change — `packages/evals/evalite.config.ts:5`

`testTimeout` bumped from 30_000 to 600_000 (10× increase). The diary's "Files changed" section at lines 274-278 lists only `packages/shared/src/models.ts` and `packages/evals/tests/real-runner.test.ts`. The config change is **not disclosed anywhere in the diary**.

Plausible motivation: the live evalite smoke runs take 122s–240s and would have timed out at the default 30s. That motivation is defensible on its own, but committing a 10× testTimeout increase permanently into the shared evalite config without disclosing it (and without discussing whether the eval suite should inherit that timeout long-term) is out-of-scope scope drift. The team lead's orchestration prompt explicitly flagged this file: "If they did, it's a scope violation = MAJOR."

**Fix:** either (a) revert `evalite.config.ts` and use an environment-variable override or a per-run flag for live smokes; (b) split this into a separate disclosed chore commit with rationale ("live real-runner evals need a longer default testTimeout than mock evals"); or (c) land it inside this PR but document the change + rationale in the diary's "Files changed" section. Don't smuggle infrastructure changes inside feature fixes.

### [MINOR] `deriveToolCallResult` fallback still returns the literal string `"undefined"` — `packages/shared/src/models.ts:779`

```ts
const deriveToolCallResult = (update: AcpToolCallUpdate): string => {
  if (update.rawOutput !== undefined) {
    return serializeToolResult(update.rawOutput);
  }
  if (update.content !== undefined && update.content !== null && update.content.length > 0) {
    return serializeToolResult(unwrapToolCallContent(update.content));
  }
  return serializeToolResult(update.rawOutput);  // ← update.rawOutput is undefined here
};
```

When both `rawOutput` is absent **and** `content` is absent/null/empty, line 779 falls through to `serializeToolResult(undefined)` which returns the literal string `"undefined"` — the exact bug this PR exists to fix, now narrowed to a degenerate edge case. Pre-fix behaviour in this branch was identical, so this is not a regression, but it is incomplete hygiene and an easy footgun for a future Gemini tool that legitimately returns no output (status=completed, content=[]). `url-extraction.ts` would then scan the string `"undefined"` and find no URL — correct behaviour here, but the trace row would still literally say `result: "undefined"`.

**Fix:** replace line 779 with `return "";` (or `return "[]"` to match the content-array shape contract the rest of the file emits). Either is more honest than `"undefined"`.

### [MINOR] `deriveToolCallInput` is eagerly computed in tool_call_update handler — `packages/shared/src/models.ts:1016`

```ts
if (update.sessionUpdate === "tool_call_update") {
  let base: ExecutedPerfPlan | undefined;

  const updatedInput = deriveToolCallInput(update);   // ← computed unconditionally
  if (update.rawInput !== undefined) {                // ← used only when this is true
    // …mutates ToolCall with updatedInput…
  }
```

`updatedInput` is only consumed inside the `rawInput !== undefined` branch. For every Gemini tool_call_update (which has `rawInput === undefined` in the common case), this does a pointless JSON-stringify + JSON-parse round trip (via `deriveToolCallInput` → `decodeStructuredToolInput` when `title` is present). Minor — not a correctness issue — but move the `const updatedInput = …` inside the branch or inline the call.

### [MINOR] Engineer did not run `pnpm check` before declaring feature-complete

Diary's "Verification" section (lines 192-197) lists:
- `pnpm --filter @neuve/shared typecheck`
- `pnpm --filter @neuve/evals typecheck`
- `pnpm --filter @neuve/shared test`
- `pnpm --filter @neuve/evals test`

…but not `pnpm check`. The format violation in `models.ts:1047` would have been caught by that single command. Per the project's CLAUDE.md "Verify changes" section, `pnpm check` is the canonical pre-merge gate. Recording verification gaps matters because the orchestrator's trust in the engineer's claims scales with how complete their verification is.

### [INFO] Diary's "one fix, one surface" claim is only half-true for the production path — `packages/supervisor/src/reporter.ts:72-83`

Diary lines 164-169 claim:
> The production CLI's `reporter.ts` already uses `event.input` to pull navigation URLs out of tool calls — Gemini users hitting that code path would have previously seen empty insights too. One fix, one surface.

The first clause is correct: `reporter.ts:342` calls `extractNavigationUrl(event.input)`. But `extractNavigationUrl` (line 72) only decodes two shapes:

```ts
const topUrl = decoded["url"];                      // {url: "..."} — top-level
if (command === "navigate") {                       // {command: "navigate", url: "..."} — top-level
  const nestedUrl = decoded["url"];
  // …
}
```

It does **not** recognize chrome-devtools-mcp's `{action: {command: "navigate", url: "..."}}` nested shape — which is exactly the payload Gemini puts in `title`. So even post-fix, a Gemini user running the production CLI with chrome-devtools-mcp still gets no navigation URL extracted by the reporter's production path. The eval's `url-extraction.ts` (which *does* handle the nested action shape, see `InputShape` at line 49-52) benefits from the fix; the production reporter does not. Not a regression, not a blocker, but the diary's "one fix, one surface" framing overstates the blast-radius benefit. Worth either (a) downgrading the claim in the diary, or (b) filing a follow-up task to extend `extractNavigationUrl` to decode the nested action shape.

### [INFO] `Predicate.isObject` excludes arrays — `packages/shared/src/models.ts:743`

```ts
if (Option.isSome(decoded) && Predicate.isObject(decoded.value)) {
  return JSON.stringify(decoded.value);
}
```

Per Effect v4, `Predicate.isObject` = plain object only (rejects arrays and `null`). If any ACP adapter ever puts a top-level JSON array in `title` (Gemini CLI's chrome-devtools-mcp invocations don't, but this is an unknown-unknown), the fallback will drop it and return `"{}"`. Consider `Predicate.isObjectOrArray` if the extraction layer can handle arrays, or at minimum document the assumption (comment or a named constant) that `title` encodes objects only.

### [INFO] Out-of-scope task #4 is legitimately out of scope — `packages/agent/src/acp-client.ts:681-690`

Confirmed: the `requestPermission` handler returns a canned `selected` outcome without enqueuing a synthetic `tool_call` sessionUpdate. `params` contains the tool call info (title, rawInput, etc.) but nothing propagates to `updatesQueue`. Visible in `traces/real__calibration-1-…after-fix-gemini.ndjson` line 2: a `tool_result` for `tc-000` appears before any `tool_call`. The same `tc-000` is then reused for the subsequent `snapshot` tool_call (collision caused by `real.ts:189` `padToolCallId(Math.max(0, acc.toolCallIndex - 1))` defaulting to `tc-000` when no prior tool_call has been recorded). This is a real bug but it's **pre-existing** and the encoding fix does not introduce it. Filing as team task #4 is appropriate.

## Antagonistic focus — answers to the ten probes

1. **Schema decode safety on real Gemini payloads?** Verified. The test fixtures at `real-runner.test.ts:557-577` and `:618-638` construct `AcpToolCall`/`AcpToolCallUpdate` instances with exactly the shape `node_modules/.pnpm/@google+gemini-cli@0.35.3/dist/src/acp/acpClient.js:654-672` emits (`title = JSON.stringify(invocation.getDescription())`, no rawInput, content wrapped as `{type:"content", content:{type:"text", text:"…"}}`). `Schema.fromJsonString(Schema.Unknown)` + `Predicate.isObject` gracefully rejects non-object JSON (primitives, arrays, `null`) and returns `{}`. Decode does not leak schema errors — `decodeUnknownOption` swallows into `Option.none()`. No garbage acceptance observed.
2. **Effect rules compliance?** `grep "\bas [A-Z]"` in models.ts returns only `as const` literal narrowing — no type casts introduced. No new `null` returns. No `catchAll`. `Predicate.isObject` used (not custom type guard). `Schema.fromJsonString` used (not manual JSON.parse). One minor deviation: `typeof title === "string"` on line 741 is a manual property check, but it's defensive against AcpToolCallUpdate's `Schema.optional(Schema.NullOr(Schema.String))` title which the type system says is `string | null | undefined` — the check is correct and the project's own Effect guide does allow `typeof` narrowing for simple string checks.
3. **Sibling-code parity?** Scanned `packages/evals/src/runners/{mock,real,gemma,trace-recorder,trajectory-summary,url-extraction}.ts` and `packages/agent/`, `packages/supervisor/`, `packages/local-agent/`. Findings:
   - Mock runner builds synthetic `ToolCall` objects directly — no addEvent pattern, not affected.
   - `local-agent/src/tool-loop.ts:146-270` emits its own `tool_call`/`tool_call_update` session updates with **both** `rawInput` and `rawOutput` populated (Claude-shape). Not affected.
   - `supervisor/src/reporter.ts:72-83` has a related-but-separate decoder that doesn't understand the nested-action shape — flagged as [INFO] above, but predates this PR.
   - Only `packages/shared/src/models.ts` `addEvent` is the canonical consumer of ACP `sessionUpdate` events; the diary's "one issue, one file" claim is correct for the decode surface.
4. **URL-extraction parity for content-fallback?** Verified by reading `packages/evals/src/runners/url-extraction.ts`. `unwrapToolCallContent` at `models.ts:758-770` projects `{type:"content", content:{type:"text", text:"..."}}` → `{type:"text", text:"..."}`. This matches exactly what `urlFromContentArray` (url-extraction.ts:103-111) + `decodeTextContent` (url-extraction.ts:54) expects (`{type:"text", text:string}`). The "bare content array" code path (url-extraction.ts:148-151) handles this shape. Tests confirm it end-to-end — `real-runner.test.ts:653-655` asserts `reachedKeyNodes.length === 1` and `finalUrl === "https://example.com/"` for a content-only Gemini update.
5. **Synthetic fixture lock-in?** No. The test fixtures reproduce the real Gemini wire format (verified against `acpClient.js:654-672`). Text patterns match chrome-devtools-mcp's formatter output (verified against comments in url-extraction.ts:4-11 that cite `pages.js:179`, `SnapshotFormatter.js:52`). Not overfit.
6. **Other call sites?** None. `serializeToolResult` is called only from within `models.ts`. `rawInput`/`rawOutput` production call sites (`local-agent/src/tool-loop.ts`) populate both fields in Claude-shape — not consumers of this decode path.
7. **Pass-through bug tests?** `grep '"undefined"\|serializeToolResult.*undefined'` finds no tests that were passing because they asserted on the broken `"undefined"` / `"{}"` encoding. Safe.
8. **Test determinism?** New tests in `real-runner.test.ts:546-656` use entirely in-memory fixtures — they construct `AcpToolCall`/`AcpToolCallUpdate` via `new` and run the accumulator end-to-end. No live-agent hits. Ran `pnpm --filter @neuve/evals test` twice: both 119/119 green, same duration range. Deterministic.
9. **Task #4 out-of-scope?** Yes, verified at `packages/agent/src/acp-client.ts:681-690`. Permission handler synthesizes only an outcome, never a session update. Filing as follow-up is correct.
10. **`testTimeout` note in evalite.config.ts?** Engineer **did** modify it (30_000 → 600_000) despite the orchestration instruction flagging this as out-of-scope. See [MAJOR] above.

## Suggestions (non-blocking)

- Consider adding a `// safe: title is always a JSON object for chrome-devtools-mcp invocations` comment above `Predicate.isObject` to document the narrow assumption.
- Consider exporting `deriveToolCallInput` / `deriveToolCallResult` so downstream replay tools (`trace-recorder.ts`) can reuse them without re-deriving the logic.
- The diary would be stronger with a "What this doesn't fix" section that cites the reporter.ts limitation [INFO] above — otherwise readers will assume production insights are fully restored for Gemini users.

## Re-review checklist for round 2

- [ ] `models.ts:1047` reformatted (and/or `pnpm --filter @neuve/shared check src/models.ts` passes).
- [ ] `evalite.config.ts` either reverted, split into a disclosed chore, or documented in the diary with rationale.
- [ ] `deriveToolCallResult` line 779 fallback hardened (return `""` or an empty-content-array marker, not silently `"undefined"`).
- [ ] `updatedInput` computation moved inside the `rawInput !== undefined` guard (minor).
- [ ] Diary updated with `pnpm check` verification outcome (and, ideally, acknowledging the pre-existing six-file drift if the engineer chooses not to fold in another revert-drift commit).
