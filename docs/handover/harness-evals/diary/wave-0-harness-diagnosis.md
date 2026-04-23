# Wave 0 — Harness diagnosis (Volvo EX90 prompt)

Date: 2026-04-23
Owner: `harness-capture-eng` (team `harness-evals`)
Source run: `.perf-agent/reports/2026-04-23T16-17-55Z-www-volvocars-com.json` (status `failed`, 14 events, 0 steps — one of two real repros)
Companion artifact: `evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson`

## The ask

User prompt (verbatim):

> "lets go to volvocars.com, navigate to the build page, under the 'buy' > 'build your volvo' menu and build me a new ex90, any spec. Proceed all the way to the order request form and report back the web vitals"

Natural decomposition into sub-goals:

1. Navigate to `https://www.volvocars.com/`.
2. Locate the top-level **Buy** menu.
3. Expand **Buy**, click **Build your Volvo**.
4. Arrive on the Build page.
5. Select the **EX90** model.
6. Pick any spec (engine / trim / exterior / interior — whichever the configurator presents first).
7. Advance through each configurator step to the **Order request form**.
8. Capture web vitals on at least the landing and the configurator/order pages.
9. Report findings.

Expected: ≥4 navigations, ≥2 traces (landing + configurator), a Buy-menu hover/click, an EX90 select, spec choices, form submission.

Actual (per the captured report):
- 1 navigation (homepage).
- 1 trace (homepage).
- 0 status markers emitted — `steps: []` in the persisted report.
- `RunFinished { status: "failed", summary: "Agent completed without executing any test steps" }` synthesised by the supervisor (grace-period elapsed after the agent emitted its final markdown write-up with no `STEP_DONE`).

A second run on the same prompt produced the same shape: `2026-04-23T16-12-46Z-www-volvocars-com-build.json` reached `/build` but emitted `0 steps` and one trace before closing.

## Diagnosis

### (a) Stream termination site

`packages/supervisor/src/executor.ts:238`

```ts
Stream.takeUntil((executed) => executed.hasRunFinished),
```

`hasRunFinished` is a simple "has any `RunFinished` event ever been appended?" check (`packages/shared/src/models.ts:1082-1084`):

```ts
get hasRunFinished(): boolean {
  return this.events.some((event) => event._tag === "RunFinished");
}
```

There is **no cross-check** against the decomposed plan. Any single `RUN_COMPLETED|…|…` line parsed out of agent text via `finalizeTextBlock` (`packages/shared/src/models.ts:982-998`) synthesises a `RunFinished` and the outer `Stream.takeUntil` immediately closes the stream. The plan stored on the `ExecutedPerfPlan` is the synthetic one built at `packages/supervisor/src/executor.ts:154-169` with `steps: []`, so "did we execute every step?" is structurally unanswerable at the termination gate.

### (b) Prompt phrases biasing early-stop

`packages/shared/src/prompts.ts:145-155` — the `<execution_strategy>` block. Two high-value phrases:

- **Line 146:** `"- First profile the primary route the developer asked about. Measure it thoroughly before moving on."`
- **Line 147:** `"- Once the primary route is profiled, analyze additional related routes suggested by the changed files and diff semantics. The scope strategy below specifies how many."`

Problems:

- Both sentences frame the work as "primary route" first, then *optional* follow-ups. For a small LLM, "primary route" collapses to "the one URL the user named" (here `volvocars.com`). The follow-ups are gated on "additional related routes suggested by the changed files and diff semantics" — but in this prompt there are no changed files (`"changesFor": { "_tag": "Changes", "mainBranch": "main" }` with an empty diff), so the model reads the condition as "there are no additional routes to profile."
- "Measure it thoroughly before moving on" sets a single-measurement stopping condition on the *primary* route instead of on the full journey.

Reinforcing bias at `packages/shared/src/prompts.ts:270-278` — the `<run_completion>` block:

```
Before emitting RUN_COMPLETED, complete all of these steps:
1. Run lighthouse_audit …
2. Verify all performance traces have been analyzed …
3. Run the project healthcheck …
4. Call close exactly once …
5. Review the changed files list and confirm every file is accounted for …
6. Compose the session summary for RUN_COMPLETED …
Do not emit RUN_COMPLETED until all steps above are done.
```

