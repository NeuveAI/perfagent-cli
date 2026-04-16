import { describe, test, expect } from "bun:test";
import { createSignal } from "solid-js";

// Test the dialog stack logic directly, without JSX rendering.
// The DialogProvider uses createSignal internally, so we replicate
// the exact same stack semantics here for unit testing.

interface DialogEntry {
  readonly element: string;
  readonly onClose?: () => void;
}

const createDialogStack = () => {
  const [stack, setStack] = createSignal<readonly DialogEntry[]>([]);

  const push = (element: string, onClose?: () => void) => {
    setStack((previous) => [...previous, { element, onClose }]);
  };

  const replace = (element: string, onClose?: () => void) => {
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

  const top = (): string | undefined => {
    const current = stack();
    if (current.length === 0) return undefined;
    return current[current.length - 1]?.element;
  };

  const isEmpty = (): boolean => stack().length === 0;
  const depth = (): number => stack().length;

  return { push, replace, pop, clear, top, isEmpty, depth };
};

describe("dialog stack", () => {
  test("starts empty", () => {
    const dialog = createDialogStack();
    expect(dialog.isEmpty()).toBe(true);
    expect(dialog.depth()).toBe(0);
    expect(dialog.top()).toBeUndefined();
  });

  test("push adds to the stack", () => {
    const dialog = createDialogStack();
    dialog.push("dialog-a");
    expect(dialog.isEmpty()).toBe(false);
    expect(dialog.depth()).toBe(1);
    expect(dialog.top()).toBe("dialog-a");
  });

  test("push multiple elements stacks them", () => {
    const dialog = createDialogStack();
    dialog.push("dialog-a");
    dialog.push("dialog-b");
    dialog.push("dialog-c");
    expect(dialog.depth()).toBe(3);
    expect(dialog.top()).toBe("dialog-c");
  });

  test("pop removes the top element", () => {
    const dialog = createDialogStack();
    dialog.push("dialog-a");
    dialog.push("dialog-b");
    dialog.pop();
    expect(dialog.depth()).toBe(1);
    expect(dialog.top()).toBe("dialog-a");
  });

  test("pop on empty stack is a no-op", () => {
    const dialog = createDialogStack();
    dialog.pop();
    expect(dialog.isEmpty()).toBe(true);
    expect(dialog.depth()).toBe(0);
  });

  test("pop calls onClose of the removed entry", () => {
    const dialog = createDialogStack();
    let closedA = false;
    let closedB = false;
    dialog.push("dialog-a", () => { closedA = true; });
    dialog.push("dialog-b", () => { closedB = true; });
    dialog.pop();
    expect(closedB).toBe(true);
    expect(closedA).toBe(false);
  });

  test("clear removes all entries and calls all onClose callbacks", () => {
    const dialog = createDialogStack();
    const closed: string[] = [];
    dialog.push("dialog-a", () => closed.push("a"));
    dialog.push("dialog-b", () => closed.push("b"));
    dialog.push("dialog-c", () => closed.push("c"));
    dialog.clear();
    expect(dialog.isEmpty()).toBe(true);
    expect(dialog.depth()).toBe(0);
    expect(closed).toEqual(["a", "b", "c"]);
  });

  test("replace clears existing entries, calls their onClose, and pushes new entry", () => {
    const dialog = createDialogStack();
    const closed: string[] = [];
    dialog.push("dialog-a", () => closed.push("a"));
    dialog.push("dialog-b", () => closed.push("b"));
    dialog.replace("dialog-c");
    expect(dialog.depth()).toBe(1);
    expect(dialog.top()).toBe("dialog-c");
    expect(closed).toEqual(["a", "b"]);
  });

  test("replace on empty stack just pushes", () => {
    const dialog = createDialogStack();
    dialog.replace("dialog-a");
    expect(dialog.depth()).toBe(1);
    expect(dialog.top()).toBe("dialog-a");
  });

  test("replace followed by pop calls the replacement onClose", () => {
    const dialog = createDialogStack();
    let replacementClosed = false;
    dialog.push("old");
    dialog.replace("new", () => { replacementClosed = true; });
    dialog.pop();
    expect(replacementClosed).toBe(true);
    expect(dialog.isEmpty()).toBe(true);
  });

  test("multiple pop calls unwind one at a time", () => {
    const dialog = createDialogStack();
    const closed: string[] = [];
    dialog.push("a", () => closed.push("a"));
    dialog.push("b", () => closed.push("b"));
    dialog.push("c", () => closed.push("c"));
    dialog.pop();
    expect(closed).toEqual(["c"]);
    dialog.pop();
    expect(closed).toEqual(["c", "b"]);
    dialog.pop();
    expect(closed).toEqual(["c", "b", "a"]);
    dialog.pop();
    expect(closed).toEqual(["c", "b", "a"]);
  });

  test("push without onClose does not fail on pop", () => {
    const dialog = createDialogStack();
    dialog.push("no-close-handler");
    expect(() => dialog.pop()).not.toThrow();
    expect(dialog.isEmpty()).toBe(true);
  });

  test("depth reflects push and pop operations correctly", () => {
    const dialog = createDialogStack();
    expect(dialog.depth()).toBe(0);
    dialog.push("a");
    expect(dialog.depth()).toBe(1);
    dialog.push("b");
    expect(dialog.depth()).toBe(2);
    dialog.pop();
    expect(dialog.depth()).toBe(1);
    dialog.clear();
    expect(dialog.depth()).toBe(0);
  });
});
