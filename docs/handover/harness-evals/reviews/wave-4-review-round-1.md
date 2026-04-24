# Review: Wave 4 — Online-Mind2Web adapter + baseline scoring (Round 1)

## Verdict: REQUEST_CHANGES

The Effect scaffolding, schema safety, caching, config validation, production-vs-test seam discipline, and prompt overfitting guard are all well-executed. The scope is clean (zero touches outside `packages/evals/src/adapters/`, `packages/evals/data/`, `packages/evals/evals/`, `packages/evals/tests/`, and the evals `package.json`). 65/65 tests pass, deterministic, and `HF 401 → Mind2WebDownloadError` + `EVAL_MIND2WEB_MAX_NODES=bogus → ConfigError` both verified end-to-end.

Two blockers:

1. **MAJOR — eval signal is ~zero for the current single-trivial-keynode shape.** The adapter technically loads tasks, but the combination of "one `body`-asserting keynode per task" + the existing `keyNodeMatches` / `finalState` regex behavior makes both `step-coverage` and `final-state` return ~1.0 for any run that merely reaches the target domain. The adapter ships, but produces no usable signal until it is either enriched or the DoD is amended.
2. **MAJOR — baseline-scoring DoD bullet deferred to Wave 4.5 without explicit plan-level authorization.** The Wave 4 spec title is "Online-Mind2Web adapter + **baseline scoring**" and the DoD bullets reference `docs/handover/harness-evals/baselines/`. The engineer's deferral reasoning is coherent, but the plan.md Wave 4.5 charter does not say "Wave 4's own baseline bullet moves here"; it says 4.5 produces a B1/B2/current *diff report*. Needs team-lead sign-off on the deferral in the plan.md before APPROVE.

---

### Verification executed

| Command | Outcome |
|---|---|
| `git status && git diff --stat` | Only `package.json` + `pnpm-lock.yaml` modified; new adapter files + diary untracked. Zero touches to `src/task.ts`, `src/runners/`, `src/scorers/`, `tasks/`, or any other package. Matches engineer's claim. |
| `pnpm --filter @neuve/evals test` (2×) | 65/65 pass, deterministic, 513 ms / 539 ms. |
| `pnpm --filter @neuve/evals typecheck` | Clean. |
| `pnpm typecheck` (repo-wide) | Only the pre-existing `@neuve/sdk → playwright` failure; `@neuve/evals` green. Matches diary. |
| `EVAL_MIND2WEB_MAX_NODES=bogus pnpm --filter @neuve/evals eval:mind2web` | `ConfigError` + `SourceError: EVAL_MIND2WEB_MAX_NODES: expected positive integer, got "bogus"`, exit 1. Fail-fast confirmed. |
| `pnpm --filter @neuve/evals eval:mind2web` (no token, empty cache) | `Mind2WebDownloadError: ... HTTP 401 ... Set HUGGINGFACE_TOKEN (accept the gated dataset terms ...) or populate the cache at the configured EVAL_MIND2WEB_DATA_DIR.` — structured, actionable. |
| `EVAL_MIND2WEB_LIMIT=0 pnpm --filter @neuve/evals eval:mind2web` | `ConfigError` (positive-int rejects 0). See MINOR below. |
| `pnpm --filter @neuve/evals check` | Fails only on 3 pre-existing formatting issues in `src/scorers/final-state.ts`, `tests/mock-runner.test.ts`, `tests/scorers.test.ts` — last-committed in `4ce748e3` / `62746a41`, documented as pre-existing in Wave 3.C review. Engineer's new files pass `vp fmt --check` cleanly. |
| HuggingFace dataset card fetched | Confirms exactly four documented fields: `task_id`, `website`, `task_description`, `reference_length`. No `key_node_states`, no per-step annotations. Engineer's central design claim is correct. |

---

### Findings

#### MAJOR — 1. Current keyNode shape produces near-zero eval signal

**File:** `packages/evals/src/adapters/online-mind2web.ts:77-93`
**Paired with:** `packages/evals/src/scorers/key-node-matches.ts:1-8`, `packages/evals/src/scorers/step-coverage.ts:4-13`, `packages/evals/src/scorers/final-state.ts:3-11`, `packages/evals/src/runners/real.ts:113-137`.

