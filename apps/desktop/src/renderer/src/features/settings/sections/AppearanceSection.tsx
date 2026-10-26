import { useEffect, useState } from "react";
import { Columns2, Palette, UserRound, Globe, AlignLeft, Rows3, Brush, Image, Moon, Type } from "lucide-react";
import { applyTextSize, readTextSize, TEXT_SIZES, type TextSize } from "../../../lib/host";
import { useAccounts, useUpdateAccount } from "../useAccounts";
import { Avatar, SectionLabel, SegmentedControl, SettingsRow } from "../../../ui";
import { ColorSwatches } from "../ColorSwatches";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import styles from "../settings.module.css";

/** Window event fired when View > Zoom changes the text size, so an open Settings page follows it. */
export const TEXT_SIZE_EVENT = "flint:text-size";

/**
 * View > Zoom In (1), Zoom Out (-1) and Actual Size (0). Steps through the Text size choices and saves the result,
 * so the menu and the setting are one zoom and it survives a restart.
 */
export function stepTextSize(step: -1 | 0 | 1): void {
  const i = TEXT_SIZES.findIndex((t) => t.value === readTextSize());
  const next = step === 0 ? "default" : TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + step))]!.value;
  applyTextSize(next, true);
  window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
}

export function AppearanceSection() {
  const { settings: s, save } = useSettingsStore();
  const { accounts } = useAccounts();
  const updateAccount = useUpdateAccount();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  useEffect(() => {
    const follow = () => setTextSize(readTextSize());
    window.addEventListener(TEXT_SIZE_EVENT, follow);
    return () => window.removeEventListener(TEXT_SIZE_EVENT, follow);
  }, []);
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
      <SettingsRow icon={<Type size={18} strokeWidth={1.5} />} title="Text size" description="Scales the whole window. Saved on this computer.">
        <SegmentedControl
          label="Text size"
          value={textSize}
          options={TEXT_SIZES.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(v) => {
            applyTextSize(v, true);
            setTextSize(v);
          }}
        />
      </SettingsRow>
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
        description="Website icons for senders that are not people. Flint does not fetch these yet, so this setting does nothing for now."
        checked={a.senderLogos}
        onChange={(v) => void save({ appearance: { senderLogos: v } })}
      />
      <ToggleRow
        icon={<Image size={18} strokeWidth={1.5} />}
        title="Sender photos"
        description="Off by default. When on, Flint asks gravatar.com for a photo for each sender it shows, sending a SHA-256 hash of their address (Gravatar can match that hash to a known address) and your IP address. Photos are kept on this computer for 7 days."
        checked={a.senderPhotos}
        onChange={(v) => void save({ appearance: { senderPhotos: v } })}
      />
      <SelectRow
        icon={<Moon size={18} strokeWidth={1.5} />}
        title="Email in dark mode"
        description="Match adapts the colors of HTML mail to the dark theme. Light always shows the original white page."
        value={a.emailAppearance}
        choices={[{ value: "match", label: "Match the theme" }, { value: "light", label: "Always original" }]}
        onChange={(v) => void save({ appearance: { emailAppearance: v } })}
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
            <SettingsRow key={acc.id} icon={<Avatar address={acc.email} name={acc.name} accountId={acc.id} size={24} />} title={acc.email} description={acc.name}>
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
