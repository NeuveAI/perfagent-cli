import type { PerfAgentConfig } from "./types";

let globalConfig: PerfAgentConfig = {};

export const defineConfig = (config: PerfAgentConfig): PerfAgentConfig => config;

export const configure = (config: Partial<PerfAgentConfig>): void => {
  globalConfig = { ...globalConfig, ...config };
};

export const getGlobalConfig = (): PerfAgentConfig => globalConfig;

export const resetGlobalConfig = (): void => {
  globalConfig = {};
};