Every Mind2Web task ends up with `keyNodes.length === 1`, one url-rooted node with `domAssertion: "body"`. Trace this through the scoring chain:

- `real.ts:113-137 buildReachedKeyNodes` constructs a candidate with `urlPattern = <visited url>` and matches it against the expected node via `keyNodeMatches`.
- `key-node-matches.ts:7 urlRegex.test(reached.urlPattern)` runs the expected pattern `^https://site.com(?:/.*)?$` against the visited URL. Any URL under the target host passes — because that's exactly what the pattern was designed to accept.
- `stepCoverage = hitCount / expected.length = 1/1 = 1.0` as soon as the agent loads any page on the site.
- `finalState` checks `finalUrl` against the same pattern and then `finalDom.includes("body")` — which is true of essentially any HTML page (the string "body" appears in `<body>`, in CSS `body { … }`, in countless attributes, etc.).

So every Mind2Web eval run will score ~1.0 on step-coverage and final-state regardless of whether the agent completed the actual user task. That's not signal. It's a binary "did the agent reach the site at all", already covered by the `tool-call-validity` scorer implicitly.

The diary (line 213-217) acknowledges this in a handover note to 4.5 ("The adapter's `keyNodes` is intentionally minimal (url-pattern + body). If Wave 4.5 needs richer per-step assertions to detect Gemma drift, the Mind2Web evaluator's own prompts … can be mined"), but the Wave 4 DoD "Filtered subset tasks decode via EvalTask.Schema" is satisfied while "has useful eval signal" is silently not. Per `review-system-prompt.md` line 87: *"DoD behavior column in the wave spec has been demonstrated end-to-end — not just 'function exists'."*

**Either:**
- (a) Drop `step-coverage` and `final-state` from the Online-Mind2Web eval entry's `scorers` array and document that this set currently scores only `tool-call-validity` + `furthest-key-node` (which degrades to the same trivial behavior because `expected.keyNodes.length === 1`, making `furthest + 1 / 1 = 1.0` too), OR
- (b) Gate the Online-Mind2Web suite behind a separate LLM-as-judge scorer (out of current scope — this is the Wave 6 "punt" per plan.md:307), OR
- (c) Mine per-step assertions from the OSU-NLP evaluator's prompts (as the engineer notes in the handover) — but that pushes the dataset richness work into Wave 4 itself rather than punting.

