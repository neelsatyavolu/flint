import { useEffect, useRef } from "react";
import { OPEN_SETTINGS_EVENT, OPEN_THREAD_EVENT } from "../features/ai/events";
import { getHost } from "../lib/host";
import { navStore } from "../state/nav";
import { handleMenuAction } from "./menuActions";
import type { AppCommands } from "./useAppCommands";

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
          host.onMenu((action, arg) => void handleMenuAction(action, arg, ref.current)),
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
