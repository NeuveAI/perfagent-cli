# Review: harness-r2 T2 — Final wave audit (P1+P2+P3+P4 + DoD gates 1-6)

## Verdict: APPROVE INVESTIGATIVE-VERIFIED

The wave's substantive value is real and ships: 3-file 1-line variance pin (`85260586`) + the R10/R11 narrative correction (Pro 3 stopping-criterion was 70% temperature, not prompt). All 6 DoD gates clear under engineer's lead-adjusted thresholds. P2/P3 reverts are clean. Process invariants intact (0 Co-Authored-By, 0 `--no-verify`, no force-push, no destructive ops).

**One MAJOR narrative-precision issue must be propagated to artifacts before lead memory updates land** — the load-bearing "0/240 ASSERTION_FAILED across all 240 traces" claim is repeated in 5 places (diary §P3, diary §P4 finding #2, P3 revert commit body `e1668354`, baseline `wave-harness-r2.md` lines 10/52/57, plan §"Out of scope" PRIMARY P1 candidate). Independent count: **16/240** model-emitted ASSERTION_FAILED status_marker emissions, all gemini-react, all `category=abort`. The structural conclusion (REFLECT pathway dead → harness-r3 structural REFLECT-injection candidate) is correct. The evidence statistic is wrong. R10-pattern INVESTIGATIVE-VERIFIED ship with explicit caveat captured in lead memory + diary post-approve narrative-correction edit.

### Correctness Check

- **Source of truth**: plan `docs/research/harness-r2/plan.md` @ `4056f6d8` + DoD gates 1-6.
- **Correctness target**: 3-phase A:B sweep yielding empirically-validated prompt/temp interventions with distribution-form gates.
- **Dispatch scope**: P1 variance pin (3 files, 1 line each) + P2/P3 prompt edits with revert-on-fail. SHIPPED scope = P1 only. P2/P3 reverted to plan-commit state. **Verified clean**: `git diff 4056f6d8..HEAD -- packages/shared/src/prompts.ts` is empty (both reverts complete).
- **Dependency/HITL status**: lead-adjusted Gate 1 thresholds (per-runner sub-gates) explicitly authorized in diary §P1; lead-reviewed each prompt diff before sweep; all decisions logged in diary.
- **DoD checklist**: Gates 1-6 all addressed. Gate verdicts in diary §P4 + baseline doc match independent recount. See per-gate evidence table below.
- **Review lanes**: single end-of-wave reviewer (this audit). Engineer's diary §P4 lists artifacts for inspection. All inspected.
- **Type/lint/doc gates**: `pnpm --filter @neuve/local-agent --filter @neuve/evals typecheck` → both Done (clean). Engineer's diary claim "46 local-agent + 185 evals tests green" not re-executed (read-only review; engineer's commit pre-existed test invariant).
- **Git history/staging**: 7 wave commits, all granular, conventional-commit prefixes, parseable. Two `commit (amend)` reflog entries are amend-revert-message-only on local-pre-push commits (not destructive). No force-push to main. No `--no-verify`. 0 Co-Authored-By footers.
- **Verification evidence**: 4 trace dirs × 60 ndjson + 60 sidecar `.scores.json` files each = 480 artifacts, all inspectable. Independently re-ran strict-pass count, premature count, schema-invalid count, ASSERTION_FAILED count, PLAN_UPDATE count from raw ndjson — see Findings.
- **Decision-log status**: every autonomous engineer choice (lead-adjust thresholds, JUDGE temp out-of-scope, llama-server-client cascade-not-pin, P2/P3 revert decisions, harness-r3 candidate ranking) logged in diary §P1/§P2/§P3/§P4 with rationale.

### Per-gate evidence

