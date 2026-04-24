# Review: Wave 5 — Distillation pipeline (Round 2)

## Verdict: APPROVE

All 2 Critical and all 5 Major findings from Round 1 are resolved. Regression tests added for each. Team-lead's cross-finding claim — that dropping `MESSAGE tool` (C2 fix) was simultaneously the root cause of the empty-response bug (M3) — is verified end-to-end.

---

## Verification executed

- `pnpm --filter @neuve/evals test` — **117 passing** (twice; deterministic across two runs). 95 prior + 22 new/regression.
- `pnpm --filter @neuve/evals typecheck` — green.
- `pnpm --filter @neuve/evals format:check` — green (engineer's claim verified — this was lint-only failing before, formatter now passes).
- `pnpm typecheck` (repo-wide) — only pre-existing `@neuve/sdk` playwright failure; zero impact from Wave 5 files.
- `pnpm --filter @neuve/evals distill:export` against synthetic example dir — 2/2 accepted, 7289-byte JSONL.
- `pnpm --filter @neuve/evals distill:build-modelfile` — 3441 bytes. `diff` against committed `data/distill/examples/Modelfile` (3476 bytes) — only the `# Source JSONL:` header comment differs (local path vs tmp path, expected). Byte-identical otherwise.
- `pnpm --filter @neuve/evals distill:smoke-finetune` end-to-end — **responseLength: 2, responsePreview: "ok"**. Cleanup verified (`ollama list` post-run shows no `perfagent-smoke-*`).
- Edge probe of `isTraceSuccessful` with 5 crafted sequences — all produce the expected verdict (details below).

---

## Critical re-verification

### C1 — aborted traces rejected ✓

**File:** `packages/evals/src/distill/filters.ts:9-51`

`hasAssertionAbort` walks all events, flags any `ASSERTION_FAILED` with `payload[2] === "abort"`. `isTraceSuccessful` short-circuits on it before checking the `RUN_COMPLETED` marker.

Crafted probe (`tsx /tmp/test-filter-edge-r2.ts`):

| Scenario | Expected | Actual |
|---|---|---|
| `ASSERTION_FAILED abort` → `RUN_COMPLETED passed` | `false` | `false` ✓ |
| `RUN_COMPLETED passed` → later `ASSERTION_FAILED abort` | `false` | `false` ✓ |
| `ASSERTION_FAILED budget-violation` (non-abort) → `RUN_COMPLETED passed` | `true` | `true` ✓ |
| Clean `RUN_COMPLETED passed` | `true` | `true` ✓ |
| Clean `RUN_COMPLETED failed` | `false` | `false` ✓ |

Unit test coverage at `tests/teacher-data-exporter.test.ts:127-169` — one test, three assertions covering the three abort shapes (before-abort, after-abort, non-abort-category). Terminology nit: the team-lead brief said "3 new unit tests", engineer delivered "1 test with 3 assertions". Same coverage, different structure. Non-blocking.

### C2 — `MESSAGE tool` rejected ✓

**File:** `packages/evals/src/distill/modelfile-builder.ts:47-48, 105-112`

- `MODELFILE_MESSAGE_ROLES = ["system", "user", "assistant"] as const` — `"tool"` is NOT in the union.
- `ModelfileMessageRole` type narrows the `MessageEntry.role` field at compile time.
- `validateMessageRole` runtime-checks and throws `ModelfileBuilderError` with a clear `MESSAGE role must be one of system|user|assistant: got "tool"` message.
- Test `modelfile-builder.test.ts:88-103` asserts BOTH: the const excludes `"tool"` AND the runtime throws when the type is cast away.

**Message converter** (`src/distill/modelfile-messages.ts:1-55`):
- Tool messages get inlined into the preceding assistant turn as `<tool_result id="${toolCallId}">${content}</tool_result>`. `toolCallId` association: `result[result.length - 1]` is the preceding turn; if it's an assistant, inline; otherwise create a new assistant with just the tool block (fallback for ill-formed trajectories — doesn't trigger on well-formed OpenAI-chat data).
- System messages dropped (M4 fix — see below).
- Assistant tool_calls appended as `<tool_calls>...</tool_calls>` so the few-shot teaches Gemma the emission shape.

