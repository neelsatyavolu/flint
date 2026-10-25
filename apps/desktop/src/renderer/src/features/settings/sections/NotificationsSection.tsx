import { Bell, Users, Volume2 } from "lucide-react";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";

export function NotificationsSection() {
  const { settings: s, save } = useSettingsStore();
  const n = s.notifications;
  return (
    <SectionPage title="Notifications">
      <ToggleRow icon={<Bell size={18} strokeWidth={1.5} />} title="Show notifications" description="A system notification for new mail." checked={n.enabled} onChange={(v) => void save({ notifications: { enabled: v } })} />
      <SelectRow
        icon={<Users size={18} strokeWidth={1.5} />}
        title="Notify for"
        description="People means mail Flint files under people, not notifications or newsletters."
        value={n.scope}
        disabled={!n.enabled}
        choices={[{ value: "people", label: "People" }, { value: "all", label: "All new mail" }, { value: "none", label: "Nothing" }]}
        onChange={(v) => void save({ notifications: { scope: v } })}
      />
      <ToggleRow icon={<Volume2 size={18} strokeWidth={1.5} />} title="Sound" checked={n.sound} disabled={!n.enabled} onChange={(v) => void save({ notifications: { sound: v } })} />
    </SectionPage>
  );
}
