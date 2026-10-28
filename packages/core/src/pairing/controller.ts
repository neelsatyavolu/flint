// What the Mac app drives from Settings > Devices: at most one session at a time, UI-ready events, the devices list.
// The QR is rendered here (SVG) so the renderer never sees the session id or the raw URL.

import type { BundleSource } from "./bundle";
import type { PairedDevice, PairedDevicesStore } from "./devices";
import { formatSas } from "./crypto";
import { renderQrSvg } from "./qr";
import { PairingSession, type AckCounts, type CloseReason, type PairingEvent } from "./session";

export type PairingUiEvent =
  | { type: "listening"; svg: string; expiresAt: number; addrs: string[] }
  | { type: "approval"; deviceName: string; sas: string; passwordAccounts: number }
  | { type: "sending" }
  | { type: "done"; deviceName: string; counts: AckCounts }
  | { type: "closed"; reason: CloseReason; bundleSent: boolean }
  | { type: "error"; message: string };

export type PairingControllerDeps = {
  source: BundleSource;
  devices: PairedDevicesStore;
  send: (event: PairingUiEvent) => void;
  /** Test hooks. */
  session?: Partial<ConstructorParameters<typeof PairingSession>[0]>;
};

export class PairingController {
  private session: PairingSession | null = null;

  constructor(private readonly deps: PairingControllerDeps) {}

  /** Starts a fresh session, ending any earlier one. Resolves once the QR is on its way to the window. */
  async start(): Promise<void> {
    this.cancel();
    const session = new PairingSession({ source: this.deps.source, devices: this.deps.devices, onEvent: (e) => void this.forward(session, e), ...this.deps.session });
    this.session = session;
    try {
      await session.start();
    } catch (err) {
      this.session = null;
      this.deps.send({ type: "error", message: err instanceof Error ? err.message : "Couldn't start pairing." });
    }
  }

  approve(includePasswords: boolean): void {
    void this.session?.approve({ includePasswords });
  }

  cancel(): void {
    const s = this.session;
    this.session = null;
    if (s && s.state !== "closed") s.cancel();
  }

  listDevices(): PairedDevice[] { return this.deps.devices.list(); }

  forget(pairedAt: number): PairedDevice[] {
    this.deps.devices.remove(pairedAt);
    return this.deps.devices.list();
  }

  private async forward(from: PairingSession, e: PairingEvent): Promise<void> {
    if (from !== this.session && e.type !== "closed") return;
    switch (e.type) {
      case "listening": return this.deps.send({ type: "listening", svg: await renderQrSvg(e.url), expiresAt: e.expiresAt, addrs: e.addrs });
      case "approval": return this.deps.send({ type: "approval", deviceName: e.deviceName, sas: formatSas(e.sas), passwordAccounts: e.passwordAccounts });
      case "done": case "closed":
        if (from === this.session) this.session = null;
        return this.deps.send(e);
      default: return this.deps.send(e);
    }
  }
}
