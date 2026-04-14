import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

const OLLAMA_BASE_URL = "http://localhost:11434/v1/";
const DEFAULT_MODEL = "gemma4:e4b";
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_NUM_CTX = 32768;

export interface OllamaCompletionOptions {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  signal?: AbortSignal;
}

export interface OllamaClient {
  readonly complete: (options: OllamaCompletionOptions) => Promise<OpenAI.Chat.Completions.ChatCompletion>;
  readonly model: string;
}

export const createOllamaClient = (): OllamaClient => {
  const model = process.env["PERF_AGENT_LOCAL_MODEL"] ?? DEFAULT_MODEL;

  const client = new OpenAI({
    baseURL: process.env["PERF_AGENT_OLLAMA_URL"] ?? OLLAMA_BASE_URL,
    apiKey: "ollama",
  });

  const complete = async (options: OllamaCompletionOptions) => {
    const response = await client.chat.completions.create(
      {
        model,
        messages: options.messages,
        tools: options.tools?.length ? options.tools : undefined,
        stream: false,
        temperature: DEFAULT_TEMPERATURE,
        // @ts-expect-error -- Ollama-specific option not in OpenAI types
        num_ctx: DEFAULT_NUM_CTX,
      },
      { signal: options.signal },
    );
    return response;
  };

  return { complete, model } as const;
};

export const checkOllamaHealth = async (): Promise<void> => {
  const baseUrl = process.env["PERF_AGENT_OLLAMA_URL"] ?? OLLAMA_BASE_URL;
  const versionUrl = baseUrl.replace(/\/v1\/?$/, "/api/version");

  const response = await fetch(versionUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Ollama health check failed: HTTP ${response.status}`);
  }
};