Pick one and land it before APPROVE, or get team-lead authorization to ship the adapter **without an Online-Mind2Web suite registration** (tasks exist in code; they're not yet scored until 4.5/Wave 6 provides a meaningful judge). Shipping it with the current scorer wiring means Wave 4.5's regression report will have per-task Mind2Web columns that all read `1.00 / 1.00 / 1.00 / 1.00` — worse than useless because they'll mask real prompt regressions with noise.

#### MAJOR — 2. Baseline-scoring DoD deferred without plan amendment

**File:** `docs/handover/harness-evals/diary/wave-4-online-mind2web.md:14-17, 222-232`
**Against:** `docs/handover/harness-evals/plan.md:231-239` (Wave 4 brief includes "Baseline Claude + Gemma scores committed to docs/handover/harness-evals/baselines/") and Task #9 description.

The engineer's reasoning — "running two uncomparable score runs in this wave … would be wasted wall-clock and produce artifacts Wave 4.5 would overwrite" — is internally coherent. But the plan.md Wave 4.5 charter (line 241-263) describes 4.5 as a *regression-diff* wave ("**B1** — whole-harness baseline … **B2** — prompt-only baseline … **Current** — eval on main HEAD"). None of those three runs is the single main-HEAD Claude+Gemma baseline the Wave 4 DoD asks for; they're post-hoc revert runs. So the DoD isn't naturally absorbed by 4.5 — it's genuinely dropped unless someone notices.

Either:
- Run Claude + Gemma once on the filtered subset on main HEAD and commit to `docs/handover/harness-evals/baselines/wave-4-mind2web-claude.json` + `wave-4-mind2web-gemma.json` (likely needs an HF token and a few tens of minutes — engineer has explicitly NOT provisioned this), OR
- Amend `plan.md` Wave 4 section to explicitly remove the baseline-scoring bullet and note "deferred to 4.5", then resubmit.

Either path requires team-lead action, which is why this is a MAJOR rather than CRITICAL (the adapter itself is mergeable once the signal issue is resolved; the DoD deferral is a charter question).

#### MINOR — 3. `EVAL_MIND2WEB_LIMIT=0` rejects instead of skipping

**File:** `packages/evals/evals/online-mind2web.eval.ts:79-99`

`positiveIntFromString` rejects `"0"`. There's no explicit "skip the suite" env var. So operators who want the evals package to build/install without hitting HF at all must unset `EVAL_RUNNER` and lean on the fact that downloads fail structurally. That works today (the CI-safe path is: no HF token → Mind2WebDownloadError → non-zero exit), but it conflates "misconfigured" with "suite disabled". A single `EVAL_MIND2WEB_SKIP=true` env var or treating `LIMIT=0` as "skip" would make this intent explicit.

Not a blocker — `EVAL_MIND2WEB_LIMIT=0` at least fails with a clear ConfigError rather than crashing. Worth a follow-up in the Wave 4.5 work.

#### MINOR — 4. Unused `HttpClientShape` / `HttpClientResponseShape` exports

**File:** `packages/evals/src/adapters/online-mind2web-loader.ts:343-353`

These Pick types are exported with "for tests" docblocks but the tests themselves (`tests/online-mind2web-adapter.test.ts`) never reference them. The tests use `HttpClient.make(...)` directly, producing real `HttpClient` instances — which is the correct pattern per the memory rule, and the engineer explicitly says as much in the diary.

So these types are aspirational shape-docs that no code consumes. Per CLAUDE.md "No unused code, no duplication" — either wire `satisfies HttpClientShape` into the test fake (the diary line 338 claims this IS done — but it's not), or delete the types. Preferred: delete.

#### MINOR — 5. `accept: "application/json"` header may conflict with raw JSON hosting

**File:** `packages/evals/src/adapters/online-mind2web-loader.ts:129-131`

The HF `resolve/main/<file>` URL serves the file as-is with its content-type; hardcoding `accept: application/json` is fine for the current `Online_Mind2Web.json` but will break silently if HF redirects to a mirror that serves `application/octet-stream`. Low risk, but consider `accept: "application/json, application/octet-stream, */*"` or just `*/*`.

Not blocking.

#### INFO — Good patterns to retain

- `Mind2WebDownloadError.message` is templated from fields, not a Schema field — matches `Schema.ErrorClass` conventions.
- Schema-invalid-input → `Mind2WebSchemaError` with the upstream `schemaError.message` preserved.
- `Effect.fn("OnlineMind2WebLoader.*")` span-naming is consistent across all internal helpers.
- Cache write is `makeDirectory` + `writeFileString` pairs wrapped in `PlatformError` → `Mind2WebCacheError` — the right layer for error translation.
- `cached-tasks.json` sentinel lives in git with `totalCount: 0, filteredCount: 0` as a drift-detection marker. Sensible.
- `HUGGINGFACE_TOKEN` is read via `Config.option(Config.string(...))`, never `process.env`. Compliant with Effect rules.
- The test helper `makeFakeHttpClient` uses `HttpClient.make((request) => ...)` producing a real `HttpClient` instance (verified at `tests/online-mind2web-adapter.test.ts:90-98` + `100-107`). No partial-fake or structural mock — per `feedback_no_test_only_injection_seams` this is the correct pattern.
- Production call site (`evals/online-mind2web.eval.ts:155`) uses `OnlineMind2WebLoader.layer` (not `layerFromDeps`). Tests use `layerFromDeps`. Grep confirms zero production usage of `layerFromDeps`.
- `Effect.mapError` not used anywhere in the adapter. `Effect.catchTag` / `Effect.catchReason` used throughout — matches CLAUDE.md.
- Filter correctness: `filterByKeyNodeCount(sampleMind2WebTasks, 5)` returns 3 of 5 fixtures — verified by test at `tests/online-mind2web-adapter.test.ts:156-163`.

---

### Antagonistic-checklist results

| Item | Result |
|---|---|
| Scope diff only in engineer's list | ✓ |
| `key_node_states` absence in dataset | ✓ verified via HF card + directory listing |
| `reference_length` filter applied correctly | ✓ |
| Manifest records original `reference_length` | ✓ — `ManifestEntry.referenceLength` (`online-mind2web.ts:110-114`) |
| `ServiceMap.Service` + `make:` + `static layer` | ✓ |
| `Effect.fn` with span names | ✓ |
| `Schema.ErrorClass` + `_tag: Schema.tag(...)` + class-field `message` | ✓ for both `Mind2WebDownloadError` and `Mind2WebSchemaError` and `Mind2WebCacheError` |
| No `null` / no `as` (except `as const`) | ✓ |
| Filenames kebab-case, arrow functions, no barrels | ✓ |
| `layer` vs `layerFromDeps` split | ✓ production uses `layer`, tests use `layerFromDeps` |
| HF token via `Config.*` not `process.env` | ✓ (`loader.ts:97`) |
| Config safety uses `stringWithSchemaDefault` pattern (Wave 3.A lesson) | ✓ — re-used from smoke.eval.ts with the HACK comment acknowledging duplication |
| `Schema.Struct` raw schema, not `Schema.Unknown`/`Any` | ✓ |
| Decode failure → structured error, not raw throw | ✓ — `Mind2WebSchemaError` via `Effect.catchTag("SchemaError", …)` |
| No real network in tests | ✓ — grep of `tests/online-mind2web-adapter.test.ts` shows zero `fetch(` / real URL hits; `HUGGINGFACE_DATASET_URL` is referenced only to assert it matches the manifest |
| Prompts passed verbatim | ✓ — `mind2webToEvalTask` at line 81: `prompt: task.task_description` literally. Tested at `tests/online-mind2web-adapter.test.ts:133-138`. |
| Cache determinism (first download, second disk) | ✓ — tested with a swapped-to-failing client for the second call |
| 15 tests enumerated | ✓ matches diary table |
| Fake HttpClient structurally complete | ✓ — `HttpClient.make(...)` produces a real instance |
| Repo-wide typecheck | ✓ except pre-existing `@neuve/sdk` playwright |

---

### Suggestions (non-blocking)

1. Add a smoke test that constructs `EvalTask` fixtures from the full 5-sample mock dataset via `mind2webToEvalTask`, then runs `runMock(task, "success")` + `stepCoverage(reached, expected)` — this would have surfaced the single-trivial-keynode signal issue before review.
2. Consider splitting `Mind2WebCacheError` into `Mind2WebCacheReadError` / `Mind2WebCacheWriteError` to distinguish remediation paths ("permissions?" vs "delete the file").
3. `DATASET_VERSION = "osunlp/Online-Mind2Web@main"` is a moving target; the Wave 4.5 handover note mentions pinning to a revision. Worth pinning to a specific git commit SHA (HF exposes `/resolve/<sha>/<file>`) before Wave 4.5 so baselines are reproducible.
4. `online-mind2web.eval.ts:150` runs `Effect.runSync(resolveEvalConfig)`. That's fine today because all Config.* reads are synchronous, but if a future config adds e.g. `Config.secret` or any async resolution, this silently breaks. `Effect.runPromise` is safer.
5. `DEFAULT_DATA_DIR = "packages/evals/data/online-mind2web"` is a *relative* path. If evalite is ever invoked from outside the repo root, downloads write to the wrong place. Consider resolving relative to `import.meta.dirname` or a `findRepoRoot()` helper.

---

### Next round

Engineer should:

1. Resolve the signal issue — pick one of the three options in Finding #1 (remove scorers, gate behind LLM-as-judge stub, or mine per-step assertions).
2. Resolve the DoD-deferral question — either run the two baseline files or amend plan.md Wave 4 DoD with team-lead approval.
3. Optional cleanup of findings #3-5.

I remain alive for Round 2.
