import { useCallback, useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import type { PairedDevice } from "@flint/core/pairing/devices";
import { getHost } from "../../../lib/host";
import { formatFullDate } from "../../../lib/format";
import { Button, useToast } from "../../../ui";
import { SectionPage } from "../fields";
import { PairingDialog } from "./PairingDialog";
import styles from "../settings.module.css";

export function DevicesSection() {
  const pairing = getHost()?.pairing;
  const toast = useToast();
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    pairing?.devices().then(setDevices, () => setDevices([]));
  }, [pairing]);
  useEffect(refresh, [refresh]);

  const forget = async (d: PairedDevice) => {
    try {
      setDevices((await pairing?.forget(d.pairedAt)) ?? []);
    } catch {
      toast.show({ message: "Couldn't remove that device. Try again.", level: "error" });
    }
  };

  return (
    <SectionPage title="Devices" description="Set up Flint on your iPhone from this Mac. Everything goes over your local network, encrypted, and nothing is stored on a server.">
      {pairing ? (
        <>
          <div className={styles.row}>
            <Smartphone size={18} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />
            <div className={styles.rowGrow}>
              <div className={styles.rowTitle}>Set up iPhone</div>
              <div className={styles.rowSub}>Moves your accounts, signatures, templates, rules and blocked senders.</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>Show code</Button>
          </div>
          <PairingDialog open={open} onClose={() => setOpen(false)} onPaired={refresh} />
          <h3 className={`t-label ${styles.groupLabel}`} style={{ marginTop: "var(--s-6)" }}>Set up so far</h3>
          {devices.length === 0 ? (
            <p className={styles.empty}>No iPhones set up yet.</p>
          ) : (
            devices.map((d) => (
              <div key={d.pairedAt} className={styles.row}>
                <Smartphone size={16} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />
                <div className={styles.rowGrow}>
                  <div className={styles.rowTitle}>{d.deviceName}</div>
                  <div className={`${styles.rowSub} ${styles.mono}`}>Set up {formatFullDate(d.pairedAt)}</div>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Remove ${d.deviceName} from this list`} onClick={() => void forget(d)}>Remove</Button>
              </div>
            ))
          )}
          <p className={`${styles.muted} ${styles.padTop}`}>Flint keeps only the name and date. The iPhone keeps its own copy, and removing it here changes nothing on the phone.</p>
        </>
      ) : (
        <p className={styles.empty}>Setting up an iPhone works in the Flint app for Mac.</p>
      )}
    </SectionPage>
  );
}