"All steps above" here refers to the six items in this sub-list — **not** to user-implied sub-goals. The checklist does not include any item like "confirm every user-implied navigation has been completed." A reader (or a 4B model) following this checklist faithfully will emit `RUN_COMPLETED` after a single landing-page trace plus a lighthouse audit plus close — exactly what we observed.

Additional minor biases in the same prompt:

- `packages/shared/src/prompts.ts:127` — "…the page loads, Core Web Vitals look green, and you emit RUN_COMPLETED without…" — the prompt warns against the exact failure mode, but the warning is buried in a paragraph about rationalisations, not enforced anywhere.
- `packages/shared/src/prompts.ts:151` — "Create your own step structure while executing. Use stable sequential IDs like step-01, step-02, step-03." — delegates plan decomposition entirely to the model, which a 4B model will not do reliably.

### (c) Agent's verbatim text immediately before `RUN_COMPLETED`

The captured run never emitted a textual `RUN_COMPLETED|...` marker at all. The final `AgentText` event ends with a markdown "Action Plan Summary" — there is no status-marker line. The supervisor synthesises `RunFinished` only because the grace-period elapsed (`ALL_STEPS_TERMINAL_GRACE_MS` in `packages/supervisor/src/constants.ts`), and because `steps.length === 0` (synthetic plan), the trivial `allStepsTerminal` branch short-circuits to "terminal."

Verbatim tail of the last `AgentText` event (`evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson`, event 13, final lines of the message):

```
## 🎯 Action Plan Summary (Prioritized)

To achieve the best performance gains, focus on these steps in order:

1.  **Audit and Defer:** Review all third-party scripts and non-essential JavaScript/CSS, implementing `defer` or `async` loading.
2.  **Image Optimization:** Implement responsive images and ensure all media assets are compressed and correctly sized.
3.  **Code Splitting:** Refactor large JavaScript bundles using modern build tools to improve initial load time and interactivity.
```

This is a generic Lighthouse-style write-up of a single landing-page trace. It does not reference the Buy menu, EX90, configurator, or order form. The agent treated "report back the web vitals" as the sole actionable goal and dropped every navigation sub-goal on the floor.

### (d) Planned-but-unexecuted steps (recovered from the prompt)

Because the harness does not pre-decompose, there is no stored plan to diff against. The list below is the sub-goal decomposition the harness *should* have produced (and against which the adherence gate in Wave 1.B should refuse to terminate). Every item here was **not** executed in either captured run.

| # | Sub-goal | Expected tool(s) | Status |
|---|----------|------------------|--------|
| 1 | Navigate to `https://www.volvocars.com/` | `interact` command=navigate | reached (but both runs hit an "Access Denied" edge page first and had to reload) |
| 2 | Hover/click top-nav **Buy** | `evaluate_script` or a real click tool (not available in current surface) | not attempted |
| 3 | Click **Build your Volvo** submenu | `evaluate_script` or real click | not attempted |
| 4 | Land on `/cars/*` or `/build` picker | navigation verification | one run reached `/build` via direct URL; no menu traversal |
| 5 | Select **EX90** card | click | not attempted |
| 6 | Pick exterior / interior / engine / wheels (whichever gates the flow) | multiple clicks + waits | not attempted |
| 7 | Advance through each configurator stage until **Order request form** | multiple clicks, form fills | not attempted |
| 8 | Capture performance trace on configurator steps | `trace` start/stop | not captured |
| 9 | Capture performance trace on order request form | `trace` start/stop | not captured |
| 10 | Summarise CWV on every profiled page | `AgentText` | partial — summarised only landing |

Interaction-tool gap: even if the harness had a plan and an adherence gate, completing steps 2, 3, 5, 6, 7 today would require the agent to write `evaluate_script` JavaScript to target elements by selector. The model did not attempt this; the path of least resistance for a 4B model is to take a single trace and write a generic write-up. This is the Wave 2.A motivation in the plan.

