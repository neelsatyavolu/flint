import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plug } from "lucide-react";
import type { ConnectorConnection, ConnectorField, ConnectorPreview, RuleCondition } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { formatFullDate } from "../../../lib/format";
import { Button, Input, Sheet, Skeleton } from "../../../ui";
import { SectionPage } from "../fields";
import { errorText } from "../useAccounts";
import { PorchlightBlock } from "./PorchlightBlock";
import styles from "../settings.module.css";

const FIELD_LABELS: Record<ConnectorField, string> = {
  messageId: "Message ID", from: "Sender", to: "Recipients", subject: "Subject", date: "Date", text: "Plain-text body", html: "HTML body",
};
const RULE_FIELDS: Record<RuleCondition["field"], string> = {
  from: "Sender", to: "Recipient", cc: "Cc recipient", any_recipient: "Any recipient", subject: "Subject", body: "Message body", list_id: "Mailing list ID", has_attachment: "Has an attachment",
};
const RULE_OPS: Record<RuleCondition["op"], string> = { contains: "contains", equals: "is", ends_with: "ends with", matches: "matches the pattern", is_true: "is true" };
const STATUS = { active: "Connected", needs_approval: "Needs approval · deliveries paused", stopped: "Stopped · reconnect to resume" };

export function ConnectedAppsSection() {
  const [connections, setConnections] = useState<ConnectorConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ connection?: ConnectorConnection } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setConnections(await flint.listConnectors()); }
    catch (err) { setError(errorText(err, "Couldn't load connected apps. Try again.")); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const remove = async (connection: ConnectorConnection) => {
    setBusy(connection.id);
    setError(null);
    try { await flint.removeConnector(connection.id); await refresh(); }
    catch (err) { setError(errorText(err, "Couldn't remove the connection. Try again.")); }
    finally { setBusy(null); }
  };

  return (
    <SectionPage title="Connected apps" description="Send matching mail to apps you choose. Review what each app receives before connecting.">
      <div className={styles.listActions}><Button variant="ghost" size="sm" onClick={() => setFlow({})}>Add app</Button></div>
      {error ? <p role="alert" className={styles.err}>{error}</p> : null}
      {connections === null ? <Skeleton height={80} /> : connections.length === 0 ? <p className={styles.empty}>No apps connected yet.</p> : connections.map((connection) => (
        <div key={connection.id} className={styles.row}>
          <Plug size={18} strokeWidth={1.5} color="var(--fg-2)" aria-hidden />
          <div className={styles.rowGrow}>
            <div className={styles.rowTitle}>{connection.manifest.name}</div>
            <div className={`${styles.rowSub} ${styles.mono}`}>{new URL(connection.manifestUrl).host}</div>
            <p className={connection.status === "active" ? styles.muted : styles.warn}>{STATUS[connection.status]}</p>
            <p className={`t-data ${styles.muted}`}>{connection.deliveredCount} delivered · {connection.lastDelivery ? `Last delivery ${formatFullDate(connection.lastDelivery)}` : "No deliveries yet"}</p>
          </div>
          <div className={styles.inline}>
            {connection.status === "needs_approval" ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setFlow({ connection })}>Re-approve</Button> : null}
            <Button variant="ghost" size="sm" disabled={busy !== null} aria-label={`Remove ${connection.manifest.name}`} onClick={() => void remove(connection)}>{busy === connection.id ? "Removing…" : "Remove"}</Button>
          </div>
        </div>
      ))}
      <PorchlightBlock />
      {flow ? <ConnectorSheet connection={flow.connection} onClose={() => setFlow(null)} onDone={() => { setFlow(null); void refresh(); }} /> : null}
    </SectionPage>
  );
}

