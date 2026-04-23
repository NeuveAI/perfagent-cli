# Pre-wave — Fix vite-plus config loader breaking `pnpm check` repo-wide

Task #11. Fixed. Diff: 1 file renamed (`vite.config.ts` → `vite.config.mjs`).

## Repro

`pnpm check` at repo root, Node v22.14.0, vite-plus 0.1.12:

```
@neuve/shared:check: error: Formatting could not start
@neuve/shared:check: Failed to load configuration file.
@neuve/shared:check: /Users/vinicius/code/perfagent-cli/vite.config.ts
@neuve/shared:check: Ensure the file has a valid default export of a JSON-serializable configuration object.
```

Parallel failures across `@neuve/shared`, `@neuve/cookies`, `@neuve/evals` — every package that runs `vp check`.

Running `vp lint` directly surfaced the underlying Node error:

```
Failed to parse oxlint configuration file.
  x Failed to load config: /Users/vinicius/code/perfagent-cli/vite.config.ts
  | TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for ...vite.config.ts
  |     at Object.getFileProtocolModuleFormat ...
```

## Root cause

`vp check` invokes the native `oxfmt` and `oxlint` binaries, which in turn load the root `vite.config.ts` through Node's ESM loader to read their `fmt` / `lint` sections.

Node v22.14.0 cannot natively load `.ts` via ESM. Native TS ESM loading is only stable in Node 22.18+ (or experimental with `--experimental-strip-types` on 22.6+). Upgrading vite-plus to 0.1.19 produced a clearer error message confirming this:

```
TypeScript config files require Node.js ^20.19.0 || >=22.12.0.
Detected Node.js v22.14.0.
Please upgrade Node.js or use a JSON config file instead.
```

(The version range text in that message is misleading — I tested on v20.19.5 and it still failed with the same `ERR_UNKNOWN_FILE_EXTENSION`. Only v24.8.0 succeeded. The real constraint is native TS strip-types support.)

The root `vite.config.ts` contained only `staged` / `lint` / `fmt` / ignore-pattern config — no TypeScript types, no TS-only syntax — it was TS only because the scaffolded template used `.ts`.

## Fix chosen

Rename `/vite.config.ts` → `/vite.config.mjs`. Content unchanged. `defineConfig` from `vite-plus` is just an identity function that doesn't rely on TS types.

`.mjs` is loaded by Node's ESM loader natively on every Node version the repo targets, so `oxfmt` and `oxlint` can read the config. `vp fmt --help` explicitly lists `.mjs` as a supported config extension.

Per-package `packages/*/vite.config.ts` files are left alone — they contain real code (e.g. `packages/browser/vite.config.ts` uses `fs`/`path`, benefits from TS) and the native-binary config loader only walks up to the monorepo root, so they are not on the failing path.

## Approaches rejected

- **(A) Upgrade vite-plus 0.1.12 → 0.1.19.** Initially tested — the `.ts` loader issue persisted on Node 22.14.0 because it is a Node-side limitation, not a vite-plus bug. Only benefit was a clearer error message. Reverted to keep the diff minimal (lockfile also drifted).
- **(B) Rename to `.mts`.** `.mts` is TS and still requires a TS loader. Would have re-introduced the same problem.
- **(C) Add a `jiti` / `tsx` loader shim.** No vite-plus hook to inject one before it spawns the native binaries. Too invasive.
- **(D) Convert to `.json`.** Would drop the `staged` command-string `"vp check --fix"` ambiguity and fit oxfmt/oxlint, but `defineConfig()` is JS-only and the `lint.overrides[].rules.no-restricted-imports` shape wants JS flexibility long-term. `.mjs` keeps full parity with the TS version.
- **(E) Ask user to upgrade Node ≥ 22.18.** Out of scope for a code fix; would break every contributor on the current `.nvmrc`-equivalent setup.

## Verification

```
pnpm --filter @neuve/evals test            # 25/25 passing
pnpm --filter @neuve/perf-agent-cli typecheck  # passes
pnpm --filter cli-solid typecheck          # passes
pnpm build                                  # 5/5 tasks successful
pnpm check                                  # loader error gone
```

`pnpm check` still exits non-zero, but only because of genuine **formatting issues** in `packages/shared` (7 files) and `packages/evals` (3 files) src code — pre-existing, explicitly noted as out of scope in the task ("remaining failures must be genuine lint/format/typecheck issues, NOT the `.ts` loader error").

## Final diff

```
 D vite.config.ts
?? vite.config.mjs
```

Two files. No lockfile changes. No source changes. No dev-dep changes.
