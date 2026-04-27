# Wave R7 — Strict tool-schema adherence

**Status:** PLANNED 2026-04-27.
**Predecessor:** R6 SHIPPED INVESTIGATIVE-VERIFIED 2026-04-27 (HEAD `08db9c2f`, branch `gemma-harness-lora` 161 commits ahead of `origin/main`, unpushed).
**Owner:** team-lead.
**Reference:** `docs/research/gemini-investigation/why-gemini-fails.md` (commit `c14f83ad`) — the forensic report this plan acts on. Read it first.

## Why

R6 multi-modal wiring shipped (gemma-react gained 0.711 → 0.778 on the 3-task probe; smoke probes regression-guard the wire shapes) but gemini-react stayed at 0.000. Forensic finding: the names gemini emits (`navigate_page`, `take_snapshot`, `performance_start_trace`) are the canonical, current public API of `chrome-devtools-mcp@0.21.0` — verified at `node_modules/chrome-devtools-mcp/build/src/tools/{pages,snapshot,performance}.js`. Our 3-dispatcher abstraction (`interact`/`observe`/`trace`) is the divergent surface. Gemini's training-data prior (Google ships first-party `gemini mcp add chrome-devtools` integration) overwhelms our 35-line in-context system prompt.

The catalyst: `args: Schema.Unknown` at `packages/shared/src/react-envelope.ts:35` puts zero structural pressure on the args body. The tool inventory lives only in prose. Gemini honors the schema (envelope shape) but not the prose (tool list). The fix is to encode the inventory in the schema — the channel the model physically respects.

Direct OSS precedent: `browser-use #104` is the same exact bug (Gemini emits flat shape when Pydantic descriptions missing); the fix was strict per-action schemas with descriptions on every field. Mastra's published study measured a 5x reduction in tool-call errors (15% → 3%) on Gemini specifically by tightening permissive schemas.

## Goal

Lift `gemini-react` mean step-coverage **above 0.465** (gemma-react production score) by constraining `ACTION.args` in the `AgentTurn` `responseSchema` to a discriminated union per `toolName`. Both runners get the change so the A:B remains apples-to-apples.

If schema constraint alone (Tier 1) does not move gemini-react above the partial-sweep gate, Tier 2 (tool-name aliasing in MCP bridge) ships behind a sequenced gate. If both tiers together still fall short, the wave reports INVESTIGATIVE and we pivot — most likely to the §9.3 open question (switch teacher model).

## Scope (in)

