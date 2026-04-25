# Review: frontier-planner-removal — CLI Surface / Docs lane

Reviewer: `reviewer-surface` (team `frontier-planner-removal`)
Commits under review: `e18bccd7^..e71f5329` (9 commits, engineer-landed)
Post-review Lane A follow-ups observed on `HEAD` at time of review:
`35d2ff44`, `21637939`, `f241cbf6` (not in scope — those are Lane A's own
concern; noted only to explain HEAD drift).

## Verdict: APPROVE

No Critical or Major issues in the CLI-surface / docs / CHANGELOG / eval-rename
lane. One Minor (static-grep regression test rather than spawn-the-CLI snapshot)
that is non-blocking.

## Verification command results

### 1. CLI help surface proof (rebuild + real `--help` output)

Rebuilt both TUIs before inspecting help output (the pre-existing
`apps/cli-solid/dist/tui.js` was stamped `Apr 23 22:52` — i.e. stale from
before the removal — and predictably still advertised `--planner`; see
finding [INFO-1]).

```
$ pnpm --filter @neuve/perf-agent-cli build   # completed in 2400ms
$ node apps/cli/dist/index.js tui --help
Usage: perf-agent tui [options]

open the interactive testing TUI

Options:
  -m, --message <instruction>  natural language instruction for what to test
  -f, --flow <slug>            reuse a saved flow by its slug
  -y, --yes                    run immediately without confirmation
  -a, --agent <provider>       agent provider to use (claude, codex, copilot,
                               gemini, cursor, opencode, droid, pi, or local)
  -t, --target <target>        what to test: unstaged, branch, or changes
                               (default: "changes")
  --verbose                    enable verbose logging
  --browser-mode <mode>        browser mode: headed or headless
  --cdp <url>                  connect to an existing Chrome via CDP WebSocket URL
  --profile <name>             reuse a Chrome profile by name (e.g. Default)
  --no-cookies                 skip system browser cookie extraction
  --ci                         force CI mode: headless, no cookies, auto-yes, 30-minute timeout
  --timeout <ms>               execution timeout in milliseconds
  --output <format>            output format: text (default) or json
  -u, --url <urls...>          base URL(s) for the dev server (skips port picker)
  -h, --help                   display help for command
```

No `--planner`. PASS.

```
$ node apps/cli/dist/index.js watch --help
Usage: perf-agent watch [options]

watch for file changes and auto-run browser tests

Options:
  -m, --message <instruction>  natural language instruction for what to test
  -a, --agent <provider>       agent provider to use (claude, codex, copilot,
                               gemini, cursor, opencode, droid, pi, or local)
  -t, --target <target>        what to test: unstaged, branch, or changes (default: "changes")
  --verbose                    enable verbose logging
  --browser-mode <mode>        browser mode: headed or headless
  --cdp <url>                  connect to an existing Chrome via CDP WebSocket URL
  --profile <name>             reuse a Chrome profile by name (e.g. Default)
  --no-cookies                 skip system browser cookie extraction
  -u, --url <urls...>          base URL(s) for the dev server
  -h, --help                   display help for command
```

No `--planner`. PASS.

```
$ cd apps/cli-solid && bun build.ts   # stale dist rebuilt
$ bun dist/tui.js tui --help
Usage: perf-agent tui [options]

open the interactive TUI

Options:
  -a, --agent <provider>  agent provider to use (claude, codex, copilot, gemini,
                          cursor, opencode, droid, pi, or local) (default: "claude")
  -u, --url <urls...>     base URL(s) for the dev server — skips port picker
  -h, --help              display help for command
```

No `--planner`. PASS.

### 2. Surface invariant grep