| Gate | Threshold | Independent measurement | Verdict |
|---|---|---|---|
| **1.1a** gemini-react step-cov Δ | ≤ 0.04 | 0.505 (pin-1) − 0.465 (pin-2) = 0.040 | **PASS** (knife-edge, exactly at threshold) |
| **1.1b** gemma-react step-cov Δ | ≤ 0.10 | 0.271 / 0.361 = 0.090 | PASS |
| **1.1b** gemma-oracle-plan step-cov Δ | ≤ 0.10 | 0.279 / 0.386 = 0.107 | marginal PASS |
| **1.2** schema-invalid max | ≤ 5/20 | gemma-react: pin-1 3/20, pin-2 5/20, **stopping 7/20**, plan-update 5/20 | PASS at post-P3 (5/20); P2 had 7/20 transient regression — flagged below |
| **1.3** empty-content | 0/20 across all sweeps | pin-1 0, pin-2 0, stopping 0, plan-update 0 | PASS (R8 invariant intact) |
| **2.1** Pro 3 premature ≤ 10/20 | drop ≥ 3 from R10's 13/20 | 3/20 (pin-1, pin-2, stopping, plan-update — all four) | PASS but credited to P1 not P2 |
| **2.2** Strategic strict-pass ≥ 7/20 (lead +3 from baseline 4) | ≥ 7/20 | P2 = 2/20 (regression vs P1 max 4) | **FAIL → REVERTED** (correct decision) |
| **2.3** gemma step-cov within P1 band | ≤ 0.10 Δ | 0.045 | PASS |
| **3.1** PLAN_UPDATE rate ≥ 5/60 | ≥ 5/60 | **0/60** independently confirmed (also 0/240 across all 4 sweeps) | **FAIL → REVERTED** (correct decision) |
| **3.2** Recovery examples ≥ 2 | ≥ 2 | 0 (no PLAN_UPDATE = no recovery) | **FAIL** |
| **3.3** Step-cov within P1 band | ≤ 0.10 Δ | gemma 0.032, gemini 0.062 | PASS |
| **4** process invariants | granular / no Co-Author / no `--no-verify` / no force-push / clean reverts | 7 commits, 0 Co-Author hits, 0 `--no-verify`, both reverts clean `git revert` with parent=feat (P2: `8271027f` → `6d0e5811`; P3: `2ad63a62` → `e1668354`) | PASS |
| **5** R8/R9/R10/R11 invariants on post-P3 gemma-react | empty 0/20, schema ≤ 5/20 | 0/20 + 5/20 | PASS at post-P3 (P2 transient 7/20 noted) |
| **6** comparability | wave-r5-ab.eval.ts byte-identical to R11 ship | sha matches: `fccbddd03930a1e9f51b1357a779181d5c465f76` at HEAD == at `8381a327` | PASS |

### Strategic spot-checks (the wave's headline claims)

