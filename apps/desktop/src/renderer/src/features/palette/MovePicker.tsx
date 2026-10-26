import { useMemo } from "react";
import { Archive, Folder, Inbox, Trash2 } from "lucide-react";
import type { Folder as FolderRow } from "@flint/core";
import { Picker, type PickerItem } from "../../shell/Picker";
import { useApp } from "../../state/AppContext";
import { listStore } from "../../state/listStore";
import { navStore, useNav } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { moveTargets } from "./moveTargets";

const I = { size: 14, strokeWidth: 1.5 } as const;

function iconFor(f: FolderRow) {
  if (f.role === "inbox") return <Inbox {...I} />;
  if (f.role === "archive") return <Archive {...I} />;
  if (f.role === "trash") return <Trash2 {...I} />;
  return <Folder {...I} />;
}

/** Move to folder with typeahead, for the account of the first target thread. */
export function MovePicker() {
  const { sidebar, accounts } = useApp();
  const ids = useNav((s) => s.overlayIds);
  const { run } = useThreadActions();

  const folders = useMemo(() => {
    const accountId = listStore.getState().raw.find((i) => i.id === ids[0])?.accountId ?? accounts[0]?.id;
    return moveTargets(sidebar, accountId);
  }, [sidebar, accounts, ids]);

  const items: PickerItem[] = folders.map((f) => ({ id: String(f.id), label: f.name, icon: iconFor(f) }));
  const close = () => navStore.getState().closeOverlay();

  return (
    <Picker
      label="Move to folder"
      placeholder="Move to…"
      items={items}
      emptyText="No folder matches."
      width={420}
      onClose={close}
      onPick={(item) => {
        const folder = folders.find((f) => String(f.id) === item.id);
        close();
        if (!folder) return;
        void run(folder.role === "inbox" ? { type: "inbox" } : { type: "move", folderId: folder.id, folderName: folder.name }, ids);
      }}
    />
  );
}
