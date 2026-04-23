import type { ToolCall } from "../task";

export const toolCallValidity = (calls: ReadonlyArray<ToolCall>): number => {
  if (calls.length === 0) return 1;
  const wellFormedCount = calls.filter((call) => call.wellFormed).length;
  return wellFormedCount / calls.length;
};