```
$ grep -rn "plannerMode\|plannerModeAtom\|parsePlannerMode\|PlannerMode\|--planner\|PLANNER_MODES\|DEFAULT_PLANNER_MODE" apps/cli/src apps/cli-solid/src
(no output — zero hits)

$ grep -rn "plannerMode\|plannerModeAtom\|parsePlannerMode\|PlannerMode\|--planner\|PLANNER_MODES\|DEFAULT_PLANNER_MODE" apps/cli/tests apps/cli-solid/tests
apps/cli/tests/help-surface.test.ts:5:// Prevents the `--planner` CLI flag from coming back. ...
apps/cli/tests/help-surface.test.ts:19:    it(`${relativePath} does not register a --planner option`, () => {
apps/cli/tests/help-surface.test.ts:22:      expect(source).not.toContain("--planner");
apps/cli/tests/help-surface.test.ts:23:      expect(source).not.toContain("parsePlannerMode");
```

The only `--planner` / `plannerMode` / `parsePlannerMode` hits in `apps/` are
inside the regression test that *bans* those strings — i.e. string literals in
`expect(...).not.toContain(...)` assertions. All other references are gone.
PASS.

```
$ grep -rn "frontier" apps/cli/src apps/cli-solid/src
(no output — zero hits)
```

PASS.

### 3. Eval literal rename

```
$ grep -rn "\"frontier\"\|'frontier'" packages/evals/
(no output — zero hits)

$ grep -n 'frontier\|oracle-plan\|EVAL_PLANNER' packages/evals/evals/smoke.eval.ts packages/evals/evals/online-mind2web.eval.ts packages/evals/evals/wave-4-5-subset.eval.ts
packages/evals/evals/online-mind2web.eval.ts:74:  "EVAL_PLANNER",
packages/evals/evals/online-mind2web.eval.ts:75:  Schema.Literals(["oracle-plan", "template", "none"] as const),
packages/evals/evals/online-mind2web.eval.ts:76:  "oracle-plan",
packages/evals/evals/online-mind2web.eval.ts:89:  Schema.Literals(["oracle-plan", "template", "none"] as const),
packages/evals/evals/wave-4-5-subset.eval.ts:67:  "EVAL_PLANNER",
packages/evals/evals/wave-4-5-subset.eval.ts:68:  Schema.Literals(["oracle-plan", "template", "none"] as const),
packages/evals/evals/wave-4-5-subset.eval.ts:69:  "oracle-plan",
packages/evals/evals/wave-4-5-subset.eval.ts:86:  Schema.Literals(["oracle-plan", "template", "none"] as const),
packages/evals/evals/smoke.eval.ts:104:  "EVAL_PLANNER",
packages/evals/evals/smoke.eval.ts:105:  Schema.Literals(["oracle-plan", "template", "none"] as const),
packages/evals/evals/smoke.eval.ts:106:  "oracle-plan",
packages/evals/evals/smoke.eval.ts:125:  Schema.Literals(["oracle-plan", "template", "none"] as const),
```

All three eval harness files now use `Schema.Literals(["oracle-plan",
"template", "none"])` with `"oracle-plan"` as the default for both
`EVAL_PLANNER` and `EVAL_GEMMA_PLANNER`. No `"frontier"` literal remains.
PASS.

**`EVAL_PLANNER=frontier` backward-compat check:** The eval configs use
`stringWithSchemaDefault(...)` which decodes the raw env value against the
new `Schema.Literals(["oracle-plan", "template", "none"])`. An unchanged
`EVAL_PLANNER=frontier` in an existing shell will now surface a
`ConfigError`, not silently fall through. Task brief said "user asked for
full-remove; silently dropped is OK" — so this is the intended behavior.

### 4. CHANGELOG accuracy

```
$ cat CHANGELOG.md
# Changelog

All notable changes to the @neuve CLI and supporting packages land here.

## [Unreleased]

### Removed

- `--planner` CLI flag (both `tui` and `watch` subcommands). Gemma is now the
  only runtime planner; the agent plans and executes in a single loop.

### Changed

- Eval harness renames planner mode literal `"frontier"` → `"oracle-plan"` for
  clarity. Configure via `EVAL_PLANNER=oracle-plan` / `EVAL_GEMMA_PLANNER=oracle-plan`
  (formerly `frontier`).
- `@neuve/supervisor` no longer depends on `@ai-sdk/google`, `ai`, `zod`, or
  `@ai-sdk/provider`. Frontier planning lives in `@neuve/evals` and is
  reachable only via the eval A:B harness.
```

