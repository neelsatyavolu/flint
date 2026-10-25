import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";

/** Lets a thread hold its reveal until the mail frames in it know their height, so nothing shifts afterwards. */
export type FrameGate = { begin: () => () => void };

export const FrameGateContext = createContext<FrameGate | null>(null);

/** Registers one frame with the surrounding thread. Returns the function the frame calls when it is sized. */
export function useFrameGate(): () => void {
  const gate = useContext(FrameGateContext);
  const done = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    done.current = gate?.begin() ?? null;
    return () => {
      done.current?.();
      done.current = null;
    };
  }, [gate]);
  return useCallback(() => done.current?.(), []);
}