## Concrete file:line citations (cheat sheet)

- Termination gate: `packages/supervisor/src/executor.ts:238`
- Synthetic empty plan: `packages/supervisor/src/executor.ts:154-169`
- `hasRunFinished` getter: `packages/shared/src/models.ts:1082-1084`
- `allStepsTerminal` getter: `packages/shared/src/models.ts:1086-1093`
- Marker parser (text → `RunFinished`): `packages/shared/src/models.ts:719-755`, `packages/shared/src/models.ts:982-998`
- "Primary route" bias: `packages/shared/src/prompts.ts:146`
- "Additional related routes" bias: `packages/shared/src/prompts.ts:147`
- "Create your own step structure while executing": `packages/shared/src/prompts.ts:151`
- `<run_completion>` checklist ignoring user sub-goals: `packages/shared/src/prompts.ts:270-278`

## Replay workflow

```bash
# Re-emit the captured failure trace byte-equivalently
pnpm tsx scripts/replay-harness-trace.ts evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson

# Re-capture from an existing .perf-agent/reports/*.json (no agent call, deterministic)
pnpm --filter @neuve/perf-agent-cli run harness:capture -- "<prompt>" \
  --from-report .perf-agent/reports/<file>.json \
  --output evals/traces/<name>.ndjson

# Live capture against the real agent (consumes API quota; requires normal auth + browser)
pnpm --filter @neuve/perf-agent-cli run harness:capture -- "<prompt>" [--agent claude] [--base-url …] [--headed]
```

Trace schema is documented in `evals/traces/README.md`. Replay is byte-equivalent — verified by `diff` against the source file in both the `--from-report` path and a direct `head -N | jq -c | tail`.

## Handover notes

Delivered in this task:

- `scripts/replay-harness-trace.ts` — reads ndjson, re-emits verbatim to stdout, validates each line is parsable JSON before echoing.
- `scripts/capture-harness-trace.ts` — two modes: live execution via `layerSdk + Executor` with a `Stream.tap` diffing new events; or `--from-report` which converts an existing `.perf-agent/reports/*.json` into the ndjson format. Events are always converted to the schema in `evals/traces/README.md` including a terminal `stream_terminated` record with `reason` and `remainingSteps`.
- `evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson` — seed artifact, produced by the capture script from the failing report, used to prove the replay path.
- `evals/traces/README.md` — schema doc.
- pnpm script `harness:capture` registered in both `apps/cli/package.json` (so the DoD `pnpm --filter @neuve/perf-agent-cli` filter works) and `apps/cli-solid/package.json` (as the task scope required).
- This diary.

Important caveats for the reviewer:

- The capture script uses `bun` at the shebang (via the pnpm script) rather than `pnpm tsx`. Transitive imports from `@neuve/sdk/effect` → `@neuve/supervisor` → `@neuve/shared/observability/analytics` pull in `node-machine-id`, which ships as a UMD bundle and does not resolve under `pnpm tsx` in pure ESM mode. `bun` handles CJS/ESM interop natively. The replay script uses only Node built-ins, so `pnpm tsx scripts/replay-harness-trace.ts …` still works as the DoD specifies.
- Live capture consumes real API quota and requires `chrome-devtools-mcp` auth / a working browser just like a normal `perf-agent` run. For deterministic reviewer verification, the `--from-report` path replays an already-captured failure with no network calls.
- No runtime code was edited. `executor.ts`, `prompts.ts`, and `models.ts` are untouched. The `harness:capture` pnpm script entries are additive 1-liners that point at the new standalone script under `scripts/`.
- `executor.ts:238` and `prompts.ts:146-147, 270-278` are the edit targets for Wave 1.A (plan decomposer) and Wave 1.B (adherence gate). Both are left untouched here, per the task's non-goal.

Pending:

- 0.A was flagged to `team-lead` for one ambiguity: the task scope said "cli-solid package.json" but the plan DoD references `@neuve/perf-agent-cli` (which is `apps/cli`). I added the pnpm script to both packages so the literal DoD command succeeds without violating the scope note. If that is wrong I'll drop one of them.
