# R9 — Prompt-vs-strict-schema reconciliation

_Surfaced from R8 P3 verification sweep (`docs/handover/ollama-empty-content/diary/r8-2026-04-30.md` Phase 2)._

## What we're fixing

R8 dropped `tools` from the Ollama wire when `format` is set. That ended the lazy-grammar collision (empty-content 6/20 → 0/20) but exposed a previously-masked failure mode: **schema-invalid envelopes 1/20 → 10/20**. Pre-R8 the `tools` field structurally constrained gemma's emissions to upstream-API shapes; post-R8 the system-prompt `<tool_catalog>` prose at `buildLocalAgentSystemPrompt:127-131` is the only catalog source, and it's inconsistent with R7's strict per-tool union.

Aggregate impact: mean step-coverage went UP (0.398 → 0.423) because previously-empty-content tasks now reach more key nodes, but pass/fail regressed (+3 hard-fail tasks). Closing this gap should land more step-coverage and produce a cleaner gemma baseline before R10 teacher-viability work.

## What schema-invalid envelopes actually look like

Engineer's R8 diary characterized four patterns:

| Pattern | Example | Strict-schema reality |
|---|---|---|
| Field-name mismatch | `interact { command: "click", selector: "#foo" }` | `InteractClick` requires `uid` (snapshot ref), no `selector` field. `onExcessProperty: "error"` rejects |
| Semantic mismatch | `interact { command: "type", selector: "...", text: "..." }` | `InteractType` is `{ command, text, submitKey? }` — no `uid`/`selector`. `type` is "type into focused element"; what gemma means is `fill`, which is `{ command, uid, value, includeSnapshot? }` |
| Wrong tool | `observe { command: "click", selector: "..." }` | `observe` is the snapshot/screenshot dispatcher; `click` belongs in `interact` |
| Hallucinated command | `interact { command: "title", ... }` | `title` not in the `InteractCommand` union at all |

Pre-R8, gemma got the canonical shapes structurally because the `tools` field carried the per-command JSON schema. Post-R8, gemma falls back to system-prompt prose which currently teaches:

```
<tool_catalog>  // toolName ∈ {interact,observe,trace,click,fill,hover,select,wait_for}; args schema-enforced
- interact — navigate, click, type, fill. command="navigate" with `url` is the entry path.
- click(ref) — click an interactive element by its snapshot ref
- fill(ref, text) — type into an input
```

Specific issues with the prompt:
- Says `ref` but strict schema uses `uid`.
- Says `fill(ref, text)` but strict schema's `InteractFill` uses `value` not `text`.
- Lists `click`, `fill`, `hover`, `select`, `wait_for` as both top-level tools AND interact subcommands. The strict per-tool union contains all of these as `InteractCommand` variants (subcommands of `interact`); there are no flat top-level `click`/`fill` tools. The prompt's bullet enumeration is wrong on its face.
- Doesn't mention the dispatcher pattern explicitly — gemma has to guess from examples whether `interact { command: "click", uid: ... }` or flat `click { uid: ... }` is the canonical form.

## Hypothesis-of-fix matrix

| # | Option | What changes | Cost | Risk |
|---|---|---|---|---|
| 1 | **Tighten prompt to match strict schema** | Rewrite `buildLocalAgentSystemPrompt:127-145` to: (a) teach the dispatcher form unambiguously, (b) use canonical field names `uid` and `value` not `ref`/`text`, (c) list the `InteractCommand` variants from the strict union with their required fields. | Small change in `prompts.ts`. | Prompt overfitting per `feedback_avoid_prompt_overfitting.md` — but this is catalog correctness (general), not site-specific nav heuristics. Acceptable. |
| 2 | **Loosen strict union** | Accept aliases (`selector` → `uid`, `text` → `value` for fill, etc.). Possibly fold flat tools into interact union. | Schema work in `react-envelope.ts`. | Partially undoes R7's strict enforcement that made gemini structured-output stable. R7 just shipped two days ago. |
| 3 | **Restore tools with stripped schema** | Pass tools with `parameters: { type: "object", additionalProperties: true }` so gemma sees tool names without grammar-collision-triggering schema. | Small change in `tool-loop.ts:151` and possibly `mcp-bridge.ts`. | Untested whether Ollama's tool-call grammar fires on an empty schema. Speculative. May reintroduce the lazy-grammar collision R8 just fixed if Ollama treats empty-schema tools as still-grammar-bound. |
| 4 (new) | **Hybrid: tighten prompt + add MCP-bridge auto-wrap aliases** | Option 1 plus extend the existing bridge auto-wrap normalizer (`packages/local-agent/src/mcp-bridge.ts` `flattenOneOf` path) to coerce `selector` → `uid` at runtime so historical/transitional emissions still parse. | Medium change spanning prompts + bridge. | Safest combination — teaches the canonical form forward AND coerces transitional shapes. May be overkill if Option 1 alone clears the gate. |

