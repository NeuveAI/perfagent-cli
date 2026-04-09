import { useQuery } from "@tanstack/react-query";
import { detectAvailableAgents, type SupportedAgent } from "@neuve/agent";
import type { AgentBackend } from "@neuve/agent";
import { AGENT_PROVIDER_DISPLAY_NAMES } from "@neuve/shared/models";

export interface AvailableAgent {
  backend: AgentBackend;
  displayName: string;
  isInstalled: boolean;
}

const ALL_AGENTS = Object.keys(AGENT_PROVIDER_DISPLAY_NAMES) as AgentBackend[];

export const useAvailableAgents = () =>
  useQuery({
    queryKey: ["available-agents"],
    queryFn: (): AvailableAgent[] => {
      const installed = new Set<SupportedAgent>(detectAvailableAgents());
      return ALL_AGENTS.map((backend) => ({
        backend,
        displayName: AGENT_PROVIDER_DISPLAY_NAMES[backend],
        isInstalled: installed.has(backend as SupportedAgent),
      }));
    },
    staleTime: 30_000,
  });