Checklist:
- `--planner` flag removal (both `tui` and `watch`) — **covered**, named verbatim.
- Gemma-only runtime, frontier planning moved to evals — **covered** in both
  the Removed and Changed sections.
- `"frontier"` → `"oracle-plan"` eval literal rename — **covered** with both
  env vars named.
- Supervisor dropping `@ai-sdk/google` / `@ai-sdk/provider` / `ai` / `zod`
  deps — **covered** by name.
- `### Removed` / `### Changed` headings under `## [Unreleased]` —
  **conventional, compliant**.

PASS.

### 5. Diary verification

Read `docs/handover/frontier-planner-removal/diary/execution-2026-04-24.md`
end to end.

**(a)** Claimed grep — `grep -rn "frontier\|PlanDecomposer\|plannerMode" packages/supervisor/src packages/typescript-sdk/src apps/cli/src apps/cli-solid/src` → reran, zero hits. **Matches.**

**(b)** Claimed `packages/supervisor/package.json` lists only `@effect/platform-node`, `@neuve/agent`, `@neuve/devtools`, `@neuve/shared`, `effect`, `oxc-resolver`, `pathe`, `simple-git`. I `cat`ed the file — exactly those 8 runtime deps. No AI SDKs. **Matches.**

**(c)** Pass counts:

| Package | Diary claim | Actual (clean tree) | Match? |
|---------|-------------|---------------------|--------|
| `packages/supervisor` | 86/86 | 86/86 | YES |
| `packages/evals` | 132/132 | 132/132 | YES |
| `apps/cli` | 144/159 (15 failed, pre-existing) | 144/159 (15 failed) | YES |
| `apps/cli-solid` | 584/584 | 584/584 | YES |

**Important caveat on the "clean tree":** `packages/shared/src/prompts.ts`
had an unrelated user WIP (duplicated `buildLocalAgentSystemPrompt` declaration)
leftover in the working tree — per the diary's own "Operational ambiguities"
§ this was a residue of a `git stash pop` early in C1. With that WIP present,
`pnpm --filter @neuve/supervisor test` drops to 71 tests (2 test *files* fail
to transform: `executor-adherence-gate.test.ts` + `watch.test.ts`) and
`pnpm --filter @neuve/evals test` drops to 111/132 (gemma-runner + real-runner
fail to transform). Apps/cli similarly drops to 110/118 because 3 files fail
to transform. After `git stash push` of prompts.ts + prompts.test.ts, every
suite hits the diary's numbers exactly. No branch-introduced regressions.

**(d)** None of the 15 pre-existing `apps/cli` failures reference `frontier`,
`plannerMode`, `--planner`, or the evals A:B harness. Verified by grepping
the full test output for those strings:
```
$ pnpm --filter @neuve/perf-agent-cli test 2>&1 | grep -iE "frontier|plannerMode|--planner"
(no output)
```
Failures are the same pre-existing set the diary calls out (`add-skill.test.ts`
binary-parsing tests, `browser-commands.test.ts` legacy "expect" branding,
`ci-reporter.test.ts` legacy "expect" branding, `install-perf-agent-mcp.test.ts`,
`update.test.ts`, `watch-notifications.test.ts`, `perf-agent-skill.test.ts`).
**Matches.**

### 6. Help-surface regression test quality

Read `apps/cli/tests/help-surface.test.ts`:

```ts
const CLI_SOURCES = [
  "apps/cli/src/index.tsx",
  "apps/cli/src/commands/watch.ts",
  "apps/cli-solid/src/tui.ts",
] as const;

describe("help surface regression", () => {
  for (const relativePath of CLI_SOURCES) {
    it(`${relativePath} does not register a --planner option`, () => {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      const source = fs.readFileSync(absolutePath, "utf8");
      expect(source).not.toContain("--planner");
      expect(source).not.toContain("parsePlannerMode");
    });
  }
});
```

