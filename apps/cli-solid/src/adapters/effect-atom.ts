import { createSignal, batch, onCleanup, type Accessor } from "solid-js";
import { Exit } from "effect";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

const BATCH_WINDOW_MS = 16;

/**
 * Shared AtomRegistry instance — the single runtime for all atom subscriptions.
 * Must NOT double-initialize: the existing `cliAtomRuntime` from
 * `apps/cli/src/data/runtime.ts` produces atoms that are read through THIS
 * registry. Components call `atomToAccessor` / `atomFnToPromise` which
 * subscribe here.
 */
let sharedRegistry: AtomRegistry.AtomRegistry | undefined;

export const setAtomRegistry = (registry: AtomRegistry.AtomRegistry): void => {
  sharedRegistry = registry;
};

export const getAtomRegistry = (): AtomRegistry.AtomRegistry => {
  if (!sharedRegistry) {
    throw new Error(
      "AtomRegistry not initialized. Call setAtomRegistry() before using atom adapters.",
    );
  }
  return sharedRegistry;
};

/**
 * Convert an Effect Atom into a Solid Accessor.
 *
 * The accessor is reactive — Solid components that read it will re-render
 * when the atom's value changes. A 16ms batch coalescer collapses burst
 * updates into a single Solid reactive update.
 */
export const atomToAccessor = <A>(atom: Atom.Atom<A>): Accessor<A> => {
  const registry = getAtomRegistry();

  const initialValue = registry.get(atom);
  const [value, setValue] = createSignal<A>(initialValue, { equals: false });

  let pendingValue: A;
  let hasPending = false;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    batchTimer = undefined;
    if (hasPending) {
      const flushed = pendingValue;
      hasPending = false;
      batch(() => {
        setValue(() => flushed);
      });
    }
  };

  const unsubscribe = registry.subscribe(atom, (next: A) => {
    pendingValue = next;
    hasPending = true;
    if (batchTimer === undefined) {
      batchTimer = setTimeout(flush, BATCH_WINDOW_MS);
    }
  });

  onCleanup(() => {
    unsubscribe();
    if (batchTimer !== undefined) {
      clearTimeout(batchTimer);
      batchTimer = undefined;
    }
  });

  return value;
};

/**
 * Convert an Effect AtomResultFn into a promise-returning function.
 *
 * Returns `Promise<Exit<Out, E>>` — the caller decides how to handle
 * success vs failure. Span annotations from the atom layer are preserved.
 */
export const atomFnToPromise = <In, Out, E>(
  atomFn: Atom.Writable<AsyncResult.AsyncResult<Out, E>, In | Atom.Reset | Atom.Interrupt>,
): ((input: In) => Promise<Exit.Exit<Out, E>>) => {
  const registry = getAtomRegistry();

  return (input: In): Promise<Exit.Exit<Out, E>> =>
    new Promise<Exit.Exit<Out, E>>((resolve) => {
      registry.set(atomFn, input);

      const unsubscribe = registry.subscribe(
        atomFn,
        (result: AsyncResult.AsyncResult<Out, E>) => {
          if (result._tag === "Initial" || result.waiting) return;

          unsubscribe();

          if (result._tag === "Success") {
            resolve(Exit.succeed(result.value));
          } else {
            resolve(Exit.failCause(result.cause));
          }
        },
      );
    });
};

/**
 * Read an atom's current value synchronously (non-reactive).
 * Useful for one-shot reads outside of component render.
 */
export const atomGet = <A>(atom: Atom.Atom<A>): A => {
  return getAtomRegistry().get(atom);
};

/**
 * Write to a writable atom.
 */
export const atomSet = <R, W>(atom: Atom.Writable<R, W>, value: W): void => {
  getAtomRegistry().set(atom, value);
};

/**
 * Refresh an atom (re-run its effect).
 */
export const atomRefresh = <A>(atom: Atom.Atom<A>): void => {
  getAtomRegistry().refresh(atom);
};

/**
 * Mount an atom so it stays alive even without subscribers.
 * Returns a cleanup function.
 */
export const atomMount = <A>(atom: Atom.Atom<A>): (() => void) => {
  return getAtomRegistry().mount(atom);
};
