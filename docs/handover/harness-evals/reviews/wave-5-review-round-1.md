# Review: Wave 5 — Distillation pipeline (Round 1)

## Verdict: REQUEST_CHANGES

This review must be antagonistic. Several findings are structurally material to the wave's stated purpose (preparing teacher data for a future Gemma LoRA fine-tune on a provisioned GPU). Approval now would ship infrastructure that looks functional but carries at least three latent defects that would corrupt training data, pass invalid grammar to Ollama, or falsely report a successful smoke.

---

## Verification executed

- `pnpm --filter @neuve/evals test` — 111 passing (twice; deterministic). Matches diary claim.
- `pnpm --filter @neuve/evals typecheck` — green.
- `pnpm typecheck` (repo-wide) — fails on `@neuve/sdk` (`Cannot find module 'playwright'`). Pre-existing; unrelated to Wave 5 (grepped distill files — zero references to the sdk). Not a blocker for this wave.
- `pnpm --filter @neuve/evals lint` — fails on `oxlint` config error (`Configuration file must wrap its default export with defineConfig() from "oxlint"`). Engineer's diary notes this as pre-existing. Confirmed — the error surfaces from repo root `vite.config.mjs`, not from any Wave 5 file.
- `pnpm --filter @neuve/evals distill:export` (default env, `evals/traces/`) — 20 traces scanned, 0 accepted, 0 samples written. Matches the diary's "20 real-runner traces all fail the isTraceSuccessful gate" claim.
- `pnpm --filter @neuve/evals distill:export` against `data/distill/examples/` — 2 accepted, 2 samples written, 7289 bytes. Matches diary.
- `pnpm --filter @neuve/evals distill:build-modelfile` with the committed sample JSONL — 5392 bytes written. `diff` against the committed `data/distill/examples/Modelfile` is empty → the committed artifact is deterministically reproducible.
- `pnpm --filter @neuve/evals distill:smoke-finetune` against Ollama + `gemma4:e4b` — completed in ~11s (create + generate + rm). `ollama list` post-run confirms `perfagent-smoke-finetune` was cleaned up. BUT — see [S1] below: `responsePreview` was `""` and the script still reported `status: ok`.
- JSONL structural validity — both committed lines parse under `jq -e '.messages | type == "array"'` and `.messages[0].role == "system"`.
- Edge-probe of `isTraceSuccessful` with synthetic events (aborted-then-passed / failed-then-passed / passed-then-failed) — see [C1].

---

## Findings

### [CRITICAL C1] `isTraceSuccessful` accepts aborted-run-followed-by-RUN_COMPLETED-passed — false positive admits failure-mode trajectories into training data

**File:** `packages/evals/src/distill/filters.ts:31-41`

**Reproduction** (verified via `tsx /tmp/test-filter-edge.ts`):

```
aborted-then-passed: true
failed-then-passed:  true
passed-then-failed:  false
```

The filter reverse-scans events and returns `true` whenever the **last** `RUN_COMPLETED` has `payload[0] === "passed"`. It does NOT check for a preceding `ASSERTION_FAILED category=abort` marker.

**Why it matters:** The Wave 1.B plan contract (`plan.md:150-156`) defines two legitimate terminal states:
- `RUN_COMPLETED` with all steps terminal (success).
- `ASSERTION_FAILED category=abort` followed by `RUN_COMPLETED` (expected abort).

The second case is NOT a successful trajectory — the harness aborted; the subsequent `RUN_COMPLETED` is a termination marker, not a pass. But the filter treats any `payload[0]==="passed"` as success. If a real trace ever emits `ASSERTION_FAILED abort` and the final `RUN_COMPLETED` carries `payload[0]==="passed"` (e.g. a recovery replay, a race between fibers, a future harness change), the filter admits that trace as training data.

Fine-tuning on a trajectory that reached an assertion-abort teaches the student to emulate the failure-then-fake-completion shape — the exact anti-pattern that Wave 1.B's adherence gate was designed to prevent upstream. The filter is the LAST line of defense before bytes become training input; it must be strictly tighter than the harness invariants, not strictly looser.

**Fix:** The predicate should additionally reject traces where any `ASSERTION_FAILED` event has `category === "abort"`. Equivalent shape: walk events forward, track `sawAbort`; only accept the trace if `sawAbort === false && terminalRunCompleted.status === "passed"`.

