import * as Atom from "effect/unstable/reactivity/Atom";
import type { AgentBackend } from "@neuve/agent";
import type { AcpConfigOption } from "@neuve/shared/models";

export const agentConfigOptionsAtom = Atom.make<Record<AgentBackend, AcpConfigOption[]>>({
  claude: [],
  codex: [],
  copilot: [],
  gemini: [],
  cursor: [],
  opencode: [],
  droid: [],
  pi: [],
  local: [],
});
