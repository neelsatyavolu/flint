import { useState } from "react";
import { Eye, EyeOff, Link2, BellRing } from "lucide-react";
import { flint } from "../../../lib/api";
import { Button, SectionLabel, SettingsRow } from "../../../ui";
import { DebouncedText, SectionPage, ToggleRow } from "../fields";
import { checkEndpoint } from "../receiptEndpoint";
import { useSettingsStore } from "../settingsStore";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export function ReceiptsSection() {
  const { settings: s, save } = useSettingsStore();
  const r = s.receipts;
  const check = checkEndpoint(r.endpoint);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const commit = (raw: string) => {
    const c = checkEndpoint(raw);
    if (!c.ok) {
      setDraftError(c.message);
      return;
    }
    setDraftError(null);
    setStatus({ kind: "idle" });
    void save({ receipts: { endpoint: c.value } });
  };

  const test = async () => {
    if (!check.ok || check.value === "") {
      setStatus({ kind: "error", text: check.ok ? "Add an endpoint first." : check.message });
      return;
    }
    setStatus({ kind: "checking" });
    try {
      await flint.refreshReceipts();
      setStatus({ kind: "ok", text: "Flint reached the receipts service." });
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err, "Flint couldn't reach the receipts service.") });
    }
  };

  return (
    <SectionPage title="Read Receipts" description="Know when a message you sent was opened, without false opens.">
      <ToggleRow icon={<Eye size={18} strokeWidth={1.5} />} title="Enable read receipts" checked={r.enabled} onChange={(v) => void save({ receipts: { enabled: v } })} />
      <ToggleRow icon={<EyeOff size={18} strokeWidth={1.5} />} title="Track new mail by default" description="You can turn it off for a single message in the composer." checked={r.defaultOn} disabled={!r.enabled} onChange={(v) => void save({ receipts: { defaultOn: v } })} />
      <ToggleRow icon={<BellRing size={18} strokeWidth={1.5} />} title="Notify when opened" checked={r.notifyOnOpen} disabled={!r.enabled} onChange={(v) => void save({ receipts: { notifyOnOpen: v } })} />
      <SettingsRow icon={<Link2 size={18} strokeWidth={1.5} />} title="Receipts service" description="The address of the service that serves the pixel. Anyone can run their own for free.">
        <div className={styles.inline}>
          <DebouncedText label="Receipts service address" className={styles.wide} value={r.endpoint} placeholder="https://receipts.example.com" invalid={draftError !== null} onCommit={commit} />
          <Button variant="ghost" onClick={() => void test()} disabled={status.kind === "checking"}>Test</Button>
        </div>
      </SettingsRow>
      <div aria-live="polite" style={{ minHeight: 22, paddingTop: 6 }}>
        {draftError ? <span className={styles.err}>{draftError}</span> : null}
        {!draftError && status.kind === "ok" ? <span className={styles.ok}>{status.text}</span> : null}
        {!draftError && status.kind === "error" ? <span className={styles.err}>{status.text}</span> : null}
        {!draftError && status.kind === "checking" ? <span className={styles.muted}>Checking…</span> : null}
      </div>

      <div className={styles.group}>
        <SectionLabel className={styles.groupLabel}>How it works</SectionLabel>
        <div className={styles.prose}>
          <p>Flint adds one tiny private image to the copy of the message each recipient receives. Every recipient gets their own address for it, so an open is tied to one person and never to the whole group.</p>
          <p>When the image loads, the receipts service records the hit and classifies it. Only hits that look like a person opening the mail count as opened. Security scanners, link previews and bots are filtered out. A reply counts as read.</p>
          <h3>What can't be known</h3>
          <p>Apple Mail Privacy Protection loads images for every message whether or not anyone looks at it. For those recipients Flint shows that opens can't be confirmed instead of guessing. Gmail also caches images, so the count of opens can be lower than the real number. Some people block images and will never register.</p>
          <h3>Your own opens</h3>
          <p>Your own opens never count. The copy in your Sent folder has no image, and Flint recognizes your own network and devices.</p>
          <h3>What is stored</h3>
          <p>The service stores no IP addresses. It keeps a one-way fingerprint that can be compared but not reversed, plus the mail app and rough location needed to tell opens from scanners. Events are deleted after 180 days.</p>
        </div>
      </div>
    </SectionPage>
  );
}
