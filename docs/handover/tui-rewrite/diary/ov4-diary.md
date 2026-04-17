# OV-4 — Modeline hints for overlay keys

Verification-only task. No code changes.

## What was verified

After OV-1b, OV-2b, OV-3c landed, all six Results commands are registered in
`apps/cli-solid/src/commands/register-results.ts`:

| command           | keybind | hidden |
|-------------------|---------|--------|
| `results.copy`    | `y`     | default (visible) |
| `results.save`    | `s`     | default (visible) |
| `results.restart` | `r`     | default (visible) |
| `results.ask`     | `a`     | default (visible) |
| `results.insights`| `i`     | default (visible) |
| `results.raw-events` (title `events`) | `e` | default (visible) |

No `hidden: true` on any of them. The modeline renderer at
`apps/cli-solid/src/renderables/modeline.tsx:10` calls
`registry.getVisibleCommands()`, which filters on
`hidden !== true && enabled !== false`
(`apps/cli-solid/src/context/command-registry.ts:77`).

The shared `isEnabled(options)` predicate
(`apps/cli-solid/src/commands/register-results.ts:12`) returns true when:

1. `currentScreen()._tag === "Results"`,
2. `overlay() === undefined`,
3. `isDialogEmpty()` is true.

So on the Results screen with no overlay and no dialog active, the modeline will
render `/copy /save /restart /ask /insights /events`. When an overlay or dialog
is open, every Results command flips to `enabled: false` and the modeline
clears (except for global commands like `/quit`), which is the correct modal
behavior.

## Verification steps

- Read `register-results.ts` — confirmed zero `hidden: true` on the 6 commands.
- Read `command-registry.ts:75-78` — `getVisibleCommands` filter confirmed.
- Read `modeline.tsx` — renders titles of visible commands prefixed with `/`.

No runtime dry-run required — the invariant is structural.

## What a manual dry-run would show

On Results with no overlay active, the modeline bar at the bottom of the
terminal prints:

```
─────────────────────────────────────────────────
 /copy  /save  /restart  /ask  /insights  /events
```

(Plus any global commands if they're visible on the Results screen — e.g. the
global `quit` command is gated to Main/Startup so it won't appear here.)

Press `a`/`i`/`e` → overlay opens, modeline clears.
Press `esc` → overlay closes, modeline re-fills.
