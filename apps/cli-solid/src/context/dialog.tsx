import { createSignal, createContext, useContext, type JSX } from "solid-js";

interface DialogEntry {
  readonly element: JSX.Element;
  readonly onClose?: () => void;
}

interface DialogStack {
  readonly push: (element: JSX.Element, onClose?: () => void) => void;
  readonly replace: (element: JSX.Element, onClose?: () => void) => void;
  readonly pop: () => void;
  readonly clear: () => void;
  readonly top: () => JSX.Element | undefined;
  readonly isEmpty: () => boolean;
  readonly depth: () => number;
}

const DialogContext = createContext<DialogStack>();

export const useDialogStack = (): DialogStack => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialogStack must be used inside DialogProvider");
  }
  return context;
};

interface DialogProviderProps {
  readonly children: JSX.Element;
}

export const DialogProvider = (props: DialogProviderProps) => {
  const [stack, setStack] = createSignal<readonly DialogEntry[]>([]);

  const push = (element: JSX.Element, onClose?: () => void) => {
    setStack((previous) => [...previous, { element, onClose }]);
  };

  const replace = (element: JSX.Element, onClose?: () => void) => {
    setStack((previous) => {
      for (const entry of previous) {
        entry.onClose?.();
      }
      return [{ element, onClose }];
    });
  };

  const pop = () => {
    setStack((previous) => {
      if (previous.length === 0) return previous;
      const topEntry = previous[previous.length - 1];
      topEntry?.onClose?.();
      return previous.slice(0, -1);
    });
  };

  const clear = () => {
    setStack((previous) => {
      for (const entry of previous) {
        entry.onClose?.();
      }
      return [];
    });
  };

  const top = (): JSX.Element | undefined => {
    const current = stack();
    if (current.length === 0) return undefined;
    return current[current.length - 1]?.element;
  };

  const isEmpty = (): boolean => stack().length === 0;

  const depth = (): number => stack().length;

  const dialogStack: DialogStack = { push, replace, pop, clear, top, isEmpty, depth };

  return <DialogContext.Provider value={dialogStack}>{props.children}</DialogContext.Provider>;
};
