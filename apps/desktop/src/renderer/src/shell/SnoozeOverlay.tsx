import { useMemo } from "react";
import { DateTimePanel } from "../ui";
import { navStore, useNav } from "../state/nav";
import { useThreadActions } from "../state/useActions";
import { Modal } from "./Modal";

export function SnoozeOverlay() {
  const ids = useNav((s) => s.overlayIds);
  const { run } = useThreadActions();
  // Beside the toolbar's Snooze button, or the row being snoozed when the reader is closed.
  const anchor = useMemo(() => {
    const el = document.querySelector<HTMLElement>("[data-snooze-anchor]:not(:disabled)") ?? (ids.length === 1 ? document.querySelector<HTMLElement>(`[data-thread-id="${ids[0]}"]`) : null);
    return el?.getBoundingClientRect() ?? null;
  }, [ids]);
  const close = () => navStore.getState().closeOverlay();
  return (
    <Modal open onClose={close} label="Snooze" width={320} anchor={anchor}>
      <DateTimePanel
        title="Snooze until"
        onPick={(at) => {
          close();
          void run({ type: "snooze", until: at }, ids);
        }}
      />
    </Modal>
  );
}
