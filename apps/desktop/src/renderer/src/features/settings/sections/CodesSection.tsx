import { useState } from "react";
import { BellRing, Clipboard, KeyRound } from "lucide-react";
import type { BrowserHelperBrowser, BrowserHelperStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { getHost } from "../../../lib/host";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, SectionLabel, SettingsRow } from "../../../ui";
import { CopyButton } from "../CopyButton";
import { AutofillBlock } from "./AutofillBlock";
import { SectionPage, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

/** One line per browser: what Flint did there. Exported for tests. */
export function browserState(b: BrowserHelperBrowser): { text: string; tone: "ok" | "muted" | "err" } {
  if (b.foreign) return { text: "Another app's helper is there. Flint leaves it alone.", tone: "err" };
  if (b.installed) return { text: "Helper installed", tone: "ok" };
  if (!b.detected) return { text: "Not on this Mac", tone: "muted" };
  return { text: "Helper not installed", tone: "muted" };
}

export function CodesSection() {
  const { settings: s, save } = useSettingsStore();
  const status = useFlintQuery((api) => api.browserHelperStatus(), [], { mail: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const c = s.codes;
  const h = status.data;

  const change = async (action: "install" | "remove") => {
    setBusy(true);
    setMsg(null);
    try {
      const next = action === "install" ? await flint.installBrowserHelper() : await flint.removeBrowserHelper();
      if (action === "remove") setMsg({ ok: true, text: "Removed the browser helper." });
      else {
        const count = next.browsers.filter((b) => b.installed).length;
        setMsg(count > 0
          ? { ok: true, text: `Installed for ${count} ${count === 1 ? "browser" : "browsers"}. Now add the extension below.` }
          : { ok: false, text: "No supported browser was found on this Mac." });
      }
      status.refetch();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, action === "install" ? "Couldn't install the browser helper." : "Couldn't remove the browser helper.") });
    } finally {
      setBusy(false);
    }
  };

  const anyInstalled = Boolean(h?.browsers.some((b) => b.installed));
  return (
    <SectionPage title="Verification codes" description="When a sign-in code arrives by email, Flint can show it, copy it, and offer it in the code field of the page you are signing in to.">
      <AutofillBlock />

      <ToggleRow icon={<KeyRound size={18} strokeWidth={1.5} />} title="Detect codes" description="Looks for one-time codes in new mail. Codes stay in memory for 10 minutes and are never saved." checked={c.enabled} onChange={(v) => void save({ codes: { enabled: v } })} />
      <ToggleRow icon={<BellRing size={18} strokeWidth={1.5} />} title="Notify" description="Show a notification with a Copy code button. It follows your notification preview setting." checked={c.notify} disabled={!c.enabled} onChange={(v) => void save({ codes: { notify: v } })} />
      <ToggleRow icon={<Clipboard size={18} strokeWidth={1.5} />} title="Copy automatically" description="Put each new code on the clipboard. Flint clears it after 90 seconds if it still holds that code." checked={c.autoCopy} disabled={!c.enabled} onChange={(v) => void save({ codes: { autoCopy: v } })} />

      <details className={styles.group}>
        <summary className={styles.disclosure}>Advanced: browser extension (optional)</summary>
        <p className={styles.muted} style={{ paddingTop: 6 }}>Autofill in any app already covers browsers. The extension is only for browsers where you prefer it, and needs a one-time setup per browser.</p>
      <div className={styles.group}>
        <SectionLabel className={styles.groupLabel}>Browser extension</SectionLabel>
        <SettingsRow
          title="Fill codes in your browser"
          description={helperDescription(h)}
        >
          <div className={styles.inline}>
            {anyInstalled ? <Button variant="ghost" onClick={() => void change("remove")} disabled={busy}>Remove helper</Button> : null}
            <Button variant={anyInstalled ? "ghost" : "primary"} onClick={() => void change("install")} disabled={busy || !h || !h.cliAvailable || !c.enabled}>
              {anyInstalled ? "Reinstall helper" : "Install helper"}
            </Button>
          </div>
        </SettingsRow>
        {msg ? <p role="status" className={msg.ok ? styles.ok : styles.err} style={{ paddingTop: 6 }}>{msg.text}</p> : null}
        {h ? (
          <div className={styles.stack} aria-label="Browsers">
            {h.browsers.map((b) => {
              const st = browserState(b);
              return (
                <div key={b.id} className={styles.row}>
                  <div className={styles.rowGrow}>
                    <div className={styles.fieldLabel}>{b.name}</div>
                  </div>
                  <span className={`${styles.mono} ${styles[st.tone]}`}>{st.text}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {h ? <ExtensionSteps status={h} /> : null}
      </details>
    </SectionPage>
  );
}

function helperDescription(h: BrowserHelperStatus | undefined): string {
  if (!h) return "Checking…";
  if (!h.cliAvailable) return "This build of Flint can't install the browser helper.";
  return "The helper lets the extension ask Flint for your newest code. It talks only to Flint on this Mac, never to the network.";
}

function ExtensionSteps({ status }: { status: BrowserHelperStatus }) {
  const [error, setError] = useState("");
  const reveal = async (family: "chromium" | "firefox") => {
    setError("");
    try {
      const host = getHost();
      if (!host?.revealExtension) throw new Error("Open the folder from the Flint app.");
      await host.revealExtension(family);
    } catch (err) {
      setError(errorText(err, "Couldn't open the folder."));
    }
  };
  if (!status.extensionDir) {
    return <p className={styles.muted} style={{ paddingTop: 12 }}>This build of Flint doesn't include the browser extension.</p>;
  }
  return (
    <div className={styles.group}>
      <SectionLabel className={styles.groupLabel}>Add the extension</SectionLabel>
      <p className={styles.muted}>Do this once per browser. A store listing will replace these steps later.</p>
      <div className={styles.stack} style={{ paddingTop: 8 }}>
        <div>
          <div className={styles.fieldLabel}>Chrome, Arc, Brave, Edge, Vivaldi, Dia</div>
          <ol className={styles.muted} style={{ margin: "4px 0 8px", paddingLeft: 20, listStyle: "decimal" }}>
            <li>Open <span className={styles.mono}>chrome://extensions</span> (or the same page in your browser).</li>
            <li>Turn on Developer mode.</li>
            <li>Choose Load unpacked, then pick the Flint folder.</li>
          </ol>
          <FolderLine path={`${status.extensionDir}/chromium`} onShow={() => void reveal("chromium")} />
        </div>
        <div>
          <div className={styles.fieldLabel}>Firefox</div>
          <ol className={styles.muted} style={{ margin: "4px 0 8px", paddingLeft: 20, listStyle: "decimal" }}>
            <li>Open <span className={styles.mono}>about:debugging</span> and choose This Firefox.</li>
            <li>Choose Load Temporary Add-on, then pick manifest.json in the Flint folder.</li>
            <li>Firefox forgets temporary add-ons when it quits, so repeat this after a restart.</li>
          </ol>
          <FolderLine path={`${status.extensionDir}/firefox`} onShow={() => void reveal("firefox")} />
        </div>
      </div>
      {error ? <p role="status" className={styles.err} style={{ paddingTop: 6 }}>{error}</p> : null}
    </div>
  );
}

function FolderLine({ path, onShow }: { path: string; onShow: () => void }) {
  return (
    <div className={styles.inline}>
      <span className={`${styles.mono} ${styles.rowSub}`} style={{ userSelect: "text", overflowWrap: "anywhere" }}>{path}</span>
      <CopyButton text={path} />
      <Button variant="ghost" size="sm" onClick={onShow}>Show in Finder</Button>
    </div>
  );
}
