import {
  createContext,
  useContext,
  batch,
  type JSX,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
  syncReducer,
  INITIAL_SYNC_STORE,
  type SyncStoreShape,
  type SyncEvent,
} from "./sync-reducer";

export type {
  SyncStoreShape,
  SyncEvent,
  StepEntry,
  ToolCallEntry,
  AgentMessageEntry,
} from "./sync-reducer";
export { syncReducer, binarySearchInsertIndex, INITIAL_SYNC_STORE } from "./sync-reducer";

const BATCH_FLUSH_MS = 16;

interface SyncContextValue {
  readonly store: SyncStoreShape;
  readonly dispatch: (event: SyncEvent) => void;
  readonly reset: () => void;
}

const SyncContext = createContext<SyncContextValue>();

export const useSync = (): SyncContextValue => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync must be used inside SyncProvider");
  }
  return context;
};

interface SyncProviderProps {
  readonly children: JSX.Element;
}

export const SyncProvider = (props: SyncProviderProps) => {
  const [store, setStore] = createStore<SyncStoreShape>({ ...INITIAL_SYNC_STORE });

  let pendingEvents: SyncEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    flushTimer = undefined;
    if (pendingEvents.length === 0) return;

    const events = pendingEvents;
    pendingEvents = [];

    batch(() => {
      let current: SyncStoreShape = { ...store };
      for (const event of events) {
        current = syncReducer(current, event);
      }
      setStore(current);
    });
  };

  const dispatch = (event: SyncEvent) => {
    pendingEvents.push(event);
    if (flushTimer === undefined) {
      flushTimer = setTimeout(flush, BATCH_FLUSH_MS);
    }
  };

  const reset = () => {
    pendingEvents = [];
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    setStore({ ...INITIAL_SYNC_STORE });
  };

  return (
    <SyncContext.Provider value={{ store, dispatch, reset }}>
      {props.children}
    </SyncContext.Provider>
  );
};
