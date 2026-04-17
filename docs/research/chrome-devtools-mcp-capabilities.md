# chrome-devtools-mcp capabilities — screencasting + trace-file analysis

Research notes from 2026-04-17 while planning follow-ups to the Solid TUI rewrite. Covers two questions:

1. Can we record a video of the agent's browser session?
2. Can we point the MCP at a saved `.json` / `.json.gz` trace and get insights without re-running?

Answers live against `chrome-devtools-mcp@0.21.0` as pinned by `packages/browser/package.json`. Upstream tool names verified by grepping the vendored build at `node_modules/chrome-devtools-mcp/build/src/tools/*.js`.

---

## 1. Screencasting

### What chrome-devtools-mcp ships

Upstream exposes two tools — we had missed them earlier because our local-agent wrapper only surfaces the `interact`/`observe`/`trace` aggregates:

| Tool | Behavior |
|------|----------|
| `screencast_start` | "Starts recording a screencast (video) of the selected page in mp4 format." |
| `screencast_stop` | "Stops the active screencast recording on the selected page." |

Source: `node_modules/chrome-devtools-mcp/build/src/tools/screencast.js`.

Output is an MP4 file. The exact path / return payload needs confirmation from the tool's argument schema; expectation is that `start` takes an output path and `stop` returns metadata (duration, size, path).

### What we already have

- `take_screenshot` — single PNG frame per invocation. Already usable today; low fidelity but zero setup cost.
- `lighthouse_audit` — produces a filmstrip of key frames as part of an audit run. Not freeform recording.

### What we'd need to add