1. **Tier 1 — Schema-constrain `ACTION.args` per `toolName`** in `packages/shared/src/react-envelope.ts`.
   - Replace `args: Schema.Unknown` with `Schema.Union` of per-tool variants. Eight variants total: `interact`, `observe`, `trace`, `click`, `fill`, `hover`, `select`, `wait_for` (matching the 8 tools registered in `packages/browser/src/mcp/server.ts`).
   - Each variant defines its `args` shape directly. For dispatcher tools (`interact`/`observe`/`trace`), this is `{action: <discriminated-union-of-commands>}` mirroring the Zod schema at `packages/browser/src/mcp/tools/interact.ts:7-92`.
   - Use Effect's `Schema.Struct` with a `Schema.Literal("interact" | "observe" | ...)` discriminator field; `Schema.toJsonSchema` should render this as `oneOf` (Gemini handles `oneOf` correctly; `anyOf` is broken per `colinhacks/zod #5807`).
   - **Pydantic-style descriptions on every field** (`browser-use #104` precedent: missing descriptions are root cause of Gemini's flat-shape fallback). Use `Schema.annotations({ description: ... })` on every leaf.
2. **Tier 2 — Tool-name aliasing in MCP bridge** in `packages/local-agent/src/mcp-bridge.ts`. **Sequenced behind Tier 1's partial-sweep gate** — only ships if Tier 1 alone misses the gate.
   - Add a static alias map for the upstream chrome-devtools-mcp 34-tool catalog (`navigate_page`, `take_snapshot`, `take_screenshot`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, etc.) → our dispatcher contract.
   - Engineer determines exact mapping from `node_modules/chrome-devtools-mcp/build/src/tools/*.js` and our `packages/browser/src/mcp/tools/*.ts`.
   - Alias resolution runs BEFORE the existing `wrapperKey + "command" in args` auto-wrap so aliased calls flow into the canonical shape automatically.
3. **System-prompt updates** in `packages/shared/src/prompts.ts` (and `buildLocalAgentSystemPrompt`).
   - Reflect that tool inventory + args shapes are now schema-enforced. The prompt becomes a *teaching* aid, no longer the load-bearing constraint.
   - Keep ≤20 added lines. **No site-specific heuristics** (per `feedback_avoid_prompt_overfitting.md`).
4. **Live smoke probes extended** to validate the strict schema:
   - `packages/evals/tests/gemini-live-smoke.test.ts`: assert `generateObject` against the new strict schema produces a valid `ACTION` envelope on a synthetic prompt that previously triggered the flat-shape bug.
   - `packages/local-agent/tests/gemma-multimodal-smoke.test.ts`: same against Ollama with the strict schema as `format`.
5. **Partial-sweep gate.** 3-task probe before full re-run: `EVAL_R5_SKIP_RUNNERS=gemma-oracle-plan EVAL_TASK_FILTER=calibration-1-single-nav-python-docs,journey-4-account-signup,moderate-2-mdn-web-api-detail`. Pass condition: gemini-react mean step-coverage on those 3 ≥ 0.5. If pass → full sweep. If fail with Tier 1 only → ship Tier 2 + re-gate. If fail with both → INVESTIGATIVE memo, pause.
6. **Full re-run + report.** Build `docs/handover/harness-evals/baselines/wave-r7-strict-schema.md`. Compare side-by-side with R5b and R6 (multi-modal partial result).

## Scope (out)

- **Switching the teacher model** (§9.3 of report). Pursued only if R7 fails. Tracked in the post-R7 follow-up if needed.
- **Drop-the-dispatcher refactor** (Tier 3 of the report). Reserved for a dedicated wave only if T1+T2 fall short.
- **Debugging-mode tasks** (Volvo-perf, Amazon, Etsy, eBay, Tradera). Parked until `browsing-gemma` LoRA ships.
- **New scorers.** `stepCoverage` / `furthestKeyNode` / `finalState` / `toolCallValidity` stay as-is.
- **New MCP tools.** No surface additions.
- **Action-space changes (e.g. flat tool surface).** That's Tier 3 of the fix matrix — separate wave.
- **LoRA training.** Gated on R7 lifting gemini-react above 0.465.

## Locked decisions (do NOT relitigate)

1. **Schema strategy:** Effect `Schema.Union` of per-tool variants discriminated on `toolName` literal. Renders to `oneOf` in JSON Schema. Field-level `Schema.annotations({ description })` on every leaf.
2. **Both runners get the strict schema in one wave.** Apples-to-apples A:B preserved.
3. **Tier 2 is sequenced behind Tier 1's gate.** Don't ship both at once — we want to know which tier moves the needle.
4. **Auto-wrap (`mcp-bridge.ts:246-251`) stays.** It's the regression-guard for gemma-react's `{command: ...}` shorthand emissions. The strict schema renders the auto-wrap mostly redundant for the schema-honoring path, but keeping it is cheap insurance.
5. **No new MCP tools, no new model providers.** R7 fixes our existing harness; teacher-switch is a separate decision after R7 results.
6. **Backward-compat for existing trace files.** R6 traces in `packages/evals/evals/traces/wave-r5-ab/` must still parse under the new schema for replay tests. If gemma's existing shape rejects, the schema must be widened to accept it OR the auto-wrap must rewrite at decode time.

## Open probes for the engineer (T1 must answer before wiring)

1. **Effect Schema → JSON Schema discriminated-union output.** Write a 30-line tsx probe (delete after) that defines a `Schema.Union(Schema.Struct({toolName: Schema.Literal("interact"), args: ...}), Schema.Struct({toolName: Schema.Literal("observe"), args: ...}))`, calls `Schema.toJsonSchema`, and asserts the output is `{oneOf: [...]}` — not `{anyOf}`. If Effect emits `anyOf`, file a follow-up and either (a) post-process to `oneOf` in `gemini-react-loop.ts` like R5b's `inlineJsonSchemaRefs` walker, or (b) use a different Schema combinator. **Critical** per `colinhacks/zod #5807` — `anyOf` doesn't work on Gemini.
2. **Backward-compat for existing traces.** Read 2-3 `gemma-react__*.ndjson` files from `packages/evals/evals/traces/wave-r5-ab/`. Document the exact `args` shapes gemma emits. Confirm the new strict schema accepts them after the auto-wrap step. If not, the schema needs to widen OR the wave introduces a "decode-rewriter" that auto-wraps before schema validation.
3. **Field-description verbosity.** Browser-use uses 1-2 sentence Pydantic descriptions per field (e.g., "URL to navigate to. Must be a valid http(s) URL."). Match that depth. Probe: write descriptions for `interact.action.navigate.url`, run `gemini-live-smoke` once with descriptions and once without (delete the without version after), document any score change.
4. **Property ordering.** Vertex docs note schema property ordering is load-bearing for Gemini. Confirm the order in `react-envelope.ts` (after the rewrite) matches the order in `prompts.ts` examples. Fix any drift.

## Verification gates (T1's done definition — each is a hard check)

1. `pnpm exec tsgo --noEmit` green across `@neuve/{shared, local-agent, supervisor, evals}`.
2. `pnpm --filter @neuve/{evals, local-agent, shared, supervisor} test` — all pass. Test count strictly increases. New unit tests cover the strict schema + at least 3 backward-compat fixtures (gemma-shorthand, gemini-flat-action attempt rejected, full-canonical accepted).
3. Live smoke probes pass under the new schema: `pnpm --filter @neuve/evals test gemini-live-smoke` AND `pnpm --filter @neuve/local-agent test gemma-multimodal-smoke`.
4. **Tier 1 partial-sweep gate.** `EVAL_R5_SKIP_RUNNERS=gemma-oracle-plan EVAL_TASK_FILTER=calibration-1-single-nav-python-docs,journey-4-account-signup,moderate-2-mdn-web-api-detail pnpm --filter @neuve/evals eval:wave-r5-ab`. Pass condition: gemini-react mean step-coverage on those 3 ≥ 0.5. **Document outcome regardless** (regression of gemma-react below 0.7 also pauses for review).
5. If Tier 1 gate fails: ship Tier 2 (alias map). Re-gate against the same 3 tasks. Same pass condition.
6. Full sweep ONLY after either tier passes the gate. Build `docs/handover/harness-evals/baselines/wave-r7-strict-schema.md`. Pass `--trace-dir <abs>` and `--output <abs>` to dodge the known build-report cwd-doubling bug.
7. **Headline gate for wave success:** mean gemini-react step-coverage > 0.465. If full sweep falls short, file `docs/research/strict-tool-schema/post-r7-investigation.md` with the failure axis (probably points to teacher-switch). Wave reports INVESTIGATIVE.

## Risk areas

1. **Gemma regression.** Strict schema may reject gemma's existing `{command: ...}` shorthand. Auto-wrap should catch it but the schema must accept post-wrap shapes. The backward-compat probe (#2) catches this.
2. **Gemini "silently ignores" parts of the strict schema.** Documented Gemini failure mode (Mastra study, discuss.ai.google.dev field-rename thread). If the schema isn't fully honored, Tier 2 alias map is the safety net. If Tier 2 also fails, the failure axis isn't tool-schema and we pivot to teacher-switch.
3. **`oneOf` vs `anyOf` rendering.** Effect Schema's JSON Schema output for unions matters here. Probe #1 catches this; if Effect emits `anyOf`, we post-process or restructure.
4. **Token budget.** Strict schemas are larger (more $ref expansions, more enum constraints). R5b's `inlineJsonSchemaRefs` already handles `$ref` flattening. Verify the new schema doesn't blow past `responseSchema` size limits Gemini accepts (no published cap, but Vertex has had issues with large schemas).
5. **Doom-loop sensitivity.** The detector keys on `(toolName, argsHash)`. Strict schema shouldn't change action shapes meaningfully on the canonical path; verify with a unit test.
6. **Field descriptions are prompt-overfitting risk.** Per `feedback_avoid_prompt_overfitting.md` — descriptions teach the *general schema*, not site-specific patterns. Reviewer must audit.

## How the post-compact agent picks this up

1. **Read this plan in full** + `docs/research/gemini-investigation/why-gemini-fails.md`.
2. **Memory pointers:**
   - `MEMORY.md` (auto-loaded)
   - `project_react_migration_plan.md`
   - `project_post_plan_continuation.md`
   - `project_gemini_investigation.md` ← this wave's foundation
   - `feedback_no_test_only_injection_seams.md`, `feedback_avoid_prompt_overfitting.md`
   - `feedback_use_teammates.md`, `feedback_commit_guidelines.md`, `feedback_reviewer_never_stash.md`
3. **Verify state:**
   - `git log --oneline -3` — HEAD should be at `08db9c2f` (R6-T2 verdict).
   - `git status --short` — should be clean except 10 pre-existing untracked Q9 probes + `.claude/scheduled_tasks.lock`.
4. **Team `react-r7`** should already exist with T1 (engineer) and T2 (reviewer) tasks defined by this plan. If not, `TeamCreate(team_name: "react-r7")` first.
5. **Spawn engineer** with the seed prompt in T1 (similar shape to R6-T1 but pointing at this plan). Engineer reads, runs open probes 1-4, implements per locked decisions, hits verification gates, writes diary at `docs/handover/strict-tool-schema/diary/r7-2026-04-XX.md`.
6. **Spawn reviewer** with the seed prompt in T2. Antagonistic posture, hard-checks the partial-sweep gates independently.
7. **Iterate APPROVE** loop. Granular commits per `feedback_commit_guidelines.md`, no `Co-Authored-By` footer, no `git push` until user authorizes.

## What success unlocks

- **Distillation pipeline.** If gemini-react > 0.465, its trajectories become teacher data for `browsing-gemma` LoRA via `pnpm --filter @neuve/evals distill:export` (already wired in R5-T4).
- **Debugging-mode wave (post-LoRA).** With browsing scoring well, extend the harness with debugging-mode tasks + new scorers (`cwvAccuracy`, `insightIdentification`, `budgetGate`).
- **Tier 3 archive.** If R7 succeeds, the "drop dispatchers, expose 34 native tools" option (Tier 3 of the fix matrix) becomes a future-research note rather than a live alternative.

## What R7 does *not* claim to fix

- The fact that our 3-dispatcher abstraction is upstream-incompatible. We're constraining the schema, not adopting upstream's flat surface. Tier 3 remains a deferred option.
- Gemini's silent-ignore behavior in general. If R7's schema is itself silently ignored, we learn that empirically and pivot.
- The PLAN_UPDATE emission rate (still 0/60 in R5b/R6 baselines). That's distillation-target territory, not a schema-constraint issue.
