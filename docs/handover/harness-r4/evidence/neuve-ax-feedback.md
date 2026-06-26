# Neuve AX feedback for harness-r4 closeout

Generated: 2026-06-26

## Commands used

```bash
neuve kanban context ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9
```

Result: Kanban context is readable. Ticket is in `in-progress`; expected evidence labels are `next-round-evidence`, `next-round-eval-report`, `scoped-tests`, and `strict-review`.

Existing doctor artifact inspected:

```text
.neuve-artifact/doctor-1782495962-37981000-66913.json
```

## Setup state

Doctor artifact summary:

- Global `neuve` binary present.
- Build provenance matches current local build.
- Repo-local `.neuve/config.json` missing.
- Repo-local `.neuve/metadata.sqlite` missing.
- Daemon status: `setup_required`.
- Classifier route health: `setup_required`.
- Embedding index: disabled.
- Workflow contracts: not configured.
- `ollama` not found on PATH.
- `chrome-devtools-mcp` not found on PATH.
- Deterministic Kanban commands remain usable.

No `neuve init`, daemon start, classifier setup, hook installation, or repo-local consent/setup mutation was performed.

## AX feedback

The current split is workable but easy to misread:

- Kanban commands work without repo-local setup, so ticket context can be read and comments can be posted.
- Review/warm/scan/classifier workflows are not ready because repo-local config and store are absent.
- The doctor artifact explains this, but closeout agents need to explicitly distinguish "Kanban usable" from "review workflow ready."

Recommended follow-up:

- Owner should decide whether to initialize repo-local Neuve setup before strict-review evidence is required from this workspace.
- Until then, keep strict-review as a handoff blocker rather than claiming the Kanban done gate is satisfied.

## Related package-manager AX blocker

The requested pnpm test route is blocked before Vitest by pnpm build approval policy:

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.4, keytar@7.9.0, msgpackr-extract@3.0.3, node-pty@1.1.0, protobufjs@7.5.4, protobufjs@8.0.0, tree-sitter-bash@0.25.1
```

`pnpm approve-builds` was not run because it would alter dependency build approval state. A non-mutating direct `vp test run ...` route passed for the two focused test files and is recorded in `next-round-evidence.md`.

The blocked pnpm command attempted to write an `allowBuilds` placeholder block to `pnpm-workspace.yaml`. That block was removed immediately; no build approval decision is left in the worktree from this run.
