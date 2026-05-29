# Pi Configuration for perfagent-cli

## Setup Overview

This directory contains pi configuration for the perfagent-cli project:

- **Agents**: Specialized agent definitions for team orchestration
- **Skills**: Team-orchestration and strict-critique workflows
- **Settings**: Skill discovery and environment variables

## Available Agents

See `.pi/agents/` for specialized agent definitions:

- `subagent-worker.md` — General implementation
- `subagent-planner.md` — Strategic planning
- `subagent-reviewer.md` — Strict-critique audit

## Process Invariants

Always check these before work:

- [ ] Read prior work (handover, diary, reviews)
- [ ] Build before evals (`pnpm --filter @neuve/local-agent build`)
- [ ] Real services (no MockLanguageModelV4)
- [ ] Distribution gates (baseline evals)
- [ ] `pnpm check` clean (typecheck + lint + format)
- [ ] `pnpm test` pass

## Devcontainer Mode

Active when `PI_DEVCONTAINER_MODE=1` is set:

- Shell commands run inside container
- Destructive git operations are opt-in
- Unrestricted repo-local tool execution
- Identity: Qwen3.5-122B-A10B-NVFP4 model

## Skills Loaded

- `/skill:team-orchestration` — Multi-phase coordination
- `/skill:strict-critique` — Merge-blocking audit
- `/skill:devcontainer-yolo` — Devcontainer environment rules

## Files

```
.pi/
├── agents/
│   ├── subagent-worker.md    # General implementation
│   ├── subagent-planner.md    # Strategic planning
│   └── subagent-reviewer.md   # Strict-critique audit
├── skills/
│   ├── team-orchestration/
│   │   └── SKILL.md
│   └── strict-critique/
│       └── SKILL.md
└── settings.json              # Configuration
```

## Devcontainer-Yolo

The devcontainer-yolo extension is loaded globally from `pi-devcontainer-yolo` package.

To spawn specialized agents for orchestration:

1. **Read the handover** - Always start with the latest handover document
2. **Use team-orchestration skill** - `/skill:team-orchestration` for multi-phase work
3. **Follow the workflow** - Planner → Worker → Reviewer chain with explicit handoffs

Example workflow:
```typescript
// Phase 1: Planner analyzes handover and creates plan
const plan = await subagent({
  agent: "planner",
  task: "Analyze handover and create implementation plan",
  cwd: ctx.cwd
});

// Phase 2: Worker implements the plan
const implementation = await subagent({
  agent: "worker",
  task: `Implement per plan: ${plan.output}`,
  cwd: ctx.cwd
});

// Phase 3: Reviewer audits the implementation
const review = await subagent({
  agent: "reviewer",
  task: `Audit implementation: ${implementation.output}`,
  cwd: ctx.cwd
});
```