My initial lean: **start with Option 1 (tighten prompt) and verify against the same 20-task sweep**. If gate clears (schema-invalid drops to ≤ 1/20), ship. If not, escalate to Option 4 (add bridge auto-wrap coercion). Skip Option 2 — undoes R7 enforcement that just stabilized gemini. Skip Option 3 — speculative + reintroduces R8's collision risk.

## Sub-probes

### P1 — Characterize the actual schema-invalid traces

Goal: confirm the four patterns above represent the full distribution; quantify per-pattern frequency.

Probes:
- Walk the 10 schema-invalid traces in `packages/evals/evals/traces/wave-r8-no-tools/`. For each, extract the rejected envelope's `toolName`, `command`, `args` shape, and the `parseAgentTurnFromString` error message.
- Build a frequency table: how many of the 10 are field-name mismatch (`selector` vs `uid`), how many are semantic mismatch (`type` for what should be `fill`), how many are wrong tool, how many are pure hallucinations.
- This tells us whether prompt-tightening alone (Option 1) covers the failure mass, or whether bridge auto-wrap coercion is needed.

Effort: small probe.

### P2 — Implement the chosen option + verification sweep

Goal: land the fix, run the same gemma-react-only verification sweep R8 used, gate on schema-invalid dropping to ≤ 1/20 (matching pre-R8 baseline).

Probes:
- Implement chosen option (Option 1 first; escalate to Option 4 if needed).
- Run gemma-react-only sweep against post-fix branch. Save report at `docs/handover/harness-evals/baselines/wave-r9-prompt-aligned.md`.
- Compare to R8 numbers: empty-content stays at 0/20, schema-invalid drops, mean step-coverage hopefully lifts further.
- Update diary at `docs/handover/schema-invalid-reconciliation/diary/r9-2026-04-30.md` with results.

Effort: small-to-medium fix + ~33 min sweep.

### P3 — Reviewer

Antagonistic verification of the prompt change (does it teach what the strict schema actually wants?), the verification sweep methodology, and any bridge auto-wrap if Option 4 was used.

## Wave gates

1. Schema-invalid envelopes drop from 10/20 to ≤ 1/20 on a full gemma-react sweep.
2. Empty-content events stay at 0/20 (R8's gate maintained).
3. Mean step-coverage ≥ 0.423 (no regression from R8 baseline; ideally lifts).
4. R7 strict-union enforcement intact (Option 2 NOT pursued unless escalated).

## Out of scope

- Teacher viability ladder — that's R10 (Q1: gemini-3-pro-preview first, then claude-sonnet-4-6, then biggers).
- Distillation pipeline — gated on R10.
- Site-specific nav heuristics in the prompt — per `feedback_avoid_prompt_overfitting.md`, prompts teach reasoning frameworks not site patterns. Catalog correctness IS general, but if the prompt-tightening exercise drifts into "and on volvocars.com try X first," stop.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass`, `Effect.fn`. No `catchAll`/`mapError`/`try-catch`/`null`. Per `CLAUDE.md`.
- No `Co-Authored-By` footer. Granular commits. Per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push`. Per `feedback_reviewer_never_stash.md`.
- Live smoke for any new code path. Per `feedback_no_test_only_injection_seams.md`.
- Real Ollama for verification sweep. Same gemma-react-only EVAL_R5_SKIP_RUNNERS pattern as R8.

## Team structure

`react-r9` with engineer + reviewer per `feedback_use_teammates.md`.

- T1 (engineer): P1 characterize + propose option to lead, then P2 implement + verify after authorization.
- T2 (reviewer, antagonistic): verify prompt change matches strict schema, verification sweep methodology is sound, no test-only injection seams, R7 strict-union enforcement intact.

## Diary location

`docs/handover/schema-invalid-reconciliation/diary/r9-2026-04-30.md` — engineer captures P1 frequency table, P2 chosen option + rationale + sweep results, gate outcome.
