import { Schema } from "effect";

export class RefNotFoundError extends Schema.ErrorClass<RefNotFoundError>("RefNotFoundError")({
  _tag: Schema.tag("RefNotFoundError"),
  ref: Schema.String,
  reason: Schema.String,
}) {
  message = `Ref "${this.ref}" could not be resolved: ${this.reason}`;
}

export class InteractionError extends Schema.ErrorClass<InteractionError>("InteractionError")({
  _tag: Schema.tag("InteractionError"),
  action: Schema.String,
  ref: Schema.String,
  cause: Schema.String,
}) {
  message = `Interaction "${this.action}" on ref "${this.ref}" failed: ${this.cause}`;
}

export class WaitTimeoutError extends Schema.ErrorClass<WaitTimeoutError>("WaitTimeoutError")({
  _tag: Schema.tag("WaitTimeoutError"),
  target: Schema.String,
  state: Schema.String,
  timeoutMs: Schema.Number,
  observedAtLeastOnce: Schema.Boolean,
}) {
  message = `Timed out after ${this.timeoutMs}ms waiting for ${this.target} to be ${this.state}: ${
    this.observedAtLeastOnce
      ? `target was observed at least once but never reached ${this.state}`
      : `target was never observed during the wait window`
  }`;
}
