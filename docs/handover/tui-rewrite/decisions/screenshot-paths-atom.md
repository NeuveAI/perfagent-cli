# Decision: screenshotPathsAtom (pain #17) — DELETE

_Date: 2026-04-16. Phase: TUI-P2._

## Context

`screenshotPathsAtom` in `execution-atom.ts:32-34` is declared as:
```ts
// HACK: atom is read by testing-screen.tsx but never populated — screenshots are saved via McpSession instead
export const screenshotPathsAtom = Atom.make<readonly string[]>([]);
```

The atom is read by `testing-screen.tsx:437` via `useAtomValue(screenshotPathsAtom)` but no code ever writes to it. Screenshots are saved by the MCP session layer, not through this atom.

## Decision

**Do not consume `screenshotPathsAtom` in the Solid TUI.** The atom itself lives in `apps/cli/src/data/execution-atom.ts` (frozen data layer — not modified in this rewrite), but the new TUI will not subscribe to it.

When P4 (Testing screen) lands, screenshots will be wired through the sync store's event reducer if the `ScreenshotCaptured` event is emitted by the supervisor. This is the correct architecture: the sync store is the single source of truth for execution state in the Solid TUI.

## What stays

The atom definition stays in `execution-atom.ts` (data layer is frozen). It will be cleaned up in a future data-layer pass outside the TUI rewrite scope.
