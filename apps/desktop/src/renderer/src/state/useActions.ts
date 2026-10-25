import { useCallback, useMemo } from "react";
import { flint } from "../lib/api";
import { useToast } from "../ui/Toast";
import { useApp } from "./AppContext";
import { performAction, undoLast, type ThreadAction } from "./actions";
import { listStore } from "./listStore";
import { navStore, targetIds } from "./nav";

/** Thread actions bound to the real API, stores and toast. `ids` defaults to the current target. */
export function useThreadActions() {
  const toast = useToast();
  const { settings } = useApp();
  const getSettings = useCallback(() => settings, [settings]);
  return useMemo(() => {
    const deps = {
      api: flint,
      list: listStore,
      nav: navStore,
      getSettings,
      notify: (t: { message: string; action?: { label: string; onClick: () => void }; level?: "info" | "error" }) => {
        toast.show(t);
      },
    };
    return {
      run: (action: ThreadAction, ids?: number[]) => performAction(deps, action, ids ?? targetIds(navStore.getState())),
      undo: () => undoLast(deps),
    };
  }, [toast, getSettings]);
}
