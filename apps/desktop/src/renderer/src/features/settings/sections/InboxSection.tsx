import { Inbox, Image, ShieldCheck } from "lucide-react";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";

export function InboxSection() {
  const { settings: s, save } = useSettingsStore();
  return (
    <SectionPage title="Inbox" description="Smart inbox keeps mail from people in the list and folds notifications and newsletters into bundles.">
      <ToggleRow
        icon={<Inbox size={18} strokeWidth={1.5} />}
        title="Focused inbox by default"
        description="Show people first. You can switch to all mail from the list header."
        checked={s.inbox.focused}
        onChange={(v) => void save({ inbox: { focused: v } })}
      />
      <SelectRow
        icon={<Image size={18} strokeWidth={1.5} />}
        title="Remote images"
        description="Images in mail are loaded from the sender's server, which tells them you opened it."
        value={s.inbox.remoteImages}
        choices={[{ value: "never", label: "Never load" }, { value: "known_senders", label: "Known senders" }, { value: "always", label: "Always load" }]}
        onChange={(v) => void save({ inbox: { remoteImages: v } })}
      />
      <ToggleRow
        icon={<ShieldCheck size={18} strokeWidth={1.5} />}
        title="Block trackers"
        description="Remove known tracking pixels from incoming mail before it is shown."
        checked={s.inbox.blockTrackers}
        onChange={(v) => void save({ inbox: { blockTrackers: v } })}
      />
    </SectionPage>
  );
}
