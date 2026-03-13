import { claudeAgent } from "../src/claude.js";
import { codexAgent } from "../src/codex.js";
import { LOG_PREVIEW_LENGTH } from "../src/constants.js";
import { runAgent } from "../src/run-agent.js";
import type { AgentConfig, ModelMessage } from "../src/types.js";
import { isRecord } from "../src/utils/is-record.js";

const SEPARATOR_LENGTH = 60;

const truncate = (text: string): string =>
  text.length > LOG_PREVIEW_LENGTH ? `${text.slice(0, LOG_PREVIEW_LENGTH)}...` : text;

const logContentPart = (part: unknown): void => {
  if (!isRecord(part)) return;

  if (part.type === "text" && typeof part.text === "string") {
    console.log(`       text: ${truncate(part.text)}`);
  } else if (part.type === "reasoning" && typeof part.text === "string") {
    console.log(`       reasoning: ${truncate(part.text)}`);
  } else if (part.type === "tool-call") {
    console.log(`       tool-call: ${part.toolName}(${truncate(JSON.stringify(part.input))})`);
  } else if (part.type === "tool-result" && isRecord(part.output)) {
    console.log(`       tool-result: [${part.output.type}] ${truncate(String(part.output.value))}`);
  }
};

const logMessage = (index: number, message: ModelMessage): void => {
  const contentParts = Array.isArray(message.content) ? message.content : [];
  const types = contentParts
    .filter(isRecord)
    .map((part) => part.type);

  console.log(`  [${index}] role=${message.role} parts=[${types.join(", ")}]`);
  for (const part of contentParts) logContentPart(part);
};

const testAgent = async (name: string, agent: AgentConfig) => {
  console.log(`\n${"=".repeat(SEPARATOR_LENGTH)}`);
  console.log(`Testing ${name} agent`);
  console.log("=".repeat(SEPARATOR_LENGTH));

  const startTime = Date.now();
  let messageCount = 0;

  try {
    for await (const message of runAgent(agent, "List the files in the current directory", {
      cwd: process.cwd(),
    })) {
      messageCount++;
      logMessage(messageCount, message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`\n  ${name} completed: ${messageCount} messages in ${elapsed}ms`);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`\n  ${name} failed after ${elapsed}ms with ${messageCount} messages:`);
    console.error(`  ${error}`);
  }
};

const main = async () => {
  await testAgent("Claude", claudeAgent);
  await testAgent("Codex", codexAgent);
  console.log("\nDone.");
};

main();