This is a source-grep test, not an end-to-end `spawnSync(node, [distBin, "tui",
"--help"])` + assertion-on-stdout test. Per the review brief: "If
static-snapshot only, Minor." It's arguably slightly better than a static
snapshot — it literally bans the strings `"--planner"` and `"parsePlannerMode"`
appearing in the three files — but a future regression where the flag is
registered via a dynamically-constructed option string (e.g. a variable-fed
`program.option(...FLAG_NAME...)`) would not be caught. See finding [MINOR-1].

Ran the test in isolation:
```
$ pnpm --filter @neuve/perf-agent-cli test tests/help-surface.test.ts
Test Files: 1 passed (1)
      Tests: 3 passed (3)
```
PASS.

### 7. UI state cleanup completeness

Read `apps/cli/src/components/screens/testing-screen.tsx` — no `plannerMode`
in store reads (lines 424-433 enumerate `modelPreferences`, `browserHeaded`,
`browserProfile`, `cdpUrl`, `toggleNotifications`; no planner read);
`triggerExecute` args (lines 567-591) contain no `plannerMode`; useEffect dep
array (lines 596-611) lists every value it reads — no stale `plannerMode`
entry. PASS.

Read `apps/cli/src/components/screens/watch-screen.tsx` — store reads
(lines 45-48) are `agentBackend`, `verbose`, `browserHeaded`, `notifications`;
`watch.run(...)` options (lines 119-126) no `plannerMode`. PASS.

### 8. Preferences store

Read `apps/cli/src/stores/use-preferences.ts`:
- No `plannerMode` field, no `setPlannerMode` setter in the interface.
- `partialize` (line 72-77) persists `agentBackend`, `instructionHistory`,
  `notifications`, `modelPreferences` — no `plannerMode` was ever persisted.
- No migration hook (no `migrate:`, no `version:`). Existing users' on-disk
  `prompt-history` JSON would never have contained `plannerMode` (it was
  excluded from `partialize` per the audit), so no migration needed. Zustand
  tolerates unknown keys silently, so even a corrupted file with a
  `plannerMode` key will not crash.

PASS — no disk migration required, no crash risk.

### 9. cli-solid parity

- `apps/cli-solid/src/tui.ts` — already shown above, no `-p, --planner`.
- `apps/cli-solid/src/app.tsx` — no `plannerMode` / `plannerModeAtom` import
  or reference.
- `apps/cli-solid/src/context/runtime.tsx` — initializes only
  `agentProviderAtom` + `verboseAtom` in the shared `AtomRegistry`. No
  `plannerModeAtom`. PASS.
- `apps/cli-solid/src/routes/testing/testing-screen.tsx` — no `atomGet(plannerModeAtom)`
  calls; `executeFn` invocation (lines 91-115) passes only
  `changesFor`/`instruction`/`isHeadless`/`cdpUrl`/`profileName`/
  `cookieBrowserKeys`/`savedFlow`/`baseUrl`/`devServerHints`/`modelPreference`.
  No `plannerMode`. PASS.

### 10. Dist bundle check

Both built artifacts were re-generated before the help probes. Post-build:

```
$ grep -E 'plannerMode|--planner|parsePlannerMode' apps/cli/dist/index.js apps/cli-solid/dist/tui.js
(no output — zero hits in either bundle)
```

PASS.

## Findings

- **[INFO-1] Stale `apps/cli-solid/dist/tui.js` predating the removal** — The
  working tree shipped with a `dist/tui.js` timestamped `Apr 23 22:52` whose
  help output still advertises `-p, --planner <mode>` with default
  `"frontier"`. Rebuilding produced a clean bundle. The review brief itself
  said "Built outputs under `dist/` are stale until rebuilt so skip those,"
  so this is informational only — but the CI/release pipeline must
  rebuild `apps/cli-solid` (`bun build.ts`) before publishing, otherwise an
  end-user `npx perf-agent tui --help` from a stale cached artifact would
  still show the flag. Both `apps/cli/dist/index.js` (rebuilt) and the
  freshly-built `apps/cli-solid/dist/tui.js` are clean.

