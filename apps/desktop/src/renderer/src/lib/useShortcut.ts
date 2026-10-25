import { useEffect, useRef } from "react";
import { shortcuts, type ShortcutHandler, type ShortcutOptions } from "./shortcuts";

/** Registers a shortcut on the app registry for the lifetime of the component. */
export function useShortcut(combo: string | string[], handler: ShortcutHandler, options: ShortcutOptions = {}): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const optsRef = useRef(options);
  optsRef.current = options;
  const key = Array.isArray(combo) ? combo.join("|") : combo;
  useEffect(
    () =>
      shortcuts.register(key.split("|"), (e) => handlerRef.current(e), {
        get allowInInput() {
          return optsRef.current.allowInInput;
        },
        get preventDefault() {
          return optsRef.current.preventDefault;
        },
        when: () => (optsRef.current.when ? optsRef.current.when() : true),
      }),
    [key],
  );
}
