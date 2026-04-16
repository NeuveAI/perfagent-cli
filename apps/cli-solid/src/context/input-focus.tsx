import { createSignal, createContext, useContext, type JSX } from "solid-js";

interface InputFocusState {
  readonly focused: () => boolean;
  readonly setFocused: (value: boolean) => void;
}

const InputFocusContext = createContext<InputFocusState>();

export const useInputFocus = (): InputFocusState => {
  const context = useContext(InputFocusContext);
  if (!context) {
    throw new Error("useInputFocus must be used inside InputFocusProvider");
  }
  return context;
};

interface InputFocusProviderProps {
  readonly children: JSX.Element;
}

export const InputFocusProvider = (props: InputFocusProviderProps) => {
  const [focused, setFocused] = createSignal(false);

  return (
    <InputFocusContext.Provider value={{ focused, setFocused }}>
      {props.children}
    </InputFocusContext.Provider>
  );
};
