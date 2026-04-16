import { createSignal, createContext, useContext, type JSX } from "solid-js";

const DEFAULT_TOAST_DURATION_MS = 3000;

interface ToastEntry {
  readonly message: string;
  readonly id: number;
}

interface ToastQueue {
  readonly show: (message: string, durationMs?: number) => void;
  readonly current: () => ToastEntry | undefined;
  readonly dismiss: () => void;
}

const ToastContext = createContext<ToastQueue>();

export const useToast = (): ToastQueue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
};

interface ToastProviderProps {
  readonly children: JSX.Element;
}

let nextToastId = 0;

export const ToastProvider = (props: ToastProviderProps) => {
  const [current, setCurrent] = createSignal<ToastEntry | undefined>(undefined);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
    setCurrent(undefined);
  };

  const show = (message: string, durationMs: number = DEFAULT_TOAST_DURATION_MS) => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
    }
    const id = nextToastId++;
    setCurrent({ message, id });
    dismissTimer = setTimeout(() => {
      setCurrent((prev) => {
        if (prev?.id === id) return undefined;
        return prev;
      });
      dismissTimer = undefined;
    }, durationMs);
  };

  const toastQueue: ToastQueue = { show, current, dismiss };

  return <ToastContext.Provider value={toastQueue}>{props.children}</ToastContext.Provider>;
};
