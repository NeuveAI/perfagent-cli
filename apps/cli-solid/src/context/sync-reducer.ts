import type { PlanId, StepId } from "@neuve/shared/models";

export interface ToolCallEntry {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "running" | "completed" | "failed";
  readonly inputPreview: string;
  readonly outputPreview: string;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface StepEntry {
  readonly stepId: StepId;
  readonly title: string;
  readonly status: "running" | "passed" | "failed" | "skipped";
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly toolCalls: readonly ToolCallEntry[];
}

export interface AgentMessageEntry {
  readonly content: string;
  readonly timestamp: number;
}

export interface SyncStoreShape {
  readonly planId: PlanId | undefined;
  readonly status: "idle" | "running" | "completed" | "failed" | "cancelled";
  readonly steps: Record<string, StepEntry>;
  readonly stepOrder: readonly StepId[];
  readonly agentMessages: readonly AgentMessageEntry[];
  readonly activeStepId: StepId | undefined;
  readonly elapsedMs: number;
  readonly startedAt: number | undefined;
}

export const INITIAL_SYNC_STORE: SyncStoreShape = {
  planId: undefined,
  status: "idle",
  steps: {},
  stepOrder: [],
  agentMessages: [],
  activeStepId: undefined,
  elapsedMs: 0,
  startedAt: undefined,
};

export type SyncEvent =
  | { readonly _tag: "StepStarted"; readonly stepId: StepId; readonly title: string; readonly timestamp: number }
  | { readonly _tag: "StepCompleted"; readonly stepId: StepId; readonly timestamp: number }
  | { readonly _tag: "StepFailed"; readonly stepId: StepId; readonly timestamp: number }
  | { readonly _tag: "StepSkipped"; readonly stepId: StepId; readonly timestamp: number }
  | { readonly _tag: "ToolCall"; readonly stepId: StepId; readonly toolCallId: string; readonly toolName: string; readonly inputPreview: string; readonly timestamp: number }
  | { readonly _tag: "ToolResult"; readonly stepId: StepId; readonly toolCallId: string; readonly outputPreview: string; readonly timestamp: number }
  | { readonly _tag: "ToolProgress"; readonly stepId: StepId; readonly toolCallId: string; readonly progressText: string; readonly timestamp: number }
  | { readonly _tag: "AgentMessageChunk"; readonly content: string; readonly timestamp: number }
  | { readonly _tag: "RunStarted"; readonly planId: PlanId; readonly timestamp: number }
  | { readonly _tag: "RunCompleted"; readonly timestamp: number }
  | { readonly _tag: "RunFailed"; readonly timestamp: number }
  | { readonly _tag: "RunCancelled"; readonly timestamp: number };

/**
 * Binary search for inserting into an ordered array by a key function.
 * Returns the index where the item should be inserted to maintain order.
 */
export const binarySearchInsertIndex = <T,>(
  array: readonly T[],
  targetId: string,
  keyFn: (item: T) => string,
): { found: boolean; index: number } => {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midKey = keyFn(array[mid]!);
    if (midKey < targetId) {
      low = mid + 1;
    } else if (midKey > targetId) {
      high = mid;
    } else {
      return { found: true, index: mid };
    }
  }

  return { found: false, index: low };
};

/**
 * Pure reducer — applies a SyncEvent to the store shape.
 * Independently testable without Solid.
 */
export const syncReducer = (
  state: SyncStoreShape,
  event: SyncEvent,
): SyncStoreShape => {
  switch (event._tag) {
    case "RunStarted":
      return {
        ...INITIAL_SYNC_STORE,
        planId: event.planId,
        status: "running",
        startedAt: event.timestamp,
      };

    case "StepStarted": {
      const newStep: StepEntry = {
        stepId: event.stepId,
        title: event.title,
        status: "running",
        startedAt: event.timestamp,
        toolCalls: [],
      };
      const newStepOrder = state.stepOrder.includes(event.stepId)
        ? state.stepOrder
        : [...state.stepOrder, event.stepId];
      return {
        ...state,
        steps: { ...state.steps, [event.stepId]: newStep },
        stepOrder: newStepOrder,
        activeStepId: event.stepId,
      };
    }

    case "StepCompleted": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: { ...step, status: "passed", completedAt: event.timestamp },
        },
        activeStepId: state.activeStepId === event.stepId ? undefined : state.activeStepId,
      };
    }

    case "StepFailed": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: { ...step, status: "failed", completedAt: event.timestamp },
        },
        activeStepId: state.activeStepId === event.stepId ? undefined : state.activeStepId,
      };
    }

    case "StepSkipped": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: { ...step, status: "skipped", completedAt: event.timestamp },
        },
      };
    }

    case "ToolCall": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      const newToolCall: ToolCallEntry = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
        inputPreview: event.inputPreview,
        outputPreview: "",
        startedAt: event.timestamp,
      };
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: {
            ...step,
            toolCalls: [...step.toolCalls, newToolCall],
          },
        },
      };
    }

    case "ToolResult": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      const updatedToolCalls = step.toolCalls.map((toolCall) =>
        toolCall.toolCallId === event.toolCallId
          ? { ...toolCall, status: "completed" as const, outputPreview: event.outputPreview, completedAt: event.timestamp }
          : toolCall,
      );
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: { ...step, toolCalls: updatedToolCalls },
        },
      };
    }

    case "ToolProgress": {
      const step = state.steps[event.stepId];
      if (!step) return state;
      const updatedToolCalls = step.toolCalls.map((toolCall) =>
        toolCall.toolCallId === event.toolCallId
          ? { ...toolCall, outputPreview: event.progressText }
          : toolCall,
      );
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: { ...step, toolCalls: updatedToolCalls },
        },
      };
    }

    case "AgentMessageChunk":
      return {
        ...state,
        agentMessages: [
          ...state.agentMessages,
          { content: event.content, timestamp: event.timestamp },
        ],
      };

    case "RunCompleted":
      return {
        ...state,
        status: "completed",
        elapsedMs: state.startedAt !== undefined ? event.timestamp - state.startedAt : 0,
      };

    case "RunFailed":
      return {
        ...state,
        status: "failed",
        elapsedMs: state.startedAt !== undefined ? event.timestamp - state.startedAt : 0,
      };

    case "RunCancelled":
      return {
        ...state,
        status: "cancelled",
        elapsedMs: state.startedAt !== undefined ? event.timestamp - state.startedAt : 0,
      };
  }
};