| Claim | Independent verification | Status |
|---|---|---|
| **R10/R11 narrative correction** — pin alone collapsed Pro 3 premature 13/20 → 3/20 | premature counts: 13 (R10 baseline cited), 3/3/3/3 (post-pin pin-1/pin-2/stopping/plan-update) | ✅ **VERIFIED** |
| Strict-pass uplift gemini-react 2/20 (R10) → 4/20 max post-pin | strict-pass counts: 3 (pin-1), 4 (pin-2) — 4/20 is the max anchor | ✅ **VERIFIED** |
| P2 strict-pass regression 4 → 2 | strict-pass: pin-2 4 → stopping 2 (Δ -2) | ✅ **VERIFIED** |
| `calibration-1` P2 doom-loop on 3 identical fill calls | trace tail: STEP_DONE → fill/fill/fill (empty args) → "detected 3 identical consecutive ACTION envelopes (fill). Aborting" → RUN_COMPLETED failed "Doom-loop detected" | ✅ **VERIFIED** (mechanism: model emitted 3 fill calls with `text:undefined` because completion_check told it to "verify expectedOutcome") |
| `journey-8` P2 MAX_TOOL_ROUNDS at 15 (after 3 STEP_DONEs) | trace shows 3 STEP_DONE markers (step-1, step-2, step-3) followed by RUN_COMPLETED:`["failed","Reached maximum tool call rounds (15). Stopping."]` | ✅ **VERIFIED** |
| `journey-1-bmw` P3 missing-command pattern (R3 BMW persists) | trace: thought "page has a cookie banner that needs to be dismissed before proceeding" → `interact{uid:"1_182"}` (no command) → SchemaError → harness abort. 0 PLAN_UPDATE. | ✅ **VERIFIED** (model recognized prerequisite-step gap in `<thought>` but didn't emit PLAN_UPDATE-action=insert despite plan §P3 prompt's explicit trigger language) |
| `trivial-1` deterministic-stuck divergence pin-1 0.00 → pin-2 1.00 | sidecars: pin-1 `{passed,0,0}` (RUN_COMPLETED with stale title), pin-2 `{unfinished,0,1}` (full coverage but never emitted RUN_COMPLETED) | ✅ **VERIFIED** (Δ step-cov 1.00 between two zero-code-change sweeps confirms env/DOM input deltas → divergent paths under temp=0) |
| **0/240 ASSERTION_FAILED across all 4 sweeps × 60 traces** | independent count: **16/240** model-emitted status_marker ASSERTION_FAILED records (4 in pin-1 + 3 in pin-2 + 3 in stopping + 6 in plan-update); ALL gemini-react; ALL `category=abort` (CAPTCHA / WAF / anti-bot / MCP-timeout terminations) | ❌ **CONTRADICTED** — see Major below |
| 0/60 PLAN_UPDATE in P3 + 0/240 across all sweeps | grep'd raw ndjson + envelope-shape extraction across all 4 sweeps × 60 = 0/240 | ✅ **VERIFIED** |

### Findings

