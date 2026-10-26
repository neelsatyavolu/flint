import { useContext, useEffect, useState, type JSX } from "react";
import {
  Bot, Eye, FileText, Filter, Info, Inbox, Keyboard, KeyRound, type LucideIcon, Bell, Ban, Palette, PenLine, SlidersHorizontal, Sparkles, UserRound, X,
} from "lucide-react";
import { useShortcut } from "../../lib/useShortcut";
import { IconButton, Skeleton } from "../../ui";
import { AppContext } from "../../state/AppContext";
import { SECTIONS, SECTION_VIEWS, parseSection, type SectionId } from "./sections";
import { SettingsProvider } from "./settingsStore";
import styles from "./settings.module.css";

const ICONS: Record<SectionId, LucideIcon> = {
  general: SlidersHorizontal, accounts: UserRound, appearance: Palette, inbox: Inbox, signatures: PenLine, templates: FileText,
  rules: Filter, receipts: Eye, notifications: Bell, codes: KeyRound, ai: Sparkles, agents: Bot, shortcuts: Keyboard, blocked: Ban, about: Info,
};

/** Full view replacing list and reader. `section` deep-links ("rules", "ai/writing"); Esc and the close button call onClose. */
export function SettingsView(props: { section?: string; onClose: () => void }): JSX.Element {
  const [target, setTarget] = useState(() => parseSection(props.section));
  useEffect(() => setTarget(parseSection(props.section)), [props.section]);

  useShortcut("Escape", () => {
    // A dialog or menu handles its own Esc.
    if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return false;
    props.onClose();
  });

  const initial = useContext(AppContext)?.settings;
  const View = SECTION_VIEWS[target.id];
  return (
    <div className={styles.root}>
      <nav className={styles.nav} aria-label="Settings sections">
        <div className={styles.navTop}>
          <span className="t-title">Settings</span>
          <IconButton label="Close settings" shortcut="Escape" size={28} onClick={props.onClose}><X size={16} strokeWidth={1.5} /></IconButton>
        </div>
        <div className={styles.navList}>
          {SECTIONS.map((s) => {
            const Icon = ICONS[s.id];
            const on = s.id === target.id;
            return (
              <button key={s.id} type="button" className={`${styles.navItem} ${on ? styles.navOn : ""}`} aria-current={on ? "page" : undefined} onClick={() => setTarget({ id: s.id })}>
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>
      <main className={styles.scroll}>
        <div className={styles.column}>
          <SettingsProvider initial={initial} fallback={<Skeleton height={240} />}>
            <View key={`${target.id}:${target.page ?? ""}`} page={target.page} />
          </SettingsProvider>
        </div>
      </main>
    </div>
  );
}
