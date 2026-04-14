# Perf Agent

[![version](https://img.shields.io/npm/v/@neuve/perf-agent-cli?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@neuve/perf-agent-cli)
[![downloads](https://img.shields.io/npm/dt/@neuve/perf-agent-cli.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@neuve/perf-agent-cli)

**Perf Agent** is a skill for analyzing the performance impact of your code changes in a real Chrome browser. It reads your git diff, generates a profiling plan, and runs it via Chrome DevTools — measuring Core Web Vitals, drilling into insights, and reporting regressions.

## Getting Started

1. Install the MCP server for your coding agent:

   ```json
   {
     "mcpServers": {
       "perf-agent": {
         "command": "npx",
         "args": ["-y", "@neuve/perf-agent-cli@latest", "mcp"]
       }
     }
   }
   ```

2. Ask your agent to profile your changes. The skill teaches it when and how to run the perf-agent tools.
3. Or run the interactive TUI: `npx @neuve/perf-agent-cli@latest tui`.
4. Perf Agent spawns traces against affected routes, drills into the bottlenecks (LCP subparts, render-blocking resources, INP hot spots, memory leaks), and reports back with metric evidence.

## FAQ

#### 1. What is Perf Agent?

An agent harness that reads your git changes, generates a performance-analysis plan, and runs it against a real Chrome browser through [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp). It hooks into your coding agent (Claude Code, Codex, Cursor, OpenCode, Gemini, Copilot, Factory Droid, Pi) and runs locally.

It checks for Core Web Vitals regressions (LCP, FCP, CLS, INP, TTFB), render-blocking resources, excessive network payloads, memory leaks, long animation frames, and Lighthouse a11y / SEO / best-practices issues.

#### 2. Why not just run Lighthouse or a custom Puppeteer script?

Instead of maintaining a bespoke profiling script per codebase, Perf Agent reads the diff, picks the right routes, records cold-load and interaction traces, drills into flagged insights, and tests under throttled mobile conditions — then summarizes regressions with concrete metric evidence. It's Lighthouse-plus-traces-plus-insights, driven by an agent that already has context on what you changed.

#### 3. How is this different from computer-use agents?

General-purpose browser tools rely on screenshots and mouse coordinates. Perf Agent is purpose-built for performance work: it uses Chrome DevTools directly to read traces, analyze insights, emulate throttled conditions, and measure real user-facing metrics — not to imitate a user.

#### 4. Does it work in CI?

Yes. Use `--ci` or the `add github-action` command to set up a workflow that profiles every PR. In CI mode it runs headless, skips cookie extraction, auto-approves the plan, and enforces a 30-minute timeout.

#### 5. Can I run it fully offline with a local model?

Yes. With [Ollama](https://ollama.com) and a tool-calling model (e.g. `gemma4:e4b`), run with `-a local` to drive the whole flow without any cloud calls. See `PERF_AGENT_LOCAL_MODEL` and `PERF_AGENT_OLLAMA_URL` to point at a different model or endpoint.

## Options

| Flag                          | Description                                                                                     | Default     |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| `-m, --message <instruction>` | Natural language instruction for what to profile                                                | -           |
| `-f, --flow <slug>`           | Reuse a saved flow by its slug                                                                  | -           |
| `-y, --yes`                   | Run immediately without confirmation                                                            | -           |
| `-a, --agent <provider>`      | Agent provider (`claude`, `codex`, `copilot`, `gemini`, `cursor`, `opencode`, `droid`, `pi`, `local`) | auto-detect |
| `-t, --target <target>`       | What to profile: `unstaged`, `branch`, or `changes`                                             | `changes`   |
| `-u, --url <urls...>`         | Base URL(s) for the dev server (skips port picker)                                              | -           |
| `--browser-mode <mode>`       | Browser mode: `headed` or `headless`                                                            | `headed`    |
| `--cdp <url>`                 | Connect to an existing Chrome via CDP WebSocket URL                                             | -           |
| `--profile <name>`            | Reuse a Chrome profile by name (e.g. Default)                                                   | -           |
| `--no-cookies`                | Skip system browser cookie extraction                                                           | -           |
| `--ci`                        | Force CI mode: headless, no cookies, auto-yes, 30-min timeout                                   | -           |
| `--timeout <ms>`              | Execution timeout in milliseconds                                                               | -           |
| `--output <format>`           | Output format: `text` or `json`                                                                 | `text`      |
| `--verbose`                   | Enable verbose logging                                                                          | -           |
| `-v, --version`               | Print version                                                                                   | -           |
| `-h, --help`                  | Display help                                                                                    | -           |

## Supported Agents

Perf Agent works with the following coding agents. It auto-detects which are installed on your `PATH`. If multiple are available, it defaults to the first one found. Use `-a <provider>` to pick a specific agent.

| Agent                                                         | Flag          | Install                                         |
| ------------------------------------------------------------- | ------------- | ----------------------------------------------- |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `-a claude`   | `npm install -g @anthropic-ai/claude-code`      |
| [Codex](https://github.com/openai/codex#readme)               | `-a codex`    | `npm install -g @openai/codex`                  |
| [GitHub Copilot](https://github.com/features/copilot/cli)     | `-a copilot`  | `npm install -g @github/copilot`                |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli)     | `-a gemini`   | `npm install -g @google/gemini-cli`             |
| [Cursor](https://cursor.com)                                  | `-a cursor`   | [cursor.com](https://cursor.com)                |
| [OpenCode](https://opencode.ai)                               | `-a opencode` | `npm install -g opencode-ai`                    |
| [Factory Droid](https://factory.ai)                           | `-a droid`    | `npm install -g droid`                          |
| [Pi](https://github.com/mariozechner/pi-coding-agent)         | `-a pi`       | `npm install -g @mariozechner/pi-coding-agent`  |
| Local (Ollama)                                                | `-a local`    | [ollama.com](https://ollama.com) + a tool-calling model |

## Tools

Perf Agent exposes three macro tools to the coding agent, each dispatching to Chrome DevTools operations via a `command` discriminator:

- **`interact`** — real CDP input events: `navigate`, `click`, `fill`, `type`, `press_key`, `hover`, `drag`, `wait_for`, `resize`, tabs, dialogs, uploads.
- **`observe`** — read page state: `snapshot` (accessibility tree + element UIDs), `screenshot`, `console`, `network`, `pages`, `evaluate`.
- **`trace`** — profile and audit: `start`, `stop`, `analyze`, `emulate`, `memory`, `lighthouse`.

## Resources & Contributing Back

Find a bug? Head over to the [issue tracker](https://github.com/neuve/perf-agent-cli/issues) and we'll do our best to help. Pull requests welcome.

### Acknowledgements

Perf Agent wouldn't exist without the ideas and work of others:

- [**Expect**](https://github.com/millionco/expect) by Aiden Bai and Million Software — the QA-testing harness that this project is forked from. The scan-changes → AI-plans → execute-in-browser → report flow, the ACP agent architecture, the cookie extraction, the TUI, and most of the monorepo structure all originate in Expect. Perf Agent narrows that foundation to one specific use case (performance analysis) and replaces the Playwright layer with Chrome DevTools.
- [**dev-browser**](https://github.com/SawyerHood/dev-browser) by Sawyer Hood — the Playwright-first ("bitter lesson") approach that inspired Expect's core design and, transitively, ours: give the agent real browser APIs instead of screenshots and coordinates.
- [**chrome-devtools-mcp**](https://github.com/ChromeDevTools/chrome-devtools-mcp) — the MCP server that exposes Chrome DevTools tooling. Perf Agent wraps its 29 operations into three macro tools focused on performance work.

### License

FSL-1.1-MIT