- **[MINOR-1] Help-surface regression test is source-grep, not end-to-end**
  (`apps/cli/tests/help-surface.test.ts`) — The test `readFileSync`s the
  three source files and asserts the strings `"--planner"` and
  `"parsePlannerMode"` are absent. Strictly, a future regression that
  registers the flag via a dynamically-constructed option (e.g.
  `program.option(\`${PREFIX}-planner <mode>\`)` or a config-driven option
  builder) would not be caught. The concrete risk is low — the audit's
  "Proposed removal order" doesn't leave any plausible dynamic-builder
  seam — but an `execFileSync("node", ["apps/cli/dist/index.js", "tui",
  "--help"]).toString()` snapshot-style assertion would be strictly stronger.
  Non-blocking: the diary already flags this trade-off ("`help-surface.test.ts`
  is source-grep-based … If a future reviewer prefers the snapshot approach,
  it'd need a pre-test `pnpm build` hook to keep the CI loop fast"), and the
  team-lead accepted that trade-off.

- **[INFO-2] Diary's pass counts depend on a clean working tree** — The
  diary's pass counts (86/86 supervisor, 132/132 evals, 144/159 apps/cli,
  584/584 cli-solid) reproduce exactly *only* when the unstaged WIP in
  `packages/shared/src/prompts.ts` (duplicate `buildLocalAgentSystemPrompt`
  declaration) is stashed. With that WIP in the tree, 5 test files across
  three packages fail to transform (not because of branch changes — because
  of the duplicate-export syntax error). The diary's "Operational
  ambiguities" §  explicitly calls this out and preserves the WIP under
  `stash@{0}`, so this is disclosure-complete. Informational only — the
  branch itself is clean; the WIP is unrelated to the frontier-planner
  removal.

- **[INFO-3] Post-review Lane A follow-ups already on HEAD** — Three
  commits landed on `main` between the initial review request and my
  verification pass: `35d2ff44 fix(evals): update PlannerConfigError
  guidance to EVAL_PLANNER=oracle-plan`, `21637939 test(evals): port
  plan-decomposer suite to @neuve/evals`, and `f241cbf6 docs(diary): record
  backend-lane reviewer patches P1+P2`. All three touch Lane A (packaged
  in `packages/evals/src/planning/` or the supervisor diary). None affect
  my lane's files. Spot-checked `packages/evals/src/planning/errors.ts`:
  the `PlannerConfigError` message now correctly instructs
  `EVAL_PLANNER=oracle-plan`, not the now-stale `EVAL_PLANNER=frontier`.
  Noted for the Lane A reviewer, not blocking here.

## Suggestions (non-blocking)

- Upgrade `apps/cli/tests/help-surface.test.ts` to spawn the built CLI
  (`execFileSync("node", [distPath, subcommand, "--help"])`) and assert
  the resulting stdout does not include `--planner`. That catches any
  future dynamic option registration at a minor CI cost (~300ms per
  subcommand after a prerequisite `pnpm build --filter @neuve/perf-agent-cli`).
- Add a `[MIGRATION]` note to the CHANGELOG for anyone who has
  `EVAL_PLANNER=frontier` in a local `.env` or CI secret — with the new
  schema-validated config, that value now surfaces a `ConfigError` at
  eval-startup time. A one-line "If your eval shell sets
  `EVAL_PLANNER=frontier`, rename it to `oracle-plan`" bullet would
  prevent a surprise first-failed-eval after a `git pull`.
- Consider moving `apps/cli-solid` onto the same `vp` test harness as
  the rest of the monorepo so `pnpm -r test` runs it via `pnpm --filter`
  selectors (currently it's `bun test` run from the package dir, which
  sidesteps the filter-based verification flow the review brief assumed).
  Unrelated to this PR but noticed during the pass-count cross-check.
