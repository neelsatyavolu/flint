import { describe, expect, it } from "vitest";
import { PairingController, type PairingUiEvent } from "./controller";
import { memoryDevicesStore } from "./devices";
import { decodeOffer } from "./qr";
import { fakeSource, FakePhone } from "./testkit";

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function make(session: object = {}) {
  const events: PairingUiEvent[] = [];
  const devices = memoryDevicesStore();
  const controller = new PairingController({ source: fakeSource(), devices, send: (e) => events.push(e), session: { host: "127.0.0.1", addrs: ["127.0.0.1"], ...session } });
  return { controller, events, devices };
}

describe("PairingController", () => {
  it("sends a QR svg and never the raw session url", async () => {
    const { controller, events } = make();
    await controller.start();
    await settle();
    const listening = events.find((e) => e.type === "listening")!;
    expect(listening).toMatchObject({ type: "listening", addrs: ["127.0.0.1"] });
    expect((listening as { svg: string }).svg).toContain("<svg");
    expect(JSON.stringify(events)).not.toContain("flint://");
    controller.cancel();
  });

  it("ends the earlier session when a new one starts", async () => {
    const { controller, events } = make();
    await controller.start();
    await controller.start();
    await settle();
    expect(events.filter((e) => e.type === "closed")).toEqual([{ type: "closed", reason: "cancelled" }]);
    expect(events.filter((e) => e.type === "listening")).toHaveLength(2);
    controller.cancel();
  });

  it("reports a missing network as an error event", async () => {
    const { controller, events } = make({ addrs: [] });
    await controller.start();
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("private network") });
  });

  it("forgets a device", () => {
    const { controller, devices } = make();
    devices.add({ deviceName: "A", pairedAt: 1 });
    devices.add({ deviceName: "B", pairedAt: 2 });
    expect(controller.forget(2)).toEqual([{ deviceName: "A", pairedAt: 1 }]);
    expect(controller.listDevices()).toHaveLength(1);
  });
});

describe("PairingController with a phone", () => {
  it("shows the code formatted, sends the bundle on approve, and records the device", async () => {
    const events: PairingUiEvent[] = [];
    const devices = memoryDevicesStore();
    // Capture the url by running a session through the controller with a spying render: read it from the session events instead.
    const { PairingSession } = await import("./session");
    const urls: string[] = [];
    const original = PairingSession.prototype.start;
    PairingSession.prototype.start = async function (this: InstanceType<typeof PairingSession>) {
      const r = await original.call(this);
      urls.push(r.url);
      return r;
    };
    try {
      const controller = new PairingController({ source: fakeSource(), devices, send: (e) => events.push(e), session: { host: "127.0.0.1", addrs: ["127.0.0.1"] } });
      await controller.start();
      await settle();
      const phone = await FakePhone.join(urls[0]!);
      expect(decodeOffer(urls[0]!)).not.toBeNull();
      phone.sendHello("Neel's iPhone");
      await settle();
      const approval = events.find((e) => e.type === "approval") as Extract<PairingUiEvent, { type: "approval" }>;
      expect(approval.sas).toMatch(/^\d{3} \d{3}$/);
      expect(approval.sas.replace(" ", "")).toBe(phone.keys!.sas);
      controller.approve(false);
      await phone.frameCount(2);
      phone.sendAck();
      await settle();
      expect(events.at(-1)).toMatchObject({ type: "done", deviceName: "Neel's iPhone" });
      expect(devices.list()).toHaveLength(1);
    } finally {
      PairingSession.prototype.start = original;
    }
  });
});
