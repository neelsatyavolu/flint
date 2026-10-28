import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../preload/channels";
import { registerPairingIpc } from "./pairing-ipc";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memorySecrets } from "@flint/core/platform";

function setup(trusted = true, service: unknown = {}) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const dataDir = mkdtempSync(join(tmpdir(), "flint-pairing-ipc-"));
  const registered = registerPairingIpc({
    ipc: { handle: (c, f) => void handlers.set(c, f) }, trusted: () => trusted, getService: () => service as never,
    secrets: memorySecrets(), dataDir, send: vi.fn(),
  });
  return { call: (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a), registered, dataDir };
}

describe("registerPairingIpc", () => {
  it("registers every channel and refuses untrusted senders", () => {
    const { call, dataDir } = setup(false);
    try {
      for (const c of [CHANNELS.pairingStart, CHANNELS.pairingApprove, CHANNELS.pairingCancel, CHANNELS.pairingDevices, CHANNELS.pairingForget]) {
        expect(() => call(c)).toThrow("Not allowed");
      }
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("refuses while the service is still starting", () => {
    const { call, dataDir } = setup(true, null);
    try { expect(() => call(CHANNELS.pairingDevices)).toThrow(/still starting/); } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("lists and forgets devices from a file in the data folder, and validates the id", () => {
    const { call, dataDir } = setup();
    try {
      expect(call(CHANNELS.pairingDevices)).toEqual([]);
      expect(() => call(CHANNELS.pairingForget, "x")).toThrow("Invalid device");
      expect(call(CHANNELS.pairingForget, 5)).toEqual([]);
      expect(call(CHANNELS.pairingCancel)).toBeUndefined();
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });
});
