import type { TrainingMessage } from "./types";
import type { MessageEntry } from "./modelfile-builder";

/**
 * convertTrainingMessagesToModelfileMessages — project chat-message training
 * samples into the strict Ollama `MESSAGE` directive shape (`system | user |
 * assistant` roles only — see `modelfile-builder.ts:MODELFILE_MESSAGE_ROLES`).
 *
 * Rules (Round 1 review C2 + M4):
 *   - `role: "system"` messages are dropped. The SYSTEM directive already
 *     owns the system prompt; repeating it as `MESSAGE system` is O(N) bloat
 *     and wasn't what Ollama's chat-history format is for.
 *   - `role: "tool"` messages are NOT emitted as `MESSAGE tool` (invalid
 *     Modelfile grammar). Their content is inlined into the immediately-
 *     preceding assistant message as a `<tool_result id="...">...</tool_result>`
 *     block, preserving the few-shot's tool-loop semantics without violating
 *     grammar.
 *   - `role: "user" | "assistant"` messages pass through. Assistant messages
 *     with `toolCalls` get a `<tool_calls>...</tool_calls>` block appended so
 *     the few-shot shows Gemma how to emit tool calls.
 *   - Empty-content messages are skipped.
 *
 * Shared between `build-modelfile.ts` and `smoke-finetune.ts` so the two
 * scripts can never disagree on the conversion.
 */
export const convertTrainingMessagesToModelfileMessages = (
  messages: ReadonlyArray<TrainingMessage>,
): ReadonlyArray<MessageEntry> => {
  const result: MessageEntry[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const toolBlock = `<tool_result id="${message.toolCallId ?? ""}">${message.content}</tool_result>`;
      const previous = result[result.length - 1];
      if (previous !== undefined && previous.role === "assistant") {
        result[result.length - 1] = {
          role: "assistant",
          content: previous.content.length === 0 ? toolBlock : `${previous.content}\n${toolBlock}`,
        };
      } else {
        result.push({ role: "assistant", content: toolBlock });
      }
      continue;
    }
    // role === "user" | "assistant"
    const toolCallsBlock =
      message.toolCalls !== undefined && message.toolCalls.length > 0
        ? `\n<tool_calls>${JSON.stringify(message.toolCalls)}</tool_calls>`
        : "";
    const content = `${message.content}${toolCallsBlock}`;
    if (content.length === 0) continue;
    result.push({ role: message.role, content });
  }
  return result;
};
