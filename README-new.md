# <img src="https://github.com/millionco/testie/blob/main/apps/website/public/icon.svg?raw=true" width="60" align="center" /> Expect

[![version](https://img.shields.io/npm/v/expect-cli?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/expect-cli)
[![downloads](https://img.shields.io/npm/dt/expect-cli.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/expect-cli)

Give your agent a browser.

**Expect** tests your app so you don't have to. Works with Claude Code, Codex, [and more](https://github.com/millionco/expect#supported-agents)

- Point it at a branch or unstaged changes. Expect figures out what to test and validates it in a real browser.
- Authenticated sessions using your actual browser cookies. No mock logins.
- Video recording of every run. Watch every click instead of trusting a text summary.
- Zero test files. Describe what to test in plain English. Nothing to keep in sync.
- CI ready. Add the GitHub Action and every PR gets browser-tested before merge.

### **[See it in action →](https://expect.dev)**

## Install

```bash
# Install the Skill + CLI
npx expect-cli@latest init
```

Then open Claude Code/Codex and run `/expect`.

## FAQ

**How is this different from Puppeteer/Playwright/Cypress?**

Those are libraries. You write test scripts by hand, maintain selectors, and wire up assertions yourself. Expect reads your code changes, generates a test plan in plain English, and executes it in a real browser. You never write a test file. Think of it as the difference between writing SQL by hand and asking a question in natural language.

**Is this just visual regression testing?**

No. Expect drives the browser like a real user (clicking, typing, navigating, submitting forms) and verifies behavior, not just screenshots. It can catch broken auth flows, form validation bugs, missing error states, and accessibility issues that pixel-diffing tools miss entirely.

**Why a CLI and not just a markdown skill file?**

Expect installs a skill file too, that's how your agent knows to call it. But a skill file alone can only give the agent instructions. It can't launch a browser, inject cookies from your real login session, record the session for replay, or run headless in CI. The CLI is the runtime behind the skill that handles browser orchestration, cookie extraction, session recording, and result reporting.

**Is this computer use / Browser Use?**

It's the same idea (an AI agent driving a browser) but purpose-built for testing. General-purpose computer use tools control your entire desktop with screenshots and mouse coordinates, burning tokens on every pixel. Expect uses Playwright under the hood for fast, precise DOM automation, scoped to validating your code changes. That makes it cheaper, faster, and more reliable than pointing a generic computer use agent at your app.

**When does it run? How does it fit into my workflow?**

Your coding agent calls `/expect` as a skill whenever it needs to validate its work in a real browser. You can also trigger it from CI by adding the GitHub Action to test every PR automatically before merge.

**Can't my coding agent already test things itself?**

Your agent can read code and run terminal commands, but it can't open a browser, navigate your app, or see what your users see. Expect gives the agent real DOM interaction, authenticated sessions with your actual cookies, and a video recording of exactly what happened.

**Does it work in CI?**

Yes. Use `--ci` or the `add github-action` command to set up a workflow that tests every PR. In CI mode it runs headless, skips cookie extraction, auto-approves the plan, and enforces a 30-minute timeout.

**Is there a cloud or enterprise version?**

Coming soon. Email [aiden@million.dev](mailto:aiden@million.dev) if you have questions or ideas.

## Options

<!-- Keep this table in sync with apps/cli/src/index.tsx -->

| Flag                          | Description                                                                            | Default              |
| ----------------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| `-m, --message <instruction>` | Natural language instruction for what to test                                          | —                    |
| `-f, --flow <slug>`           | Reuse a saved flow by its slug                                                         | —                    |
| `-y, --yes`                   | Run immediately without confirmation                                                   | —                    |
| `-a, --agent <provider>`      | Agent provider (`claude`, `codex`, `copilot`, `gemini`, `cursor`, `opencode`, `droid`) | auto-detect          |
| `-t, --target <target>`       | What to test: `unstaged`, `branch`, or `changes`                                       | `changes`            |
| `-u, --url <urls...>`         | Base URL(s) for the dev server (skips port picker)                                     | —                    |
| `--headed`                    | Show a visible browser window during tests                                             | —                    |
| `--no-cookies`                | Skip system browser cookie extraction                                                  | —                    |
| `--ci`                        | Force CI mode: headless, no cookies, auto-yes, 30-min timeout                          | —                    |
| `--timeout <ms>`              | Execution timeout in milliseconds                                                      | —                    |
| `--output <format>`           | Output format: `text` or `json`                                                        | `text`               |
| `--verbose`                   | Enable verbose logging                                                                 | —                    |
| `--replay-host <url>`         | Website host for live replay viewer                                                    | `https://expect.dev` |
| `-v, --version`               | Print version                                                                          | —                    |
| `-h, --help`                  | Display help                                                                           | —                    |

## Supported Agents

Expect works with the following coding agents. It auto-detects which agents are installed on your `PATH`. If multiple are available, it defaults to the first one found. Use `-a <provider>` to pick a specific agent.

| Agent                                                         | Flag          | Install                                    |
| ------------------------------------------------------------- | ------------- | ------------------------------------------ |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `-a claude`   | `npm install -g @anthropic-ai/claude-code` |
| [Codex](https://github.com/openai/codex#readme)               | `-a codex`    | `npm install -g @openai/codex`             |
| [GitHub Copilot](https://github.com/features/copilot/cli)     | `-a copilot`  | `npm install -g @github/copilot`           |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli)     | `-a gemini`   | `npm install -g @google/gemini-cli`        |
| [Cursor](https://cursor.com)                                  | `-a cursor`   | [cursor.com](https://cursor.com)           |
| [OpenCode](https://opencode.ai)                               | `-a opencode` | `npm install -g opencode-ai`               |
| [Factory Droid](https://factory.ai)                           | `-a droid`    | `npm install -g droid`                     |

## Resources & Contributing Back

Want to try it out? Check out [our demo](https://expect.dev).

Find a bug? Head over to our [issue tracker](https://github.com/millionco/expect/issues) and we'll do our best to help. We love pull requests, too!

We expect all contributors to abide by the terms of our [Code of Conduct](https://github.com/millionco/expect/blob/main/.github/CODE_OF_CONDUCT.md).

[**→ Start contributing on GitHub**](https://github.com/millionco/expect/blob/main/CONTRIBUTING.md)

### License

FSL-1.1-MIT © [Million Software, Inc.](https://million.dev)