function ConnectorSheet({ connection, onClose, onDone }: { connection?: ConnectorConnection; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ConnectorPreview | null>(null);
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (err) { setError(errorText(err, "Couldn't connect the app. Try again.")); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (connection) void run(async () => { setPreview(await flint.previewConnectorApproval(connection.id)); });
  }, [connection]);

  const close = () => { if (!busy) onClose(); };
  const finish = () => void run(async () => {
    if (!preview) return;
    if (connection) await flint.approveConnector(connection.id, preview.token);
    else await flint.pairConnector(preview.token, code.trim());
    onDone();
  });

  return (
    <Sheet open onClose={close} title={connection ? "Review app permissions" : "Connect an app"} width={520}>
      <div className={styles.stack} aria-busy={busy}>
        {!preview ? connection ? <p role="status" className={styles.muted}>{busy ? "Checking updated permissions…" : "Updated permissions could not be loaded."}</p> : (
          <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); void run(async () => { setPreview(await flint.previewConnector(url.trim())); }); }}>
            <label className={styles.field}><span className={styles.fieldLabel}>App URL</span><Input autoFocus type="url" required placeholder="https://app.example" value={url} disabled={busy} spellCheck={false} onChange={(event) => setUrl(event.target.value)} /></label>
            <p className={styles.muted}>Paste the app’s website or connector manifest URL.</p>
            <div className={styles.listActions}><Button variant="accent" type="submit" disabled={busy || !url.trim()}>{busy ? "Checking mail…" : "Review permissions"}</Button></div>
          </form>
        ) : (
          <>
            <div><h3 className="t-title">{preview.manifest.name}</h3><p className={styles.mono}>{new URL(preview.manifestUrl).host}</p><p className={`${styles.muted} ${styles.padTop}`}>{preview.manifest.description}</p></div>
            <div className={`${styles.stack} ${styles.hair}`} style={{ paddingBottom: "var(--s-4)" }}>
              <div><h4 className={`t-label ${styles.groupLabel}`}>Information sent</h4><p>{preview.manifest.fields.map((field) => FIELD_LABELS[field]).join(", ")}</p></div>
              <div><h4 className={`t-label ${styles.groupLabel}`}>Send mail matching any of these rules</h4><ul className={styles.stack} style={{ paddingLeft: "var(--s-4)", listStyle: "disc" }}>
                {preview.manifest.match.any.map((condition, index) => <li key={index}>{condition.field === "has_attachment" ? "Has an attachment" : `${RULE_FIELDS[condition.field]} ${RULE_OPS[condition.op]} “${condition.value}”`}</li>)}
                {preview.manifest.match.schemaTypes.map((type) => <li key={type}>Contains structured email data of type {type}</li>)}
              </ul></div>
            </div>
            <div><p>{preview.count} messages from the last {preview.manifest.historyDays} days would be sent.</p>{preview.subjects.length > 0 ? <ul className={`${styles.stack} ${styles.muted} ${styles.padTop}`} style={{ paddingLeft: "var(--s-4)", listStyle: "disc" }}>{preview.subjects.slice(0, 5).map((subject, index) => <li key={index}>{subject || "(No subject)"}</li>)}</ul> : null}</div>
            <p className={styles.muted}>Matching new mail will also be sent. Spam, trash, sent mail and drafts are excluded. Remove this connection at any time to stop sharing.</p>
            {connection ? <div className={styles.listActions}><Button variant="accent" disabled={busy} onClick={finish}>{busy ? "Approving…" : "Approve and resume"}</Button></div> : !opened ? (
              <div className={styles.listActions}><Button variant="accent" disabled={busy} icon={<ExternalLink size={16} strokeWidth={1.5} />} onClick={() => void run(async () => { await flint.openConnectorPairPage(preview.token); setOpened(true); })}>Open {preview.manifest.name} to get a code</Button></div>
            ) : (
              <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); finish(); }}>
                <label className={styles.field}><span className={styles.fieldLabel}>8-character code</span><Input autoFocus className={styles.mono} value={code} maxLength={12} minLength={8} required disabled={busy} autoComplete="one-time-code" spellCheck={false} onChange={(event) => setCode(event.target.value)} /></label>
                <p className={styles.muted}>Enter the code shown in the app. Codes expire after 10 minutes.</p>
                <div className={styles.listActions}><Button variant="ghost" disabled={busy} onClick={() => void run(() => flint.openConnectorPairPage(preview.token))}>Open app again</Button><Button variant="accent" type="submit" disabled={busy || code.replace(/[^a-z0-9]/gi, "").length !== 8}>{busy ? "Connecting…" : "Connect"}</Button></div>
              </form>
            )}
          </>
        )}
        {error ? <p role="alert" className={styles.err}>{error}</p> : null}
      </div>
    </Sheet>
  );
}
