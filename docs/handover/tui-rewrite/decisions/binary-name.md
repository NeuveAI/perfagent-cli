# Decision: Binary Name During TUI Rewrite

**Status:** Decided  
**Date:** 2026-04-16

## Context

During the TUI rewrite (P0-P5), both the Ink-based CLI (`apps/cli`) and the Solid-based CLI (`apps/cli-solid`) coexist in the workspace.

## Decision

- **P0 through P5:** The Solid TUI has no `bin` field. It is run directly via `bun src/tui.ts` or `bun dist/tui.js`. For convenience, `pnpm dev:solid` and `pnpm build:solid` are available at the root.
- **P6 (Cutover):** The `bin.perf-agent` field moves to the Solid package. The Ink code is deleted. The published binary name remains `perf-agent` -- no user-visible change.

## Rationale

Avoiding a temporary binary name (`perf-agent-solid`) eliminates confusion in docs, scripts, and muscle memory. Since cli-solid has no bin field until P6, there is no collision with the existing `perf-agent` binary from `apps/cli`.
