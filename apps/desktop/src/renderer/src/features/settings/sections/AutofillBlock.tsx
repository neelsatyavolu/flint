import { useEffect, useState } from "react";
import { Keyboard, ScanText, ShieldCheck } from "lucide-react";
import type { AutofillState, AutofillStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, SectionLabel, SettingsRow } from "../../../ui";
import { acceleratorFromEvent, formatAccelerator } from "../accelerator";
import { ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

/** Status line text and tone for each state. Exported for tests. */
export function autofillState(s: AutofillStatus | undefined): { text: string; tone: "ok" | "muted" | "err" } {
  if (!s) return { text: "Checking…", tone: "muted" };
  if (!s.supported) return { text: "Not available in this build of Flint", tone: "muted" };
  const text: Record<AutofillState, string> = {
    off: "Off",
    unavailable: "Starting…",
    needs_permission: "Needs Accessibility permission",
    ready: "Ready",
  };
  return { text: text[s.state], tone: s.state === "ready" ? "ok" : s.state === "needs_permission" ? "err" : "muted" };
}

/** While the permission is missing, look again this often: the grant happens in System Settings and Flint gets no event for it. */
export const PERMISSION_POLL_MS = 1500;

export function AutofillBlock() {
  const { settings: s, save } = useSettingsStore();
  const status = useFlintQuery((api) => api.autofillStatus(), [], { mail: false, refetchOn: ["settings"] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const c = s.codes;
  const a = status.data;
  const { refetch } = status;

  // The permission is granted in System Settings, so look again whenever the user comes back to Flint.
  useEffect(() => {
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [refetch]);

  const needsPermission = a?.supported === true && a.state === "needs_permission";
  useEffect(() => {
    if (!needsPermission) return;
    const id = setInterval(refetch, PERMISSION_POLL_MS);
    return () => clearInterval(id);
  }, [needsPermission, refetch]);

  const enable = async () => {
    setMsg(null);
    try {
      const next = await flint.requestAutofillPermission();
      refetch();
      if (next.state !== "ready") setMsg({ ok: true, text: "Switch on Flint in the Accessibility list, then come back here." });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, "Couldn't ask for Accessibility permission.") });
    }
  };

  const tryIt = async () => {
    setMsg(null);
    try {
      await flint.tryAutofillDemo();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, "Couldn't open the sample field.") });
    }
  };

  const onShortcutKey = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") { setCapturing(false); return; }
    if (e.key === "Backspace" || e.key === "Delete") { setCapturing(false); void save({ codes: { shortcut: "" } }); return; }
    const accel = acceleratorFromEvent(e.nativeEvent);
    if (!accel) return;
    setCapturing(false);
    void save({ codes: { shortcut: accel } });
  };

  const st = autofillState(a);
  const usable = Boolean(a?.supported) && c.enabled;
  const ready = a?.state === "ready";
  return (
    <div className={styles.group} style={{ marginTop: 0 }}>
      <SectionLabel className={styles.groupLabel}>Autofill in any app</SectionLabel>
      <ToggleRow
        icon={<ScanText size={18} strokeWidth={1.5} />}
        title="Fill codes in any app"
        description="Offers a waiting code next to the code field in Safari, Chrome, Arc, Firefox and other apps. No browser extension needed."
        checked={c.autofill && usable}
        disabled={!usable}
        onChange={(v) => void save({ codes: { autofill: v } })}
      />
      <SettingsRow icon={<ShieldCheck size={18} strokeWidth={1.5} />} title="Accessibility permission" description={permissionDescription()}>
        <div className={styles.inline}>
          <span className={`${styles.mono} ${styles[st.tone]}`} role="status">{st.text}</span>
          {a?.supported && a.state === "needs_permission" ? <Button variant="primary" onClick={() => void enable()}>Enable</Button> : null}
        </div>
      </SettingsRow>
      <SettingsRow icon={<Keyboard size={18} strokeWidth={1.5} />} title="Fill shortcut" description="Types your newest code into the focused field, even when Flint didn't recognize it as a code field.">
        <div className={styles.inline}>
          {capturing ? (
            <Button variant="ghost" autoFocus aria-label="Shortcut" onKeyDown={onShortcutKey} onBlur={() => setCapturing(false)}>Press keys… (Esc cancels, Delete turns off)</Button>
          ) : (
            <Button variant="ghost" aria-label="Shortcut" onClick={() => setCapturing(true)} disabled={!usable || !c.autofill}>
              {c.shortcut ? formatAccelerator(c.shortcut) : "Off"}
            </Button>
          )}
          {c.shortcut && a?.supported && (a.state === "ready" || a.state === "needs_permission") && !a.shortcutActive ? <span className={styles.err}>Another app is using this shortcut.</span> : null}
        </div>
      </SettingsRow>
      <SettingsRow title="Try it" description="Opens a small window with a sample field and a made-up code, so you can see the suggestion.">
        <Button variant="ghost" onClick={() => void tryIt()} disabled={!ready}>Try it</Button>
      </SettingsRow>
      {msg ? <p role="status" className={msg.ok ? styles.muted : styles.err} style={{ paddingTop: 6 }}>{msg.text}</p> : null}
    </div>
  );
}

function permissionDescription(): string {
  return "While a code is waiting, Flint reads the focused field's label and the page address to recognize code fields and match the sender. It doesn't watch your typing or use the clipboard. In Chrome, Arc and other Chromium based apps it turns on accessibility support for that time.";
}