**Committed Modelfile check:**
- `grep -c "^MESSAGE tool " Modelfile` → **0** ✓
- `grep -c "^SYSTEM " Modelfile` → **1** ✓
- `grep -c "^MESSAGE system " Modelfile` → **0** ✓

The `<tool_result>` inlining convention is not part of Ollama's standard Modelfile grammar, but Ollama's `MESSAGE` directive accepts arbitrary text content inside the triple-quote heredoc. The convention Gemma sees at serve time is consistent with the teacher's emission shape on the wire (OpenAI-style tool_calls serialize as JSON) — this is the engineer's pragmatic choice and it's internally consistent across the pipeline. Non-idiomatic for Ollama docs but harmless: the text is semantically rich for the student to learn from, and training frameworks ingest the JSONL directly anyway (not the Modelfile MESSAGE turns).

---

## Major re-verification

### M1 — REDACTED_KEY_PATTERN centralized ✓

- `packages/evals/src/redaction.ts:12` — single `export const REDACTED_KEY_PATTERN = /api[_-]?key|token|password|secret|authorization/i;`.
- `packages/evals/src/distill/filters.ts:2` — `import { REDACTED_KEY_PATTERN } from "../redaction"` + re-export for callers.
- `packages/evals/src/runners/trajectory-summary.ts:2` — imports from `../redaction` (was a local `const` before; `git diff HEAD~10 HEAD` confirms pure import-for-const swap, zero behavioral change).
- Grep for declaration: `REDACTED_KEY_PATTERN\s*=` returns exactly 1 hit — `redaction.ts:12`. ✓

### M2 — tagged errors in smoke-finetune ✓

**File:** `packages/evals/scripts/distill/smoke-finetune.ts:46-102`

Six `Schema.ErrorClass` errors declared, each with `_tag: Schema.tag(...)` and `message` as class field derived from data:
- `OllamaUnavailableError`, `OllamaBaseModelMissingError`, `SmokeSampleMissingError`
- `OllamaCreateFailedError`, `OllamaGenerateFailedError`, `OllamaEmptyResponseError`

Error paths (`:191, 196, 201, 246, 291`) use `return yield* new X(...)` — the recommended `.asEffect()`-equivalent pattern per CLAUDE.md. Zero `Effect.fail(new Error(...))` remaining.

One `throw new Error(...)` at `:278` — inside the `fetch` try-callback, caught by the surrounding `Effect.tryPromise({ catch: ... })` and wrapped into `OllamaGenerateFailedError`. The raw `Error` never escapes Effect's error channel. Acceptable.

**`Effect.acquireRelease` for lifecycle:**
- `:163-173` temp-dir acquire + best-effort rmSync release.
- `:234-263` smoke-model acquire (runs `ollama create`) + release (runs `ollama rm` with `Effect.ignore` to avoid death on cleanup failure).

Both release branches run on Scope close including failure paths. The `Effect.scoped(program)` at `:315` ties the scope to the program. ✓

### M3 — empty-response gate ✓

**File:** `packages/evals/scripts/distill/smoke-finetune.ts:289-292`

```ts
const responseText = generateResponse.response.trim();
if (responseText.length === 0) {
  return yield* new OllamaEmptyResponseError({ smokeModel });
}
```

`OllamaEmptyResponseError` message surfaces actionable debug context: "Likely causes: Modelfile integration bug, chat template mismatch, or base model failure to load."

**End-to-end verification this run:**
```
[09:21:50.086] Smoke model responded { responseLength: 2, responsePreview: 'ok' }
```

Previously `""`. Non-empty now. Team-lead's cross-finding claim verified — the C2 fix (dropping invalid `MESSAGE tool` lines) was indeed the mechanism that fixed the empty-response symptom. One root cause, two symptoms → single fix.

### M4 — Modelfile system-prompt de-duplication ✓

**Implementation:** `modelfile-messages.ts:31` — `if (message.role === "system") continue;`.

**Artifact check** (`data/distill/examples/Modelfile`):
- File size: **3476 bytes** (was 5406 — engineer claimed 3468; ±8 byte variance due to revised header comment in the regenerated artifact).
- `SYSTEM` directive count: **1** ✓
- `MESSAGE system` count: **0** ✓

Regression test at `modelfile-builder.test.ts:159-173` asserts exactly-one SYSTEM + zero MESSAGE-system via regex on the generated output.

### M5 — formatter drift disclosure ✓

