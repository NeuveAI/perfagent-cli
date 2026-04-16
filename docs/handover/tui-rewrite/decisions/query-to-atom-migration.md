# Decision: React Query hook → Solid replacement strategy

_Date: 2026-04-16. Phase: TUI-P2._

## Rule

- **Long-lived subscriptions or data consumed in multiple screens** → Effect atom via `atomToAccessor`.
- **One-shot fetches only needed in a single screen** → Solid `createResource`.
- **Polled data** → Solid `createResource` with `refetchInterval` (interval managed by `setInterval` in the component).

## Per-hook decisions

| Hook | Strategy | Rationale |
|---|---|---|
| `use-git-state` | `createResource` in `ProjectProvider` | One-shot fetch with manual refetch on checkout. Not consumed across screens widely enough to justify an atom. |
| `use-listening-ports` | `createResource` with poll | Only consumed by PortPicker. Polled every 5s — a refetch interval on a resource is simpler than an atom stream. |
| `use-detected-projects` | `createResource` (staleTime: Infinity → fetch once) | Only consumed by PortPicker. Never refreshes. |
| `use-remote-branches` | `createResource` | Only consumed by PrPicker. No invalidation needed. |
| `use-installed-browsers` | `createResource` | Only consumed by CookieSyncConfirm. One-shot. |
| `use-available-agents` | `createResource` | Only consumed by AgentPicker. staleTime 30s → fetch once per mount is fine. |
| `use-config-options` | `createResource` keyed on agent | Per-agent fetch. Only in AgentPicker. |
| `use-update-check` | `createResource` | One-shot check. staleTime 1h. Only read by modeline. |
| `use-saved-flows` | `createResource` + manual invalidation | Only consumed by SavedFlowPicker. The stale-read bug (pain #4) is fixed by calling `refetch()` after `saveFlowFn` completes — the Solid component will do this explicitly rather than relying on cache invalidation. |

## Why not Effect atoms for everything?

Effect atoms shine when:
1. The data is consumed reactively across multiple screens (e.g., `recentReportsAtom` in both Main and RecentReportsPicker).
2. The atom lifecycle (mount/unmount/refresh) maps naturally to the data's lifecycle.
3. The data participates in the atom dependency graph (one atom depends on another).

Most React Query hooks are simple one-shot fetches consumed in a single screen. Converting them to atoms would add complexity without benefit — the atom registry would hold them alive even when the screen isn't mounted.

The existing atoms (`recentReportsAtom`, `agentProviderAtom`, `executeFn`, `askReportFn`, `saveFlowFn`, `loadReportFn`, `agentConfigOptionsAtom`) stay as atoms and are consumed via `atomToAccessor` / `atomFnToPromise`.

## Pain #3 fix: recentReportsAtom invalidation

Already fixed in `execution-atom.ts:104` via `Atom.refresh(recentReportsAtom)`. Verified that the refresh call exists. The Solid consumer in Main reads via `atomToAccessor(recentReportsAtom)`, which subscribes to updates — so when `Atom.refresh` fires after a report save, the accessor automatically updates.

## Pain #4 fix: useSavedFlows stale read

The SavedFlowPicker (P3 scope) will call `refetch()` on its `createResource` after `saveFlowFn` completes. This is explicit invalidation at the UI layer, matching the `createResource` strategy.
