# testie

[![version](https://img.shields.io/npm/v/@browser-tester/cli?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@browser-tester/cli)
[![downloads](https://img.shields.io/npm/dt/@browser-tester/cli.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@browser-tester/cli)

Let coding agents test your code in a real browser.

One command scans your unstaged changes or branch diff, generates a test plan, and runs it against a live browser — no test files to write.

<!-- ### [See it in action →](https://testie.dev) -->

## How it works

Testie detects your code changes (unstaged files or branch diff), then:

1. **Plan**: Generates a test plan based on your changes and a natural language instruction.
2. **Run**: Opens a real browser (headed or headless) and executes each step — clicking, typing, navigating, and asserting.
3. **Report**: Surfaces pass/fail results with browser recordings so you can see exactly what happened.

When run inside a coding agent (Claude Code, Cursor, Codex, etc.), testie skips the interactive TUI and runs headlessly.

## Install

```bash
npx @browser-tester/cli@latest
```

Or install globally:

```bash
npm install -g @browser-tester/cli
```

Then run from your project root:

```bash
testie
```

## Usage with coding agents

Point your agent at testie and let it test your changes:

```bash
BROWSER_TESTER_BASE_URL=http://localhost:3000 testie -m "Test the signup flow" -y
```

The `-y` flag skips plan review so agents can run non-interactively.

Testie auto-detects agent environments (`CLAUDECODE`, `CURSOR_AGENT`, `CODEX_CI`, `CI`, etc.) and switches to headless mode.

## Commands

```
Usage: testie [command] [options]

Commands:
  unstaged          test current unstaged changes (default)
  branch            test full branch diff vs main
```

## Options

```
Options:
  -m, --message <instruction>   natural language instruction for what to test
  -f, --flow <slug>             reuse a saved flow by slug
  -y, --yes                     skip plan review, run immediately
  --base-url <url>              browser base URL
  --headed                      run browser visibly instead of headless
  --cookies                     sync cookies from your browser profile
  --no-cookies                  disable cookie sync
  -v, --version                 print version
  -h, --help                    display help
```

## Environment variables

| Variable                  | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `BROWSER_TESTER_BASE_URL` | Default base URL for the browser                      |
| `BROWSER_TESTER_HEADED`   | Set to `true` or `1` to run headed by default         |
| `BROWSER_TESTER_COOKIES`  | Set to `true` or `1` to enable cookie sync by default |

## Examples

Test unstaged changes interactively:

```bash
testie
```

Test with a specific instruction, skip plan review:

```bash
testie -m "add an item to the cart and check out" -y
```

Test full branch diff:

```bash
testie branch -m "verify the new settings page" -y
```

Reuse a saved flow:

```bash
testie -f checkout-flow
```

Run with a custom base URL and visible browser:

```bash
testie --base-url http://localhost:5173 --headed
```

## Contributing

```bash
git clone https://github.com/millionco/testie
cd testie
pnpm install --no-frozen-lockfile
cd apps/cli
pnpm link-global
```

Run in dev mode:

```bash
cd apps/cli
pnpm dev
```

### License

Testie is MIT-licensed open-source software.
