import { Effect, Schema, ServiceMap } from "effect";
import type { RefNotFoundError } from "./errors";

export const ToolRef = Schema.String.pipe(Schema.brand("ToolRef"));
export type ToolRef = typeof ToolRef.Type;

export interface ClickOptions {
  readonly button?: "left" | "right" | "middle";
  readonly clickCount?: number;
}

export interface FillOptions {
  readonly clearFirst?: boolean;
}

export type WaitForState = "visible" | "hidden" | "attached" | "detached";

export type WaitForTarget =
  | { readonly kind: "ref"; readonly ref: ToolRef }
  | { readonly kind: "selector"; readonly selector: string }
  | { readonly kind: "aria"; readonly aria: string };

export interface WaitForOptions {
  readonly timeout?: number;
  readonly state?: WaitForState;
}

export interface ToolSnapshot {
  readonly text: string;
  readonly capturedAt: number;
}

export interface ToolResult {
  readonly snapshot: ToolSnapshot;
}

export interface ElementClickOptions {
  readonly button?: "left" | "right" | "middle";
  readonly clickCount?: number;
}

export interface ElementFillOptions {
  readonly clearFirst?: boolean;
}

export interface ElementHandle {
  readonly ref: ToolRef;
  readonly click: (
    options?: ElementClickOptions,
  ) => Effect.Effect<void, import("./errors").InteractionError>;
  readonly fill: (
    text: string,
    options?: ElementFillOptions,
  ) => Effect.Effect<void, import("./errors").InteractionError>;
  readonly hover: () => Effect.Effect<void, import("./errors").InteractionError>;
  readonly select: (
    option: string | number,
  ) => Effect.Effect<void, import("./errors").InteractionError>;
}

export class RefResolver extends ServiceMap.Service<
  RefResolver,
  {
    readonly resolveRef: (ref: ToolRef) => Effect.Effect<ElementHandle, RefNotFoundError>;
  }
>()("@devtools/tools/RefResolver") {}

export interface NetworkIdleProbe {
  readonly inFlightCount: () => Effect.Effect<number, import("./errors").InteractionError>;
}

export class NetworkIdleSampler extends ServiceMap.Service<NetworkIdleSampler, NetworkIdleProbe>()(
  "@devtools/tools/NetworkIdleSampler",
) {}

export interface SnapshotCapturer {
  readonly capture: () => Effect.Effect<ToolSnapshot, import("./errors").InteractionError>;
}

export class SnapshotTaker extends ServiceMap.Service<SnapshotTaker, SnapshotCapturer>()(
  "@devtools/tools/SnapshotTaker",
) {}

export interface WaitForProbe {
  readonly waitForSelector: (
    selector: string,
    state: WaitForState,
    timeoutMs: number,
  ) => Effect.Effect<
    void,
    import("./errors").WaitTimeoutError | import("./errors").InteractionError
  >;
  readonly waitForAria: (
    aria: string,
    state: WaitForState,
    timeoutMs: number,
  ) => Effect.Effect<
    void,
    import("./errors").WaitTimeoutError | import("./errors").InteractionError
  >;
  readonly waitForRef: (
    ref: ToolRef,
    state: WaitForState,
    timeoutMs: number,
  ) => Effect.Effect<
    void,
    import("./errors").WaitTimeoutError | import("./errors").InteractionError | RefNotFoundError
  >;
}

export class WaitForEngine extends ServiceMap.Service<WaitForEngine, WaitForProbe>()(
  "@devtools/tools/WaitForEngine",
) {}
