import { afterEach, describe, expect, it } from "vitest";
import { parseBundle } from "./bundle";
import { Direction, generateKeypair, seal } from "./crypto";
import { memoryDevicesStore } from "./devices";
import { encodeFrame, FrameType } from "./frames";
import { PairingSession, type PairingEvent } from "./session";
import { fakeSource, FakePhone } from "./testkit";

const sessions: PairingSession[] = [];
function setup(over: Partial<ConstructorParameters<typeof PairingSession>[0]> = {}) {
  const events: PairingEvent[] = [];
  const devices = memoryDevicesStore();
  const session = new PairingSession({ source: fakeSource(), devices, onEvent: (e) => events.push(e), host: "127.0.0.1", addrs: ["127.0.0.1"], now: () => 1000, ...over });
  sessions.push(session);
  return { session, events, devices };
}
const settle = () => new Promise((r) => setTimeout(r, 60));
const last = <T extends PairingEvent["type"]>(events: PairingEvent[], type: T) => events.filter((e) => e.type === type).at(-1) as Extract<PairingEvent, { type: T }> | undefined;
const closedReason = (events: PairingEvent[]) => last(events, "closed")?.reason;

afterEach(() => { sessions.splice(0).forEach((s) => s.cancel()); });

describe("PairingSession", () => {
  it("pairs end to end and records only name and date", async () => {
    const { session, events, devices } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello("Neel's iPhone");
    await settle();
    const approval = last(events, "approval")!;
    expect(approval).toMatchObject({ deviceName: "Neel's iPhone", passwordAccounts: 1 });
    expect(approval.sas).toBe(phone.keys!.sas);
    await session.approve({ includePasswords: true });
    expect(await phone.frameCount(2)).toBeGreaterThanOrEqual(2);
    const bundle = parseBundle(phone.receiveBundle());
    expect(bundle.accounts.map((a) => a.email)).toEqual(["neel@example.com", "neel@gmail.com"]);
    expect(bundle.accounts[0]!.password).toBe("app-password-1");
    phone.sendAck();
    await settle();
    expect(last(events, "done")).toMatchObject({ deviceName: "Neel's iPhone", counts: { accounts: 2 } });
    expect(devices.list()).toEqual([{ deviceName: "Neel's iPhone", pairedAt: 1000 }]);
    expect(await phone.untilClosed()).toBe(true);
    expect(session.state).toBe("closed");
  });

  it("leaves passwords out unless asked and never sends Google tokens", async () => {
    const { session } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    await session.approve({ includePasswords: false });
    await phone.frameCount(2);
    const raw = phone.receiveBundle().toString("utf8");
    expect(raw).not.toContain("app-password-1");
    expect(raw).not.toContain("ya29");
    expect(raw).not.toContain("secret-secret");
    expect(raw).not.toContain("accessToken");
    expect(raw).not.toContain("refreshToken");
  });

  it("sends nothing when the user cancels at the code", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    session.cancel();
    expect(await phone.untilClosed()).toBe(true);
    expect(phone.frames).toHaveLength(0);
    expect(closedReason(events)).toBe("denied");
  });

  it("shows a different code to a phone that holds the wrong key", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    const impostor = generateKeypair();
    const { deriveSession, sharedSecret } = await import("./crypto");
    const wrong = deriveSession(sharedSecret(impostor.privateKey, phone.offer.pk), phone.offer.sid, phone.offer.pk, impostor.publicKey);
    expect(wrong.sas).not.toBe(last(events, "approval")!.sas);
  });

  it("expires", async () => {
    const { session, events } = setup({ ttlMs: 80 });
    const { url } = await session.start();
    await new Promise((r) => setTimeout(r, 160));
    expect(closedReason(events)).toBe("expired");
    await expect(FakePhone.join(url)).rejects.toBeDefined();
  });

  it("expires while waiting at the approval dialog", async () => {
    const { session, events } = setup({ ttlMs: 150 });
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await new Promise((r) => setTimeout(r, 300));
    expect(closedReason(events)).toBe("expired");
    expect(await phone.untilClosed()).toBe(true);
  });

  it("closes a second connection and keeps the first", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const first = await FakePhone.join(url);
    first.sendHello();
    await settle();
    const second = await FakePhone.join(url);
    second.sendHello();
    expect(await second.untilClosed()).toBe(true);
    expect(last(events, "approval")).toBeDefined();
    expect(session.state).toBe("approval");
  });

  it("closes after three failed attempts", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    for (let i = 0; i < 3; i++) {
      const phone = await FakePhone.join(url).catch(() => null);
      if (!phone) break;
      phone.socket.write(encodeFrame(FrameType.hello, phone.helloBody("x", Buffer.alloc(16, 9))));
      await phone.untilClosed();
    }
    await settle();
    expect(closedReason(events)).toBe("too_many_attempts");
    await expect(FakePhone.join(url)).rejects.toBeDefined();
  });

  it("counts an oversize frame as a failed attempt", async () => {
    const { session, events } = setup({ maxStrikes: 1 });
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.socket.write(Buffer.from([0, 1, 0, 1, 1]));
    expect(await phone.untilClosed()).toBe(true);
    await settle();
    expect(closedReason(events)).toBe("too_many_attempts");
  });

  it("counts a silent connection as a failed attempt", async () => {
    const { session, events } = setup({ maxStrikes: 1, helloTimeoutMs: 60 });
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    expect(await phone.untilClosed()).toBe(true);
    expect(closedReason(events)).toBe("too_many_attempts");
  });

  it("keeps listening after one bad hello and then pairs", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const bad = await FakePhone.join(url);
    bad.socket.write(encodeFrame(FrameType.hello, Buffer.from("not json")));
    await bad.untilClosed();
    const good = await FakePhone.join(url);
    good.sendHello();
    await settle();
    expect(last(events, "approval")).toBeDefined();
  });

  it("rejects a weak public key", async () => {
    const { session, events } = setup({ maxStrikes: 1 });
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    const zero = Buffer.alloc(32);
    const body = Buffer.from(JSON.stringify({ v: 1, sid: phone.offer.sid.toString("base64url"), pk: zero.toString("base64url"), name: "x" }));
    phone.socket.write(encodeFrame(FrameType.hello, body));
    await phone.untilClosed();
    await settle();
    expect(closedReason(events)).toBe("too_many_attempts");
  });

  it("fails closed on a tampered ack and records no device", async () => {
    const { session, events, devices } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    await session.approve({ includePasswords: false });
    await phone.frameCount(2);
    const sealed = seal(phone.keys!.phoneToMac, phone.offer.sid, Direction.phoneToMac, FrameType.ack, 0n, Buffer.from('{"accounts":1,"signatures":0,"templates":0,"rules":0,"blockedSenders":0}'));
    sealed[2] = sealed[2]! ^ 1;
    phone.socket.write(encodeFrame(FrameType.ack, sealed));
    expect(await phone.untilClosed()).toBe(true);
    expect(closedReason(events)).toBe("failed");
    expect(devices.list()).toEqual([]);
  });

  it("rejects an ack with a replayed counter", async () => {
    const { session, events, devices } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    await session.approve({ includePasswords: false });
    await phone.frameCount(2);
    phone.sendAck(5n);
    await phone.untilClosed();
    expect(closedReason(events)).toBe("failed");
    expect(devices.list()).toEqual([]);
  });

  it("rejects frames from the phone before approval", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    phone.sendAck();
    await phone.untilClosed();
    expect(closedReason(events)).toBe("failed");
    expect(phone.frames).toHaveLength(0);
  });

  it("reports a lost connection after the code was shown", async () => {
    const { session, events } = setup();
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    phone.socket.destroy();
    await settle();
    expect(closedReason(events)).toBe("connection_lost");
  });

  it("gives up when the phone never acknowledges", async () => {
    const { session, events } = setup({ ackTimeoutMs: 80 });
    const { url } = await session.start();
    const phone = await FakePhone.join(url);
    phone.sendHello();
    await settle();
    await session.approve({ includePasswords: false });
    await new Promise((r) => setTimeout(r, 200));
    expect(closedReason(events)).toBe("no_ack");
  });

  it("refuses to start without a private network", async () => {
    const { session } = setup({ addrs: [] });
    await expect(session.start()).rejects.toThrow(/private network/);
  });

  it("ignores approve before a phone has joined", async () => {
    const { session, events } = setup();
    await session.start();
    await session.approve({ includePasswords: true });
    expect(last(events, "sending")).toBeUndefined();
  });
});
