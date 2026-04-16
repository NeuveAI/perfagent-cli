import { Show } from "solid-js";
import { useToast } from "../context/toast";
import { COLORS } from "../constants";

export const ToastDisplay = () => {
  const toast = useToast();

  return (
    <Show when={toast.current()}>
      {(entry) => (
        <box paddingLeft={1} paddingRight={1}>
          <text style={{ fg: COLORS.WARNING }}>{entry().message}</text>
        </box>
      )}
    </Show>
  );
};