1. **Expose the native tools through the local-agent wrapper.** Either:
   - Add a new `record` wrapper tool with `{ command: "start" | "stop" }` actions that maps to `screencast_start` / `screencast_stop`, or
   - Let the supervisor call `screencast_start` directly around the run (outside the LLM's control) and stop on `RunFinished`.
2. **Store the output next to the session artifacts.** Proposed: `.perf-agent/recordings/<session-id>.mp4` with a `recordingPath: Option.Option<string>` field on `SessionRecord` (mirrors the `reportPath` pattern F-Catalog landed).
3. **Surface in the TUI.** Results screen could show `Video: /path/to.mp4` similar to the old `props.videoUrl` wiring; `y` to copy the path, `r` to open in the default player via `open`.

### Alternative routes (if upstream tool isn't practical)

| Route | Effort | Output | Fidelity |
|-------|--------|--------|----------|
| Periodic `take_screenshot` keyed to each step | Low | folder of PNGs | Low — no motion |
| Raw CDP `Page.startScreencast` via a second client hitting the same DevTools WS | Medium | JPEG frames → ffmpeg to MP4 | High |
| `rrweb` injection via `evaluate_script` | Medium | `.rrweb.json` + HTML replayer | DOM-faithful, not pixel |
| OS-level recorder (ffmpeg + avfoundation) | Low | MP4 | External dep, full desktop |

### Recommendation

Go with the upstream `screencast_start` / `screencast_stop` tools — zero new infra, same MCP round-trip pattern we already use. Ship behind a `--record` CLI flag or a `PERF_AGENT_RECORD=1` env so default runs stay cheap.

---

## 2. Pointing chrome-devtools-mcp at a saved trace file

### Short answer — no

The performance surface is strictly live-session:

| Tool | Scope |
|------|-------|
| `performance_start_trace` | Starts a new trace in the current browser. |
| `performance_stop_trace` | Stops the active trace. |
| `performance_analyze_insight` | Drills into one insight from the **last captured in-session trace**. |

There is no `import_trace`, `load_trace`, `analyze_trace_file`, or equivalent. Verified via the full tool list in `node_modules/chrome-devtools-mcp/build/src/tools/*.js`:

```
click, click_at, close_page, drag, emulate, evaluate_script,
execute_in_page_tool, fill, fill_form, get_console_message,
get_network_request, get_tab_id, handle_dialog, hover,
install_extension, lighthouse_audit, list_console_messages,
list_extensions, list_in_page_tools, list_network_requests,
list_pages, navigate_page, new_page, performance_analyze_insight,
performance_start_trace, performance_stop_trace, press_key,
reload_extension, resize_page, screencast_start, screencast_stop,
select_page, take_memory_snapshot, take_screenshot, take_snapshot,
trigger_extension_action, type_text, uninstall_extension,
upload_file, wait_for
```

### Routes to offline-trace analysis

| Route | What it involves | Tradeoffs |
|-------|------------------|-----------|
| Fork chrome-devtools-mcp, add `import_trace` tool | Read the `.json`/`.json.gz`, reuse the `build/src/trace-processing/` pipeline | Upstream might accept a PR — cleanest long-term. Coupled to upstream release cadence. |
| Embed DevTools' `TraceEngine` directly in our supervisor | Consume `devtools-frontend`'s trace engine (same library chrome-devtools-mcp uses internally) as a library — `loadTrace(filePath) → PerfMetricSnapshot[]` + run insight detectors | Most flexibility. Larger surface to maintain. Needs careful dependency on devtools-frontend since it isn't packaged as a plain npm lib. |
| Lighthouse CLI on a saved trace (`--gather-mode`/`--audit-mode` split) | Pre-captured assets → Lighthouse re-audits | OK for audit re-runs, not for freeform insight drilldown. Ties us to Lighthouse shape. |
| Replay the trace against a fresh Chrome (e.g. Puppeteer script that re-navigates, re-traces) | Effectively re-runs the scenario | Wasteful — defeats the purpose of having a saved trace. |

### Where this would plug in

We'd want an `analyze-trace <file>` subcommand on the `perf-agent` binary (and TUI picker variant) that:

1. Reads the file (support `.json` and `.json.gz`).
2. Parses into the same `ExecutedPerfPlan.events` shape the reporter already consumes — OR skips events entirely and constructs `PerfReport.metrics[]` + `insightDetails[]` directly.
3. Re-uses `packages/supervisor/src/reporter.ts` machinery to produce the same `PerfReport` we'd produce from a live run.
4. Writes under `.perf-agent/reports/<iso-timestamp>-imported-<origin>.json` + `.md`.

The `SessionRecord` + `reportPath` link from F-Catalog already handles the catalog side.

### Recommendation

Embed the DevTools `TraceEngine` directly in a new `@neuve/trace-loader` package (or inside `packages/supervisor/src/trace-loader.ts` if scope is small). Rationale:

- It's the same engine chrome-devtools-mcp runs internally, so insight parity with live runs is automatic.
- We sidestep upstream release timelines.
- The import path can be re-used to post-process old `.perf-agent/recordings/*.trace.json` files as part of the Catalog workflow.

Fallback plan if the engine isn't easy to lift: fork chrome-devtools-mcp and add `import_trace` — one tool, small delta.

---

## chrome-devtools-mcp tool inventory (for reference)

All tools exposed by v0.21.0, grouped. Useful when expanding the local-agent wrapper or when deciding what to surface to the TUI.

### Navigation / pages
`list_pages`, `new_page`, `navigate_page`, `select_page`, `close_page`, `get_tab_id`, `resize_page`

### Snapshot / state
`take_snapshot`, `take_screenshot`, `take_memory_snapshot`

### Input / interaction
`click`, `click_at`, `drag`, `fill`, `fill_form`, `hover`, `press_key`, `type_text`, `upload_file`, `wait_for`, `handle_dialog`

### Console / network
`list_console_messages`, `get_console_message`, `list_network_requests`, `get_network_request`

### Performance
`performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `lighthouse_audit`

### Recording
`screencast_start`, `screencast_stop`

### Script execution
`evaluate_script`, `execute_in_page_tool`, `list_in_page_tools`

### Emulation
`emulate`

### Extensions
`install_extension`, `list_extensions`, `reload_extension`, `trigger_extension_action`, `uninstall_extension`

---

## Open questions to resolve before implementation

1. **Screencast output path**: does `screencast_start` accept a target path or return one? Inspect `node_modules/chrome-devtools-mcp/build/src/tools/screencast.js` argument schema before wiring.
2. **Recording lifecycle across multiple pages**: if the agent calls `new_page` mid-recording, does the screencast follow or stay on the original? Confirm from upstream docs / source.
3. **Trace engine dependency footprint**: inspect whether the engine can be consumed as `import { ... } from "chrome-devtools-mcp/trace-processing"` (re-export) or if we need to pull from `devtools-frontend` directly. Check `package.json.exports`.
4. **Serialization format**: live-captured trace output vs saved-file trace format — are they byte-for-byte compatible with the engine's input, or is some normalization required?

---

## Ties to existing plans

- **Session catalog (F-Catalog, landed `a91261a1`)** — `SessionRecord` already accepts `reportPath: Option<string>`. Adding `recordingPath` + `importedFromTracePath` would follow the same pattern.
- **Auto-drill (F-AutoDrill, landed `9b6b241d`)** — the synthetic-event trick used there would apply to imported traces too: we fabricate `ToolCall` + `ToolResult` events for every insight and let the existing reporter pipeline populate `insightDetails[]`.
- **Prompt unification (F-Prompt, landed `20158e38`)** — if trace import ships as an agent-initiated flow, the local-agent prompt should list an `analyze_saved_trace` tool.

---

_File seeded by research pass 2026-04-17. Update as upstream capabilities change or as we prototype the import path._
