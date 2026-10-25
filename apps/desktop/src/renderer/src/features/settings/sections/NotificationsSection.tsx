import { Bell, BellRing, Eye, Mail, Music, Users, Volume2 } from "lucide-react";
import { NOTIFICATION_SOUNDS } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { Button, SettingsRow, useToast } from "../../../ui";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import { errorText, useAccounts } from "../useAccounts";
import styles from "../settings.module.css";

const SOUND_CHOICES = NOTIFICATION_SOUNDS.map((value) => ({ value, label: value === "default" ? "System default" : value }));

export function NotificationsSection() {
  const { settings: s, save } = useSettingsStore();
  const toast = useToast();
  const { accounts } = useAccounts();
  const n = s.notifications;
  const off = !n.enabled;

  const setAccount = (id: string, on: boolean) => {
    const rest = n.disabledAccounts.filter((x) => x !== id);
    void save({ notifications: { disabledAccounts: on ? rest : [...rest, id] } });
  };
  const sendTest = async () => {
    try {
      await flint.sendTestNotification();
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't send a test notification. Try again."), level: "error" });
    }
  };

  return (
    <SectionPage title="Notifications" description="Alerts for new mail. Clicking one opens the conversation. On a Mac you can also archive it or mark it read from the alert.">
      <ToggleRow icon={<Bell size={18} strokeWidth={1.5} />} title="Show notifications" description="A system notification for new mail." checked={n.enabled} onChange={(v) => void save({ notifications: { enabled: v } })} />
      <SelectRow
        icon={<Users size={18} strokeWidth={1.5} />}
        title="Notify for"
        description="People only means mail Flint files under people, not notifications or newsletters. A rule can still ask for an alert."
        value={n.scope}
        disabled={off}
        choices={[{ value: "all", label: "All new mail" }, { value: "people", label: "People only" }, { value: "none", label: "None" }]}
        onChange={(v) => void save({ notifications: { scope: v } })}
      />
      {accounts && accounts.length > 1 ? (
        <>
          <div className={`t-label ${styles.muted}`} style={{ padding: "var(--s-5) 0 0" }}>Accounts</div>
          {accounts.map((a) => (
            <ToggleRow
              key={a.id}
              icon={<Mail size={18} strokeWidth={1.5} />}
              title={a.email}
              label={`Notify for ${a.email}`}
              description="Alerts for new mail that matches Notify for above."
              checked={!n.disabledAccounts.includes(a.id)}
              disabled={off || n.scope === "none"}
              onChange={(v) => setAccount(a.id, v)}
            />
          ))}
        </>
      ) : null}
      <ToggleRow icon={<Volume2 size={18} strokeWidth={1.5} />} title="Sound" checked={n.sound} disabled={off} onChange={(v) => void save({ notifications: { sound: v } })} />
      <SelectRow
        icon={<Music size={18} strokeWidth={1.5} />}
        title="Sound to play"
        description={n.sound ? "One of the sounds that come with macOS." : "Turn on Sound to choose one."}
        value={n.soundName}
        disabled={off || !n.sound}
        choices={SOUND_CHOICES}
        onChange={(v) => void save({ notifications: { soundName: v } })}
      />
      <SelectRow
        icon={<Eye size={18} strokeWidth={1.5} />}
        title="Preview"
        description="What an alert shows. Choose Just New mail to keep subjects off your screen."
        value={n.preview}
        disabled={off}
        choices={[
          { value: "sender_subject", label: "Sender and subject" },
          { value: "sender_subject_line", label: "Sender, subject and first line" },
          { value: "none", label: "Just New mail" },
        ]}
        onChange={(v) => void save({ notifications: { preview: v } })}
      />
      <SelectRow
        icon={<BellRing size={18} strokeWidth={1.5} />}
        title="Dock badge"
        description="The number on the Flint icon. The unified inbox leaves out accounts you hid from it."
        value={n.badge}
        choices={[
          { value: "unified_unread", label: "Unread in unified inbox" },
          { value: "people_unread", label: "Unread people mail" },
          { value: "off", label: "Off" },
        ]}
        onChange={(v) => void save({ notifications: { badge: v } })}
      />
      <SettingsRow icon={<Bell size={18} strokeWidth={1.5} />} title="Try it" description="Sends one alert now with your sound.">
        <Button variant="ghost" onClick={() => void sendTest()}>Send a test notification</Button>
      </SettingsRow>
      <span className={styles.muted} style={{ display: "block", padding: "var(--s-3) 0" }}>Several new messages that arrive together become one alert.</span>
    </SectionPage>
  );
}
