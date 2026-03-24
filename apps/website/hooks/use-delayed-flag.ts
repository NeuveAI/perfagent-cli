"use client";

/* eslint-disable no-restricted-imports -- internal hook wrapping useEffect for delayed boolean transitions */
import { useEffect, useState } from "react";

export const useDelayedFlag = (trigger: boolean, delayMs: number, resetKey = 0): boolean => {
  const [state, setState] = useState({
    value: false,
    resetKey,
  });
  const value = state.resetKey === resetKey ? state.value : false;

  useEffect(() => {
    if (state.resetKey !== resetKey) {
      setState({
        value: false,
        resetKey,
      });
      return;
    }
    if (!trigger || value) return;
    const timer = window.setTimeout(
      () =>
        setState({
          value: true,
          resetKey,
        }),
      delayMs,
    );
    return () => window.clearTimeout(timer);
  }, [trigger, value, delayMs, resetKey, state.resetKey]);

  return value;
};