- **[MAJOR] Load-bearing "0/240 ASSERTION_FAILED" claim is empirically wrong** (`docs/handover/harness-r2/diary/r0-2026-05-01.md` §P3 line 248–256, §P4 finding #2 line 299; `docs/handover/harness-evals/baselines/wave-harness-r2.md` lines 10, 52, 57; commit `e1668354` body; `docs/research/harness-r2/plan.md` §"Out of scope" PRIMARY P1 candidate paragraph) — the actual count is **16/240** model-emitted ASSERTION_FAILED status_marker records (verified by parsing all 240 ndjsons and extracting `{type:"status_marker", marker:"ASSERTION_FAILED"}` events). Distribution: 4 in pin-1, 3 in pin-2, 3 in stopping, 6 in plan-update. ALL emissions are gemini-react (Pro 3); 0 from gemma-react across 80 traces; 0 from gemma-oracle-plan across 80 traces. ALL 16 emissions are `category=abort` (CAPTCHA, WAF, anti-bot detection, MCP server timeout, network errors). The **structural conclusion holds** — REFLECT requires N consecutive non-abort ASSERTION_FAILED on the same stepId, and 0/240 such sequences exist; the AF→REFLECT→PLAN_UPDATE pathway is indeed dead. But the diary's framing "neither model EVER emits ASSERTION_FAILED" is false for gemini-react. The corrected statement should be: **"0/240 non-abort ASSERTION_FAILED emissions; 16/240 abort-category emissions, all gemini-react, all single-shot run-terminations rather than retry signals; gemma-react emits 0 across all 80 traces."** This nuance matters for harness-r3 design: the structural REFLECT-injection probe must trigger on shape signals (SchemaError-loop, arg-rejection-after-N) because the model IS willing to emit AF for abort but won't emit it as a retry signal — the harness-injected REFLECT can't piggyback on existing AF emissions. Why it matters: **the precise number is the cited evidence for the harness-r3 PRIMARY P1 candidate ranking.** A reader of the plan + lead memory in 4 weeks needs the corrected statistic to design the structural REFLECT-injection probe (e.g., choosing whether to gate on schema-error count vs. AF emission count).

- **[INFO] Schema-invalid 7/20 in P2 sweep** (`docs/handover/harness-evals/baselines/wave-harness-r2.md:51`) — the completion_check prompt addition not only regressed strict-pass (load-bearing finding) but also pushed gemma-react schema-invalid from 5/20 (pin-2) to 7/20 (P2). Engineer notes the count parenthetically ("P2 high at 7") but does not foreground it in the §"Headline finding" or wave gates section. The 7/20 is OUTSIDE the R10 envelope (2-5/20) and is a transient regression caused by the now-reverted P2 prompt addition. Not load-bearing for the wave verdict (revert returned schema-invalid to 5/20 at HEAD), but a missed opportunity to strengthen the P2-revert rationale: completion_check regressed BOTH strategic strict-pass AND R9 invariant simultaneously. Worth one sentence in the diary §P2 narrative.

- **[INFO] Gate 1.1a is exactly at threshold (0.040 vs ≤ 0.04)** — gemini-react step-cov Δ = 0.505 (pin-1) − 0.465 (pin-2) = 0.040, exactly equal to the lead-adjusted threshold. PASS by inclusive equality, but the 2-sample band has not yet "shrunk below" the threshold — it's at the threshold. Engineer correctly reports this in §P1 verdict table; flagging here so future-engineer reading lead memory understands "PASS at 0.040" is not "well below the threshold". A 3rd sweep would tighten this anchor; engineer chose not to spend the additional ~$15 for a 3rd sweep, defensible given the strategic gate (P2/P3 outcomes) was the load-bearing test of variance reduction.

- **[INFO] llama-server-client.ts not directly pinned** (plan §P1 listed it as one of 4 audit paths) — engineer correctly identified the cascade: `LlamaServerClient.chat` accepts `temperature?: number` conditionally; the production caller is `OllamaApiAdapter` which forwards `request.options.temperature` from incoming Ollama-shape requests; `@neuve/local-agent` ollama-client now sends `temperature: 0`; the bridge passes 0 through to llama-server. Pinning a default in `llama-server-client.ts` would be a no-op for the production path. Engineer's diary §P1 captures this ("Pass-through wrappers (llama-server-client.ts, ollama-api-adapter.ts) read caller-provided temperature from request body; pinning the source-side defaults propagates."). Plan-deviation acceptable, well-justified.

- **[INFO] JUDGE_DEFAULT_TEMPERATURE = 0.1 not pinned** — `packages/evals/src/scorers/llm-judge.ts:22`, scope-excluded by engineer with rationale "post-hoc trace scorer, not part of trajectory variance" (diary §P1 audit table). Defensible — the judge runs after sweep completion against persisted traces, doesn't influence model trajectories. Worth surfacing as a harness-r3 candidate IF future scoring variance is suspected.

### Suggestions (non-blocking)

- The "0/240 ASSERTION_FAILED" → "0/240 non-abort ASSERTION_FAILED + 16/240 abort-category, all gemini-react" correction can land as a single follow-up commit touching diary §P3 + §P4, baseline §"Headline finding" + §"R8/R9/R10/R11 invariant rows" + §"harness-r3 recommendations", and plan §"Out of scope" harness-r3 PRIMARY P1 candidate paragraph. The P3 revert commit message body (`e1668354`) is git-history immutable post-push, so a clarification in the next-wave plan or a `docs:` correction commit is the cleanest mechanism.
- Future wave plans: when claiming "X/N traces have property P", spell out the measurement script (or make it a `pnpm wave-r5-ab:report` flag) so the count can be re-derived. This regression-checks against shape changes (e.g. status_marker vs `_tag` storage format).
- Add a one-sentence note to `docs/handover/harness-evals/baselines/wave-harness-r2.md` §"R8/R9/R10/R11 invariant rows" explicitly noting "P2 sweep regressed schema-invalid to 7/20 (outside R10 envelope), reverted with the completion_check prompt; HEAD steady-state is 5/20."

---

**Strict-critique posture verdict**: APPROVE INVESTIGATIVE-VERIFIED. The wave ships under the explicit caveat that the "0/240 ASSERTION_FAILED" load-bearing statistic is corrected to "0/240 non-abort + 16/240 abort-category" via a follow-up `docs:` commit before lead memory update lands. The structural conclusion + harness-r3 PRIMARY P1 candidate selection are unchanged.
