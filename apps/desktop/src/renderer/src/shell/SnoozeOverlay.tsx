import { DateTimePanel } from "../ui";
import { navStore, useNav } from "../state/nav";
import { useThreadActions } from "../state/useActions";
import { Modal } from "./Modal";

export function SnoozeOverlay() {
  const ids = useNav((s) => s.overlayIds);
  const { run } = useThreadActions();
  const close = () => navStore.getState().closeOverlay();
  return (
    <Modal open onClose={close} label="Snooze" width={320}>
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