**Test gap:** `teacher-data-exporter.test.ts:113-125` only covers the trivial `RUN_COMPLETED passed/failed` binary. Add a test that feeds `[ASSERTION_FAILED abort, RUN_COMPLETED passed]` and expects `false`.

---

### [CRITICAL C2] Modelfile builder allows `MESSAGE tool` — invalid per Ollama grammar; real outputs already contain it

**File:** `packages/evals/src/distill/modelfile-builder.ts:93-104`, `:38-41`

`validateMessageRole` accepts `"system" | "user" | "assistant" | "tool"`. Ollama's Modelfile grammar (https://github.com/ollama/ollama/blob/main/docs/modelfile.md) defines `MESSAGE` roles as **system | user | assistant only**. `tool` is not a valid Modelfile MESSAGE role — Ollama's chat-history format at the Modelfile level predates tool-calling and uses plain chat turns.

**Evidence in the committed artifact** (`data/distill/examples/Modelfile:76,83`):

```
MESSAGE tool """
[{"type":"text","text":"Successfully navigated to https://www.bbc.com/news..."}]
"""
```

Two `MESSAGE tool` directives in the committed Modelfile. Current Ollama appears to accept or silently skip these during `ollama create` (diary reports `ollama create` in 0.06s without error), but:

1. Any stricter Ollama release will reject the Modelfile → the generated artifact breaks.
2. Even when accepted, the MESSAGE chain loses the `role: tool` semantics — the few-shot becomes inconsistent (an `assistant` turn chains into another `assistant` or `user` turn, with the intervening tool output classified incorrectly).
3. `build-modelfile.ts:18-46` pulls tool messages from `readExampleMessages` without filtering — so any sample with tool turns propagates this shape.

**Why it's critical for Wave 5:** Wave 5's whole output is bytes that downstream training/serving consumes. If Ollama's parser changes or the contract tightens, the committed Modelfile becomes unusable, and distilled models built via this pipeline stop loading. Stop the bleeding now.

**Fix options:**
- (a) In `validateMessageRole`, drop `"tool"` — reject it at build time.
- (b) In `readExampleMessages` (`build-modelfile.ts:26-45`) and the smoke's `exampleMessages` filter (`smoke-finetune.ts:122-131`), skip `role === "tool"` messages OR inline them into the prior assistant turn's content as a `<tool_result>...</tool_result>` block (already the style chosen for `<tool_calls>...</tool_calls>`).

---

### [MAJOR M1] Diary claims `REDACTED_KEY_PATTERN` is "centralized" and "duplicated nowhere" — it is duplicated

**Files:** `packages/evals/src/distill/filters.ts:13`, `packages/evals/src/runners/trajectory-summary.ts:6`

Both files declare:

```ts
const REDACTED_KEY_PATTERN = /api[_-]?key|token|password|secret|authorization/i;
```

The distill filter exports it (`export const ...`) while `trajectory-summary.ts` keeps a private `const`. There is NO import between them.

**Diary claims**:
- "Redaction — redactSensitiveKeys (src/distill/filters.ts:51-81): ... The pattern is intentionally identical to `runners/trajectory-summary.ts:6` — teacher-data and LLM-as-judge share **one** redaction policy, so changes to what-counts-as-sensitive land in both places." (line 101-107)
- Guardrail section: "**Sensitive values never leak:** redaction is a centralized helper; duplicated nowhere." (line 252-253)

Both claims are false. The regex literal is typed twice in two files. A future edit to one of the two patterns silently drifts — the exact risk the diary says was mitigated.

**Fix:** Delete the duplicate in `trajectory-summary.ts`, import `REDACTED_KEY_PATTERN` from `src/distill/filters` (or move both to a new `src/distill/redaction.ts` and import into `trajectory-summary.ts`). Verify via grep after the fix.

---

### [MAJOR M2] `smoke-finetune.ts` uses untagged `new Error(...)` + `Effect.fail(new Error(...))` instead of `Schema.ErrorClass` — violates Effect rules cited in the wave's own guardrail section

**File:** `packages/evals/scripts/distill/smoke-finetune.ts:91-99, 101-106, 110-114, 160-170, 187, 193-196`

Thirteen places construct plain `Error` instances. Four of them flow through `Effect.fail(new Error(...))`. CLAUDE.md's Effect rules state:

- "Use `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`..." (Errors section)
- "Use `.asEffect()` on error classes instead of `Effect.fail(new Error(...))`." (Error Handling note)

