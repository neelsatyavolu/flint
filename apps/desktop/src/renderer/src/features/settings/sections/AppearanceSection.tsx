import { Columns2, Palette, UserRound, Globe, AlignLeft, Rows3, Brush } from "lucide-react";
import { useAccounts, useUpdateAccount } from "../useAccounts";
import { Avatar, SectionLabel, SettingsRow } from "../../../ui";
import { ColorSwatches } from "../ColorSwatches";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import styles from "../settings.module.css";

export function AppearanceSection() {
  const { settings: s, save } = useSettingsStore();
  const { accounts } = useAccounts();
  const updateAccount = useUpdateAccount();
  const a = s.appearance;
  return (
    <SectionPage title="Appearance">
      <SelectRow
        icon={<Columns2 size={18} strokeWidth={1.5} />}
        title="Layout"
        description="Split shows the list beside the reader. Full screen opens a thread over the list."
        value={a.layout}
        choices={[{ value: "split", label: "Split view" }, { value: "full", label: "Full screen" }]}
        onChange={(v) => void save({ appearance: { layout: v } })}
      />
      <SelectRow
        icon={<Palette size={18} strokeWidth={1.5} />}
        title="Theme"
        value={a.theme}
        choices={[{ value: "system", label: "As in system" }, { value: "dark", label: "Graphite (dark)" }, { value: "light", label: "Paper (light)" }]}
        onChange={(v) => void save({ appearance: { theme: v } })}
      />
      <SelectRow
        icon={<UserRound size={18} strokeWidth={1.5} />}
        title="Show avatars"
        value={a.avatars}
        choices={[{ value: "everywhere", label: "Everywhere" }, { value: "list", label: "In the list only" }, { value: "off", label: "Off" }]}
        onChange={(v) => void save({ appearance: { avatars: v } })}
      />
      <ToggleRow
        icon={<Globe size={18} strokeWidth={1.5} />}
        title="Sender logos"
        description="Fetch the website icon for senders that are not people. This contacts the sender's domain."
        checked={a.senderLogos}
        onChange={(v) => void save({ appearance: { senderLogos: v } })}
      />
      <SelectRow
        icon={<AlignLeft size={18} strokeWidth={1.5} />}
        title="Lines in preview"
        value={a.previewLines}
        choices={[{ value: 0, label: "None" }, { value: 1, label: "1 line" }, { value: 2, label: "2 lines" }]}
        onChange={(v) => void save({ appearance: { previewLines: v } })}
      />
      <SelectRow
        icon={<Rows3 size={18} strokeWidth={1.5} />}
        title="Mail list view"
        value={a.density}
        choices={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
        onChange={(v) => void save({ appearance: { density: v } })}
      />
      <ToggleRow
        icon={<Brush size={18} strokeWidth={1.5} />}
        title="Color coding for accounts"
        description="Mark each account's mail with its color in unified lists."
        checked={a.accountColors}
        onChange={(v) => void save({ appearance: { accountColors: v } })}
      />
      {a.accountColors && accounts && accounts.length > 0 ? (
        <div className={styles.group}>
          <SectionLabel className={styles.groupLabel}>Account colors</SectionLabel>
          {accounts.map((acc) => (
            <SettingsRow key={acc.id} icon={<Avatar address={acc.email} name={acc.name} size={24} />} title={acc.email} description={acc.name}>
              <ColorSwatches
                value={acc.color}
                label={`Color for ${acc.email}`}
                onChange={(c) => void updateAccount(acc.id, { color: c })}
              />
            </SettingsRow>
          ))}
        </div>
      ) : null}
    </SectionPage>
  );
}
