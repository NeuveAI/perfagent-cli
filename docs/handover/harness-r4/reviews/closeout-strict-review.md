# Review: ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9 — Close out harness-r4 detector validation

## Verdict: APPROVE

### Correctness Check

- Source of truth: Read `docs/handover/harness-r4/closeout-scope.md`, `docs/handover/harness-r4/eval-signals-2026-06-02.md`, `docs/handover/harness-r4/t_f1abb9ba-review-feedback.md`, and `docs/research/harness-r4/detectors-plan.md`.
- Kanban ticket: `ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9` is in `in-progress`; passed evidence handoffs now satisfy `next-round-evidence`, `next-round-eval-report`, `scoped-tests`, and `strict-review`. The done gate passes after this review evidence handoff.
- Correctness target: The THOUGHT-only semantics fix is correct. ACTION now resets the THOUGHT-only streak in both local-agent and Gemini-react paths; PLAN_UPDATE and STEP_DONE reset behavior, REFLECT thresholds, and doom-loop thresholds are preserved.
- Dispatch scope: Scoped implementation and evidence files were inspected. Unrelated dirty `.devcontainer/devcontainer.json` and generated baseline changes remain out of scope and are documented as staging exclusions.
- Dependency/HITL status: No parent dependencies are recorded. Owner approval is still required before `neuve init`, `pnpm approve-builds`, or a long fresh sweep; this slice does not bypass those decisions.
- DoD checklist: Satisfied for this closeout slice. Focused tests pass, direct package typechecks pass, required evidence/report artifacts exist, non-review Kanban evidence labels are recorded, and this strict review approves.
- Review lanes: One strict code/evidence/Kanban lane completed for local-agent, evals, shared typing, docs, and process evidence.
- Type/lint/doc gates: `packages/shared`, `packages/local-agent`, and `packages/evals` typechecks pass. The local `which` declaration is acceptable: it is narrow, colocated with the only shared package usage, matches the runtime `which.sync(command)` API used here, and avoids dependency/lockfile churn for a one-method compatibility shim.
- Git history/staging: Behavior/test changes, shared typing fix, and closeout docs are separable. The out-of-scope devcontainer and generated baseline changes must stay separate or unstaged.
- Verification evidence: Independently reran `./node_modules/.bin/tsgo --noEmit -p packages/shared/tsconfig.json`, `./node_modules/.bin/tsgo --noEmit -p packages/local-agent/tsconfig.json`, `./node_modules/.bin/tsgo --noEmit -p packages/evals/tsconfig.json`, `./node_modules/.bin/vp test run packages/local-agent/tests/tool-loop-agent-turn.test.ts`, and `./node_modules/.bin/vp test run packages/evals/tests/gemini-react-loop.test.ts`; all passed.
- Decision-log status: Evidence docs honestly record the pnpm build-approval blocker, the passing non-mutating direct route, the corrected flat pass-rate claim, and unresolved fresh two-sweep PLAN_UPDATE reproducibility.

### Findings

- [INFO] No blocking findings remain. The previous Kanban evidence and evals typecheck blockers are resolved.

### Suggestions (non-blocking)

- If `which` is used from more packages or with more of its API later, replace the narrow local declaration with a package-level type dependency or a fuller shared declaration.
- Keep `.devcontainer/devcontainer.json` and `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md` out of the closeout commit unless they receive separate ownership and review.
- The evidence text can be made slightly more precise by saying the second-sweep trace directory is absent in this workspace rather than only saying it has `0 files`.

### Neuve Dogfood Feedback

- Commands run: `neuve kanban show ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9`; `neuve kanban context ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9`; `neuve kanban gate ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9 --target done`; `neuve kanban evidence ... --satisfies strict-review`.
- Artifact refs: existing `.neuve-artifact/doctor-1782495962-37981000-66913.json`; `docs/handover/harness-r4/evidence/neuve-ax-feedback.md`; `docs/handover/harness-r4/reviews/closeout-strict-review.md`.
- Kanban updates: recorded passed `strict-review` evidence with proof ref `docs/handover/harness-r4/reviews/closeout-strict-review.md`; final gate now passes.
- Signal value: The gate output was useful: it clearly showed the previous non-review evidence gaps were resolved, then confirmed the strict-review handoff cleared the final gate.
- Sticking points: Evidence handoff output repeats older and refreshed entries, which makes it harder to see the latest proof at a glance even though the gate correctly evaluates the labels.
- Format feedback: `show` would be easier to review if evidence handoffs were grouped by `satisfies` label with latest-first ordering.
- Backlog signals: Add an explicit "latest passed proof per expected evidence label" summary to Kanban output.
- Feedback artifact: `docs/handover/harness-r4/evidence/neuve-ax-feedback.md`.
