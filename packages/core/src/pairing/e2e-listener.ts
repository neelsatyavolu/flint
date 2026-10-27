// A real pairing listener on loopback for apps/ios/scripts/pairing-e2e.sh. The Swift tests connect to it.
//   node e2e-listener.mjs <happy|deny|expired>
// Prints one JSON object per event on stdout (no bundle content). Uses synthetic data only.

import { memoryDevicesStore } from "./devices";
import { PairingSession, type PairingEvent } from "./session";
import { fakeSource } from "./testkit";

const scenario = process.argv[2] ?? "happy";
const devices = memoryDevicesStore();
let session: PairingSession;

const print = (o: object): void => { process.stdout.write(JSON.stringify(o) + "\n"); };

function onEvent(e: PairingEvent): void {
  if (e.type === "listening") print({ type: "listening", url: e.url });
  else if (e.type === "approval") {
    print({ type: "approval", sas: e.sas, deviceName: e.deviceName });
    if (scenario === "happy") void session.approve({ includePasswords: true });
    if (scenario === "deny") session.cancel();
  } else if (e.type === "done") {
    print({ type: "done", counts: e.counts, devices: devices.list().length });
    setTimeout(() => process.exit(0), 200);
  } else if (e.type === "closed") {
    print({ type: "closed", reason: e.reason });
    setTimeout(() => process.exit(scenario === "happy" ? 1 : 0), 200);
  } else print({ type: e.type });
}

session = new PairingSession({ source: fakeSource(), devices, onEvent, host: "127.0.0.1", addrs: ["127.0.0.1"], ttlMs: scenario === "expired" ? 1500 : 120_000 });
session.start().catch((err: unknown) => { print({ type: "error", message: String(err) }); process.exit(2); });
setTimeout(() => process.exit(3), 90_000).unref();