The wave's own diary guardrail section (`wave-5-distillation.md:244-247`) claims: "`Schema.ErrorClass` with explicit tags... Effect rules observed." This is not observed in the smoke script. While scripts are looser than library code, the diary makes a specific claim that isn't met.

**Separately:** `runCommand` in `smoke-finetune.ts:50-70` is a hand-rolled Promise wrapper around `child_process.spawn`. CLAUDE.md banned this pattern in favor of `Effect.tryPromise`. The script wraps `runCommand` calls in `Effect.tryPromise` — but the inner Promise is still not an Effect, and errors surface as unhandled promise rejections if `child.on("error")` fires before resolution. Minor defect in robustness.

**Fix:** Define `OllamaUnavailableError`, `OllamaCreateFailedError`, `OllamaGenerateFailedError`, `SmokeSampleMissingError` as `Schema.ErrorClass` in the script (or a colocated module) and use `.asEffect()`. Use `Effect.acquireRelease` for the smoke model lifecycle instead of a `try/finally` block at `:156-230`.

---

### [MAJOR M3] `smoke-finetune.ts` reports `status: ok` on an empty model response — the smoke's positive-path assertion is missing

**File:** `packages/evals/scripts/distill/smoke-finetune.ts:178-212`

Verified reproduction (this review's run):

```
[09:02:47.903] INFO (#1): Smoke model responded { responsePreview: '' }
{ "status": "ok", "smokeModel": "perfagent-smoke-finetune", "responsePreview": "", ... }
```

The model answered with an empty string. The script nonetheless reported `status: ok` and exited 0. The only positive signal the smoke checks is HTTP 200 from `/api/generate`. Ollama can (and does, per this run) return HTTP 200 with `{response: ""}` — empty response — when the model load races the generation window or the chat template resolves to an input that yields zero tokens.

**Why it matters:** Wave 5's smoke is the single automated check that the Ollama plumbing works end-to-end before handoff to GPU training. "Model loaded and returned any bytes" is the critical assertion. An empty response likely indicates a subtle Modelfile/SYSTEM/MESSAGE integration issue (the extra `MESSAGE tool` turns may be the cause — see [C2]) — the current script hides it under a green `status: ok`.

**Fix:** After `generateResult` is received, require `generateResult.trim().length > 0`; if empty, fail the effect with a typed error and surface the HTTP response body for debugging.

---

### [MAJOR M4] Modelfile artifact duplicates the full system prompt — once as `SYSTEM` and again as `MESSAGE system`

**File:** `packages/evals/data/distill/examples/Modelfile:10-69`, produced by `build-modelfile.ts:18-46`

The committed Modelfile contains:
- `SYSTEM """..."""` (lines 10-39) — 1678 characters of the harness system prompt.
- `MESSAGE system """..."""` (lines 40-69) — the **same** 1678 characters, repeated.

Cause: `readExampleMessages` (`build-modelfile.ts:18-46`) slurps every message from the first JSONL sample, including the `role === "system"` entry that `eventsToMessages` prepends (`teacher-data-exporter.ts:206`). There's no filter on the system role.

**Effect:** The SYSTEM directive sets the runtime system prompt. The redundant `MESSAGE system` then appears as the first history turn. The base model sees a near-identical text twice, consuming ~420 tokens of context for no semantic gain. Worse, in multi-sample Modelfiles each sample would re-inject the system prompt as another `MESSAGE system`, making the file O(N) bloated.

**Fix:** In `readExampleMessages`, skip `message.role === "system"` — the SYSTEM directive already owns that slot. Add a test asserting that generated Modelfiles contain exactly one `SYSTEM `-prefixed line and zero `MESSAGE system ` lines.

---

### [MAJOR M5] `diary` claims "Nothing outside `packages/evals/` was modified" — the claim is narrowly true but the scope also modifies non-distill files inside `packages/evals/`

**Files:** `packages/evals/src/scorers/final-state.ts`, `packages/evals/tests/mock-runner.test.ts`, `packages/evals/tests/scorers.test.ts`

`git diff --stat HEAD` shows four uncommitted, non-distill modifications:
- `packages/evals/package.json` — adds `distill:*` scripts (expected; scoped).
- `packages/evals/src/scorers/final-state.ts` — single-line formatting change.
- `packages/evals/tests/mock-runner.test.ts` — formatting (multi-line → single-line).
- `packages/evals/tests/scorers.test.ts` — formatting.

All three non-package.json changes are prettier auto-formatting, not logic. They are harmless in isolation. BUT the diary's claim is that Wave 5 is self-contained under `packages/evals/src/distill/`. Incidental formatter-induced drift in sibling files is not called out anywhere. This sets a bad precedent for "I only touched X" claims — a reviewer can't rely on the diary for scope.

The review-system-prompt's "Scope hygiene" checklist (point 1) says: "Anything else → Major." Formatting churn in unrelated files is minor on its own, but the un-disclosed scope drift is Major per the review protocol.

**Fix:** Either revert the formatting drift in `final-state.ts` / `mock-runner.test.ts` / `scorers.test.ts` (cleanest), or note the formatter-only diff in the diary under "Files added / modified" with an explicit justification.

---

### [MINOR m1] `build-modelfile.ts:189` casts `response.json()` to a typed shape via `as` — should decode via `Schema`

**File:** `packages/evals/scripts/distill/smoke-finetune.ts:189`

```ts
const data = (await response.json()) as { response?: string };
```

CLAUDE.md states: "Prefer Schemas Over Fragile Property Checks". For a script this is low-risk, but a future Ollama version change that renames `response` to, say, `output` will silently coerce to `undefined` and fail silently ("responsePreview: '' " — see [M3]).

**Fix:** Define a local `OllamaGenerateResponse = Schema.Struct({ response: Schema.String })` and use `Schema.decodeUnknownSync`.

---

### [MINOR m2] `build-modelfile.ts:26` casts `JSON.parse(line) as unknown` then immediately `Schema.decodeUnknownSync(TrainingSample)(parsed)` — the `as unknown` is redundant

**File:** `packages/evals/scripts/distill/build-modelfile.ts:26`, `smoke-finetune.ts:77`, `teacher-data-exporter.ts:51`

`JSON.parse` already returns `any`. `as unknown` is a no-op defensive cast. Harmless but noise per CLAUDE.md "no type casts unless unavoidable."

---

### [MINOR m3] `task-registry.ts` exports a 20-task list by static import — drift risk if a future task file is added without updating the registry

**File:** `packages/evals/src/distill/task-registry.ts:1-50`

The registry is hand-maintained. No test asserts that every file under `packages/evals/tasks/` is referenced. If a new task is added (e.g. `moderate-3.ts`) and the exporter runs against traces for it, the trace's `taskId` will be unresolvable → `TraceTaskResolutionError` will fail the whole export, not just that trace.

Worse: the engineer's error path at `teacher-data-exporter.ts:394-400` is a **hard fail** — one stray task file kills the entire export. If this is intentional (fail loudly rather than silently drop), the diary should document it. If not, consider `yield* Effect.logWarning(...); tracesRejected += 1; continue;`.

---

### [SUGGESTION] Content-hash dedup uses non-canonical JSON — object key ordering drift could defeat dedup

**File:** `packages/evals/src/distill/teacher-data-exporter.ts:275-286`

`hashMessages` builds a canonical-looking object then calls `JSON.stringify`. JavaScript's `JSON.stringify` preserves key insertion order, so all objects built by the same code path hash consistently. But if a future refactor changes the order in which `role`, `content`, `toolCalls`, `toolCallId` are added to the object literal, older hashes would no longer match newer hashes for the same logical message.

Not a current defect. But a brittle coupling between object construction order and dedup identity. Consider sorting keys explicitly (e.g. `Object.keys(obj).sort()` before stringify) to make the hash stable across code changes.

---

### [SUGGESTION] `ExportSummary.outputPath` is set to `""` inside `runExport` and never filled in

**File:** `packages/evals/src/distill/teacher-data-exporter.ts:448-455`, `jsonl-writer.ts:76`

`runExport` returns `summary.outputPath = ""` because the service doesn't know where the caller will write. The caller (`export-teacher-data.ts`) then writes the file via a separate call and logs `outputPath` from local state. The `ExportSummary` schema carries `outputPath` as required but it's effectively always empty. Either remove the field from the schema or have the service accept the path and write it itself.

---

## Blocking criteria

Per review-system-prompt's severity table, Critical and Major findings block merge. This review raises:
- 2 × Critical (C1, C2)
- 5 × Major (M1–M5)
- 3 × Minor
- 2 × Suggestions

**Verdict: REQUEST_CHANGES.** Address C1 + C2 first (both corrupt downstream outputs). M1 + M4 are short fixes. M2 + M3 require small script refactors. M5 is documentation/scope hygiene.

Staying alive for Round 2.
