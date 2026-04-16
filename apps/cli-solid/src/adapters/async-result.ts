import type { Cause } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { JSX } from "solid-js";

/**
 * Solid-friendly AsyncResult builder.
 *
 * Usage:
 * ```tsx
 * buildAsyncResult(result)
 *   .onWaiting(() => <Spinner />)
 *   .onSuccess((data) => <Content data={data} />)
 *   .onFailure((cause) => <ErrorDisplay cause={cause} />)
 *   .orNull()
 * ```
 *
 * Returns JSX elements compatible with Solid's rendering.
 * The `onWaiting` handler fires for both `Initial` and any result with
 * `waiting: true` (a refresh is in flight).
 */

interface AsyncResultBuilder<A, E, HasWaiting, HasSuccess, HasFailure> {
  onWaiting(
    render: () => JSX.Element,
  ): AsyncResultBuilder<A, E, true, HasSuccess, HasFailure>;

  onSuccess(
    render: (value: A) => JSX.Element,
  ): AsyncResultBuilder<A, E, HasWaiting, true, HasFailure>;

  onFailure(
    render: (cause: Cause.Cause<E>) => JSX.Element,
  ): AsyncResultBuilder<A, E, HasWaiting, HasSuccess, true>;

  orNull(): JSX.Element;
}

export const buildAsyncResult = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): AsyncResultBuilder<A, E, false, false, false> => {
  let waitingFn: (() => JSX.Element) | undefined;
  let successFn: ((value: A) => JSX.Element) | undefined;
  let failureFn: ((cause: Cause.Cause<E>) => JSX.Element) | undefined;

  const builder: AsyncResultBuilder<A, E, boolean, boolean, boolean> = {
    onWaiting(render) {
      waitingFn = render;
      return builder;
    },
    onSuccess(render) {
      successFn = render;
      return builder;
    },
    onFailure(render) {
      failureFn = render;
      return builder;
    },
    orNull(): JSX.Element {
      if (result._tag === "Initial") {
        return waitingFn ? waitingFn() : undefined;
      }

      if (result.waiting && waitingFn) {
        // When refreshing, prefer showing the stale success value if available
        if (result._tag === "Success" && successFn) {
          return successFn(result.value);
        }
        return waitingFn();
      }

      if (result._tag === "Success" && successFn) {
        return successFn(result.value);
      }

      if (result._tag === "Failure" && failureFn) {
        return failureFn(result.cause);
      }

      return undefined;
    },
  };

  return builder as AsyncResultBuilder<A, E, false, false, false>;
};
