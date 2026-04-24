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
