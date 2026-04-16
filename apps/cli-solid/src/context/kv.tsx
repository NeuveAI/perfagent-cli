import { createSignal, createContext, useContext, type JSX, type Accessor } from "solid-js";
import { Predicate } from "effect";
import { promptHistoryStorage, projectPreferencesStorage } from "@neuve/supervisor";

/**
 * Persistent key-value store adapter.
 *
 * Reuses the same on-disk storage adapters as the Ink TUI's zustand-persist
 * middleware, so preferences written by either TUI are readable by the other.
 * This enables a smooth P6 cutover.
 *
 * The storage adapters are async (fs-backed), but initial reads are cached
 * in memory after the first load. Writes are fire-and-forget to disk.
 */

interface StorageAdapter {
  getItem: (name: string) => Promise<string | null>;
  setItem: (name: string, value: string) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
}

interface KvSignalEntry {
  readonly accessor: Accessor<unknown>;
  readonly setter: (value: unknown) => void;
}

interface KvStore {
  readonly signal: <T>(
    storeName: string,
    storage: StorageAdapter,
    key: string,
    defaultValue: T,
  ) => [Accessor<T>, (value: T | ((previous: T) => T)) => void];
}

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value) && !Array.isArray(value);

const isZustandEnvelope = (
  value: unknown,
): value is { state: Record<string, unknown> } =>
  isRecordObject(value) && "state" in value && isRecordObject(value.state);

const createKvStore = (): KvStore => {
  const signals = new Map<string, KvSignalEntry>();
  const storeCache = new Map<string, Record<string, unknown>>();
  const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

  const WRITE_DEBOUNCE_MS = 100;

  const compositeKey = (storeName: string, key: string) => `${storeName}:${key}`;

  const scheduleWrite = (storeName: string, storage: StorageAdapter) => {
    const existing = pendingWrites.get(storeName);
    if (existing !== undefined) clearTimeout(existing);

    pendingWrites.set(
      storeName,
      setTimeout(() => {
        pendingWrites.delete(storeName);
        const cached = storeCache.get(storeName);
        if (cached) {
          const serialized = JSON.stringify({ state: cached, version: 0 });
          storage.setItem(storeName, serialized).catch(() => {
            // HACK: write failures are non-fatal for preferences
          });
        }
      }, WRITE_DEBOUNCE_MS),
    );
  };

  const hydrateSignalsForStore = (storeName: string, state: Record<string, unknown>) => {
    for (const [sKey, entry] of signals) {
      if (!sKey.startsWith(`${storeName}:`)) continue;
      const fieldKey = sKey.slice(storeName.length + 1);
      if (fieldKey in state) {
        entry.setter(state[fieldKey]);
      }
    }
  };

  return {
    signal<T>(
      storeName: string,
      storage: StorageAdapter,
      key: string,
      defaultValue: T,
    ): [Accessor<T>, (value: T | ((previous: T) => T)) => void] {
      const cKey = compositeKey(storeName, key);

      const existing = signals.get(cKey);
      if (existing) {
        const typedAccessor: Accessor<T> = () => existing.accessor() as T;
        const typedSetter = (value: T | ((previous: T) => T)) => {
          const resolved =
            typeof value === "function"
              ? (value as (previous: T) => T)(existing.accessor() as T)
              : value;
          existing.setter(resolved);
        };
        return [typedAccessor, typedSetter];
      }

      const [get, rawSet] = createSignal<T>(defaultValue, { equals: false });

      if (!storeCache.has(storeName)) {
        storeCache.set(storeName, {});
        storage.getItem(storeName).then((raw) => {
          if (raw === null) return;
          try {
            const parsed: unknown = JSON.parse(raw);
            const state = isZustandEnvelope(parsed) ? parsed.state : parsed;

            if (isRecordObject(state)) {
              storeCache.set(storeName, state);
              hydrateSignalsForStore(storeName, state);
            }
          } catch {
            // HACK: corrupt storage file, use defaults
          }
        });
      } else {
        const cached = storeCache.get(storeName);
        if (cached && key in cached) {
          rawSet(() => cached[key] as T);
        }
      }

      const set = (value: T | ((previous: T) => T)) => {
        const resolved =
          typeof value === "function"
            ? (value as (previous: T) => T)(get())
            : value;

        rawSet(() => resolved);

        const cached = storeCache.get(storeName) ?? {};
        cached[key] = resolved;
        storeCache.set(storeName, cached);
        scheduleWrite(storeName, storage);
      };

      signals.set(cKey, {
        accessor: get as Accessor<unknown>,
        setter: (v: unknown) => rawSet(() => v as T),
      });

      return [get, set];
    },
  };
};

const KvContext = createContext<KvStore>();

export const useKv = (): KvStore => {
  const context = useContext(KvContext);
  if (!context) {
    throw new Error("useKv must be used inside KvProvider");
  }
  return context;
};

interface KvProviderProps {
  readonly children: JSX.Element;
}

export const KvProvider = (props: KvProviderProps) => {
  const store = createKvStore();
  return <KvContext.Provider value={store}>{props.children}</KvContext.Provider>;
};

export { promptHistoryStorage, projectPreferencesStorage };
