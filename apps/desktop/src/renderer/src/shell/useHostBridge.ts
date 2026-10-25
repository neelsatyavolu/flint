import { useEffect, useRef } from "react";
import { getHost } from "../lib/host";
import { navStore } from "../state/nav";
import { handleMenuAction } from "./menuActions";
import type { AppCommands } from "./useAppCommands";

type MenuHost = { onMenu(cb: (action: string, arg?: string) => void): () => void };

/** Notification clicks open their thread; native menu clicks and mailto links run app commands. */
export function useHostBridge(cmds: AppCommands): void {
  const ref = useRef(cmds);
  ref.current = cmds;
  useEffect(() => {
    const host = getHost();
    if (!host) return;
    const offThread = host.onOpenThread((id) => navStore.getState().openThread(id, { fromOutside: true }));
    const offMenu = (host as unknown as MenuHost).onMenu((action, arg) => void handleMenuAction(action, arg, ref.current));
    return () => {
      offThread();
      offMenu();
    };
  }, []);
}
