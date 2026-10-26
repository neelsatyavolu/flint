import { useEffect, useRef } from "react";
import { OPEN_SETTINGS_EVENT, OPEN_THREAD_EVENT } from "../features/ai/events";
import { stepTextSize } from "../features/settings/sections/AppearanceSection";
import { getHost } from "../lib/host";
import { navStore } from "../state/nav";
import { handleMenuAction } from "./menuActions";
import type { AppCommands } from "./useAppCommands";
import { undoAction } from "./useGlobalShortcuts";

/** Window event the reader listens for to print the open conversation (File, Print). */
export const PRINT_EVENT = "flint:print";

/** Menu actions that act on the page itself rather than on app state. Returns false for anything else. */
export function handleHostAction(action: string, cmds: Pick<AppCommands, "undo">): boolean {
  switch (action) {
    case "undo":
      undoAction(cmds);
      return true;
    case "text-size:bigger":
    case "text-size:smaller":
    case "text-size:reset":
      stepTextSize(action === "text-size:bigger" ? 1 : action === "text-size:smaller" ? -1 : 0);
      return true;
    case "print":
      window.dispatchEvent(new Event(PRINT_EVENT));
      return true;
    default:
      return false;
  }
}

/**
 * Notification clicks open their thread; native menu clicks and mailto links run app commands.
 * Also handles the window events the AI surfaces dispatch (open settings, open a cited thread).
 */
export function useHostBridge(cmds: AppCommands): void {
  const ref = useRef(cmds);
  ref.current = cmds;
  useEffect(() => {
    const host = getHost();
    const offHost = host
      ? [
          host.onOpenThread((id) => navStore.getState().openThread(id, { fromOutside: true })),
          host.onMenu((action, arg) => {
            if (!handleHostAction(action, ref.current)) handleMenuAction(action, arg, ref.current);
          }),
        ]
      : [];
    const onSettings = (e: Event) => navStore.getState().openSettings((e as CustomEvent<{ section?: string }>).detail?.section);
    const onThread = (e: Event) => {
      const id = (e as CustomEvent<{ threadId?: number }>).detail?.threadId;
      if (typeof id === "number") navStore.getState().openThread(id, { fromOutside: true });
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onSettings);
    window.addEventListener(OPEN_THREAD_EVENT, onThread);
    return () => {
      for (const off of offHost) off();
      window.removeEventListener(OPEN_SETTINGS_EVENT, onSettings);
      window.removeEventListener(OPEN_THREAD_EVENT, onThread);
    };
  }, []);
}