Commit `137feb09 chore(evals): revert pre-existing formatter drift` carries the whitespace normalization as a separate isolated commit. Commit body documents rationale: attempting to revert the drift fails the current `vp fmt --check` gate, so carrying it forward is the pragmatic path. `git diff HEAD~10 HEAD -- [three files] --ignore-all-space` is empty — pure whitespace, zero logic.

Technically this is carrying the drift forward rather than reverting it (a reviewer reading the commit title might expect a revert). But the commit body is explicit about the reasoning and the alternative (a full format:check regeneration across the package) is larger than the Wave 5 scope warrants. Acceptable.

---

## Mini-fixes (Round 1 m1, m2) — side-note verification

**m1** — Schema-decoded `/api/generate` response via `OllamaGenerateResponse = Schema.Struct({ response: Schema.String })` at `smoke-finetune.ts:115-118, 280`. Decoded via `Schema.decodeUnknownSync` — `as { response?: string }` cast gone. ✓

**m2** — Redundant `JSON.parse as unknown` cast at `exporter.ts:51` removed (engineer's claim). The Round 1 review flagged three sites with this cast; the exporter parseTraceFile `jsonParseEffect` is the one that was cleaned up. Three other `as unknown` casts remain at `filters.ts:100`, `exporter.ts:174,188` — those are inside try-blocks where `JSON.parse` returns `any` and the cast narrows to `unknown` before passing to redaction. These are defensive narrowings, not functional casts, and CLAUDE.md's "no type casts unless unavoidable" does carve out narrowing. Non-blocking.

---

## Scope hygiene ✓

`git diff HEAD~10 HEAD --name-only` enumerates 25 files. All fall into exactly one of:
- `packages/evals/src/distill/**` (new)
- `packages/evals/scripts/distill/**` (new)
- `packages/evals/data/distill/**` (new fixtures)
- `packages/evals/tests/*.test.ts` (new or formatter-drift only)
- `packages/evals/src/redaction.ts` (new, single-purpose)
- `packages/evals/src/runners/trajectory-summary.ts` (import-only change — verified via targeted diff)
- `packages/evals/src/scorers/final-state.ts` (formatter-drift only — commit 137feb09)
- `packages/evals/package.json` (scripts + deps)
- `.gitignore` (distill out dir)
- `docs/handover/harness-evals/**` (diary + R1 review record)

No surprise files outside `packages/evals/`. No runner behavioral changes. No changes to scorers, adapters, `packages/local-agent/`, `packages/browser/`, `packages/supervisor/`, `packages/shared/`, `apps/`. ✓

---

## Findings

None at Critical or Major severity. 

### Suggestions (non-blocking; for future maintenance)

- **Modelfile integration convention undocumented upstream.** The `<tool_result id="...">` and `<tool_calls>...` inlining convention works because Ollama's `MESSAGE` content is just text, and the training framework (axolotl/unsloth) consumes the JSONL directly rather than the Modelfile's MESSAGE chain. But a future maintainer unfamiliar with this pipeline might see `MESSAGE assistant "...<tool_result>..."` in the Modelfile and be confused. Consider adding a short `# ` header comment in the generated Modelfile explaining the convention.
- **One test-with-three-assertions vs three-tests.** Minor terminology difference from the brief. Either shape verifies the same contract; no action needed.
- **Three narrowing `as unknown` casts remain** in `filters.ts`, `exporter.ts`. Defensive narrowings after `JSON.parse`. Could be replaced with `Schema.parseJson`/`Schema.decodeEffect` for rigor, but the current sites either fall back to the original string on parse failure (redaction helpers) or route into structured error types downstream. Low value to churn.

---

## Exit criteria met

1. All mandatory verification commands pass (see Verification section). ✓
2. All Critical + Major findings from Round 1 resolved. ✓
3. Engineer's diary claims independently verified against code + artifacts + runtime behavior. ✓
4. DoD behavior demonstrated end-to-end — `distill:export` produces JSONL, `distill:build-modelfile` produces a valid Modelfile, `distill:smoke-finetune` creates + prompts + cleans up a live model on Ollama with a non-empty response. ✓
5. Sibling-code checklist: `REDACTED_KEY_PATTERN` centralized; no duplicate declarations remain. ✓

**Verdict: APPROVE.** Wave 5 infrastructure is ready to accept successful teacher traces from future harness improvements.
