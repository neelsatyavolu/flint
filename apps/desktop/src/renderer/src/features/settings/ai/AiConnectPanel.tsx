import { useState } from "react";
import { openExternal } from "../../../lib/host";
import { Button, TextArea } from "../../../ui";
import styles from "../settings.module.css";
import { PROVIDER_LABEL } from "./connectMachine";
import type { AiConnect } from "./useAiConnect";

/** Everything between "not connected" and "connected": buttons, waiting, paste, errors. */
export function AiConnectPanel({ connect }: { connect: AiConnect }) {
  const { state } = connect;
  const [pasted, setPasted] = useState("");

  if (state.kind === "idle") {
    return (
      <div className={styles.inline} style={{ paddingTop: "var(--s-3)" }}>
        <Button variant="primary" onClick={() => void connect.start("codex")}>Connect ChatGPT</Button>
        <Button variant="ghost" onClick={() => void connect.start("grok")}>Connect Grok</Button>
      </div>
    );
  }

  if (state.kind === "starting") return <p className={styles.muted} role="status" style={{ paddingTop: "var(--s-3)" }}>Opening your browser…</p>;

  if (state.kind === "waiting") {
    return (
      <div className={styles.stack} style={{ paddingTop: "var(--s-3)" }} role="status">
        <div className={styles.connecting}>
          <span className={styles.pulse} aria-hidden />
          <span>Waiting for sign-in…</span>
        </div>
        <p className={styles.muted}>Finish signing in to {PROVIDER_LABEL[state.provider]} in your browser. Flint checks every 2 seconds.</p>
        <div className={styles.inline}>
          <Button variant="ghost" size="sm" onClick={() => openExternal(state.url)}>Open the page again</Button>
          <Button variant="ghost" size="sm" onClick={connect.switchToPaste}>Paste the link instead</Button>
          <Button variant="ghost" size="sm" onClick={connect.cancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (state.kind === "paste") {
    const grok = state.provider === "grok" && !state.fallback;
    return (
      <div className={styles.stack} style={{ paddingTop: "var(--s-3)" }}>
        <p className={styles.muted}>
          {grok
            ? "Sign in to Grok in your browser, then copy the code it shows and paste it here."
            : "After you sign in, your browser lands on a page that may fail to load. Copy its full address and paste it here."}
        </p>
        <TextArea
          aria-label={grok ? "Code from Grok" : "Callback link"}
          rows={3}
          value={pasted}
          invalid={state.error !== null}
          placeholder={grok ? "Paste the code" : "http://localhost:1455/auth/callback?code=…"}
          onChange={(e) => setPasted(e.target.value)}
        />
        {state.error ? <p className={styles.err} role="alert">{state.error}</p> : null}
        <div className={styles.inline}>
          <Button variant="primary" disabled={state.busy || pasted.trim() === ""} onClick={() => void connect.submit(pasted)}>
            {state.busy ? "Connecting…" : "Connect"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openExternal(state.url)}>Open the page again</Button>
          <Button variant="ghost" size="sm" onClick={() => { setPasted(""); connect.cancel(); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack} style={{ paddingTop: "var(--s-3)" }}>
      <p className={styles.err} role="alert">{state.message}</p>
      <div className={styles.inline}>
        <Button variant="primary" onClick={() => void connect.start(state.provider)}>Try again</Button>
        <Button variant="ghost" onClick={connect.cancel}>Cancel</Button>
      </div>
    </div>
  );
}
