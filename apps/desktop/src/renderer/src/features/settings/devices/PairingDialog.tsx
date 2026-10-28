import { useEffect, useReducer, useState } from "react";
import { Check } from "lucide-react";
import { Button, Checkbox, Dialog } from "../../../ui";
import { getHost } from "../../../lib/host";
import { countdown, countsSentence, nextView, START, type PairingView } from "./pairingState";
import styles from "./devices.module.css";

/** Shows the QR, the six-digit code and the approval step for one pairing session. Closing it cancels the session. */
export function PairingDialog({ open, onClose, onPaired }: { open: boolean; onClose: () => void; onPaired: () => void }) {
  const pairing = getHost()?.pairing;
  const [view, dispatch] = useReducer(nextViewReducer, START);
  const [include, setInclude] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open || !pairing) return;
    dispatch({ reset: true });
    setInclude(true);
    const off = pairing.onEvent((event) => {
      dispatch({ event });
      if (event.type === "done") onPaired();
    });
    void pairing.start();
    return () => {
      off();
      void pairing.cancel();
    };
  }, [open, pairing, onPaired]);

  useEffect(() => {
    if (view.step !== "listening") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view.step]);

  const restart = () => { dispatch({ reset: true }); void pairing?.start(); };
  const cancel = () => { void pairing?.cancel(); onClose(); };

  return (
    <Dialog open={open} onClose={cancel} title="Set up iPhone" width={420}>
      <div className={styles.dialog} data-step={view.step}>
        <Body view={view} now={now} include={include} setInclude={setInclude}
          approve={() => void pairing?.approve(include)} cancel={cancel} restart={restart} close={onClose} />
      </div>
    </Dialog>
  );
}

type Action = { reset: true } | { event: Parameters<typeof nextView>[1] };
const nextViewReducer = (view: PairingView, a: Action): PairingView => ("reset" in a ? START : nextView(view, a.event));

type BodyProps = { view: PairingView; now: number; include: boolean; setInclude: (v: boolean) => void; approve: () => void; cancel: () => void; restart: () => void; close: () => void };

function Body({ view, now, include, setInclude, approve, cancel, restart, close }: BodyProps) {
  switch (view.step) {
    case "starting":
      return <p className={styles.muted}>Starting…</p>;
    case "listening":
      return (
        <>
          <img className={styles.qr} alt="Pairing code for your iPhone" src={`data:image/svg+xml;utf8,${encodeURIComponent(view.svg)}`} />
          <p>On your iPhone, open Flint, choose Set up from your Mac, and scan this code. Both devices need to be on the same Wi-Fi.</p>
          <p className={`${styles.muted} ${styles.mono}`}>Expires in {countdown(view.expiresAt, now)} · {view.addrs.join(", ")}</p>
          <div className={styles.actions}><Button variant="ghost" onClick={cancel}>Cancel</Button></div>
        </>
      );
    case "approval":
      return (
        <>
          <h3 className="t-title">Pair with {view.deviceName}?</h3>
          <p className={styles.code} aria-label={`Code ${view.sas}`}>{view.sas}</p>
          <p>Every iPhone sends the same name, so only the code tells them apart. Check that your iPhone shows the same code. If it doesn't, cancel.</p>
          {view.passwordAccounts > 0 ? (
            <Checkbox checked={include} onChange={setInclude}
              label={`Include passwords for ${view.passwordAccounts} ${view.passwordAccounts === 1 ? "account" : "accounts"}`} />
          ) : null}
          <p className={styles.muted}>Google accounts are never sent. You sign in to them on the iPhone.</p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
            <Button variant="primary" onClick={approve}>Approve</Button>
          </div>
        </>
      );
    case "sending":
      return <p>Sending to your iPhone. Keep both devices open.</p>;
    case "done":
      return (
        <>
          <p className={styles.doneLine}><Check size={16} strokeWidth={1.5} aria-hidden /> Set up {view.deviceName}</p>
          <p>{countsSentence(view.counts)}</p>
          <div className={styles.actions}><Button variant="primary" onClick={close}>Done</Button></div>
        </>
      );
    case "ended":
      return (
        <>
          <p role="status">{view.message}</p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={close}>Close</Button>
            {view.retry ? <Button variant="primary" onClick={restart}>Show new code</Button> : null}
          </div>
        </>
      );
  }
}
