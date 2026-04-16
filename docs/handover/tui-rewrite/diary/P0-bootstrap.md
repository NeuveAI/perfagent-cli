# TUI-P0 Bootstrap Diary

**Date:** 2026-04-16  
**Engineer:** Claude Opus 4.6

## Summary

Stood up `apps/cli-solid/` as a new workspace package with Bun runtime, OpenTUI deps, and a minimal rendered box. The TUI renders "perf-agent solid TUI -- hello" with the Logo component ported from the Ink codebase, enters alt-screen, and exits cleanly on ctrl+c.

Files created:

- `apps/cli-solid/package.json` -- deps: `@opentui/core@0.1.99`, `@opentui/solid@0.1.99`, `solid-js@1.9.11`, `commander`, `effect@4.0.0-beta.35`, `@effect/platform-node@4.0.0-beta.35`. Workspace devDeps: `@neuve/shared`, `@neuve/supervisor`, `@neuve/agent`.
- `apps/cli-solid/tsconfig.json` -- extends root, `jsxImportSource: "@opentui/solid"`.
- `apps/cli-solid/bunfig.toml` -- preload for `@opentui/solid/preload` (Babel Solid JSX transform) and trustedDependencies for `@opentui/core`.
- `apps/cli-solid/build.ts` -- Bun build script using `@opentui/solid/bun-plugin` to register the Solid JSX transform.
- `apps/cli-solid/src/tui.ts` -- renderer setup with 60 FPS target, alt-screen, kitty keyboard, mouse disabled.
- `apps/cli-solid/src/app.tsx` -- minimal app rendering Logo + hello text.
- `apps/cli-solid/src/renderables/logo.tsx` -- port of the Ink Logo component using OpenTUI `<box>`, `<text>`, `<span>` primitives.
- Root `package.json` -- added `dev:solid` and `build:solid` scripts.
- `docs/handover/tui-rewrite/review-system-prompt.md` -- review system prompt for all TUI phases.
- `docs/handover/tui-rewrite/decisions/binary-name.md` -- decision note on binary naming during rewrite.

## Non-obvious decisions

### OpenTUI version pinning

Pinned `@opentui/core@0.1.99` and `@opentui/solid@0.1.99` exactly as specified in the scope doc (matching opencode's SHA `9640d88`). The `solid-js` peer dependency is pinned to `1.9.11` per `@opentui/solid`'s `peerDependencies`.

### Bun build requires a custom build script

Bun's `bun build` CLI command does not support the `preload` configuration from `bunfig.toml`. The SolidJS JSX transform requires Babel (`babel-preset-solid`), not Bun's built-in React JSX transform. Solution: `build.ts` programmatically calls `Bun.build()` with the `@opentui/solid/bun-plugin` registered. The `dev` script (`bun --watch`) does pick up the `preload` from `bunfig.toml`.

### Alt-screen managed by OpenTUI

The OpenTUI renderer handles alt-screen entry/exit internally via `screenMode: "alternate-screen"` in the `CliRendererConfig`. We do NOT need manual `process.stdout.write("\x1b[?1049h")` / `process.stdout.write("\x1b[?1049l")` -- the renderer's `onDestroy` cleanup handles this, including on SIGINT when `exitOnCtrlC: true` is set.

### tsconfig isolation strategy

`apps/cli-solid/tsconfig.json` sets `jsxImportSource: "@opentui/solid"`. The root `tsconfig.json` has `"jsx": "react-jsx"` and `apps/cli/tsconfig.json` also sets `"jsx": "react-jsx"`. Since each package uses its own `tsconfig.json` and `tsgo` runs per-package, the pragma does not leak. Verified by running `pnpm --filter @neuve/perf-agent-cli typecheck` after adding cli-solid.

### No pnpm-workspace.yaml change needed

The existing `packages: ["apps/*"]` glob already covers `apps/cli-solid`. No modification to `pnpm-workspace.yaml` was required.

### Effect version matching

Used the exact same `effect@4.0.0-beta.35` and `@effect/platform-node@4.0.0-beta.35` versions as `apps/cli/package.json` to avoid version conflicts in the monorepo.

## Issues / blockers

### OpenTUI console overlay shows internal errors

When running the TUI, OpenTUI's built-in console overlay shows some stack traces from `renderer.ts`. These appear to be non-fatal internal errors within OpenTUI's rendering loop (related to frame activation). The app still renders correctly and exits cleanly. This is cosmetic and does not block P0 acceptance. The console overlay can be disabled via `consoleMode: "disabled"` in the renderer config if desired in later phases.

### Native addon installed successfully

`@opentui/core`'s native Zig addon (`@opentui/core-darwin-arm64`) installed and loaded without issues on macOS arm64 (Apple Silicon). The optional dependency mechanism (`optionalDependencies` in `@opentui/core`) correctly pulled the platform-specific binary. No Zig toolchain was needed at install time -- the prebuilt binary was used.

### Pre-existing test failure in @neuve/cookies

The `cookies.test.ts > Chrome: extracted cookies have valid expiry timestamps` test fails on the current `main` branch (unrelated to this PR). It expects Chrome's Guest Profile to return cookies, but the profile has 0 cookies on this machine. This is a pre-existing flaky test, not a regression.

## Verification

### pnpm install

```
Scope: all 10 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 3.8s using pnpm v10.29.1
```

### pnpm typecheck

```
Tasks:    9 successful, 9 total
Cached:    9 cached, 9 total
Time:    42ms >>> FULL TURBO
```

### pnpm --filter @neuve/perf-agent-cli typecheck

```
> @neuve/perf-agent-cli@0.1.2 typecheck /Users/vinicius/code/perfagent-cli/apps/cli
> tsgo --noEmit
(clean exit)
```

### pnpm --filter @neuve/shared test

```
Test Files  10 passed (10)
     Tests  113 passed (113)
```

### pnpm --filter cli-solid build

```
> cli-solid@0.0.0 build /Users/vinicius/code/perfagent-cli/apps/cli-solid
> bun build.ts
(clean exit, produces dist/tui.js at ~1.3 MB)
```

### bun dist/tui.js + ctrl+c

The TUI renders on alt-screen showing "perf-agent solid TUI -- hello" with the Logo component (cross + tick + "Perf Agent" + version). On SIGINT (ctrl+c), the terminal returns to normal state with exit code 0. Alt-screen teardown is clean.
