import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "./background";

const sender = { id: "me", tab: { url: "https://www.kayak.com/login?x=1" }, url: "https://www.kayak.com/login" };
const wire = { id: "k", code: "530331", service: "KAYAK", senderDomain: "kayak.com", receivedAt: 1 };

function host(reply: unknown, lastError?: string) {
  const send = vi.fn((_h: string, _m: unknown, cb?: (r: unknown) => void) => {
    (globalThis as any).chrome.runtime.lastError = lastError ? { message: lastError } : undefined;
    cb?.(reply);
  });
  (globalThis as any).chrome = { runtime: { id: "me", sendNativeMessage: send } };
  return send;
}
afterEach(() => delete (globalThis as any).chrome);

describe("background", () => {
  it("lists codes, building the origin from the sender", async () => {
    const send = host({ ok: true, codes: [wire, { bogus: 1 }] });
    expect(await handleMessage({ kind: "flint.codes.list", origin: "https://evil.example" }, sender, "me")).toEqual({ ok: true, codes: [wire] });
    expect(send).toHaveBeenCalledWith("co.xanom.flint.codes", { type: "list", origin: "https://www.kayak.com" }, expect.any(Function));
  });

  it("ignores other senders and malformed messages", async () => {
    host({ ok: true, codes: [] });
    expect(await handleMessage({ kind: "flint.codes.list" }, { ...sender, id: "other" }, "me")).toBeNull();
    expect(await handleMessage({ kind: "flint.codes.list" }, { id: "me" }, "me")).toBeNull();
    expect(await handleMessage({ kind: "nope" }, sender, "me")).toBeNull();
    expect(await handleMessage({ kind: "flint.codes.used", id: 5 }, sender, "me")).toBeNull();
    expect(await handleMessage("x", sender, "me")).toBeNull();
  });

  it("marks used", async () => {
    const send = host({ ok: true });
    expect(await handleMessage({ kind: "flint.codes.used", id: "k" }, sender, "me")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("co.xanom.flint.codes", { type: "used", id: "k" }, expect.any(Function));
  });

  it("maps failures", async () => {
    host({ ok: false, error: { code: "not_running", message: "x" } });
    expect(await handleMessage({ kind: "flint.codes.list" }, sender, "me")).toEqual({ ok: false, error: "not_running" });
    host({ ok: false, error: { code: "disabled", message: "x" } });
    expect(await handleMessage({ kind: "flint.codes.list" }, sender, "me")).toEqual({ ok: false, error: "disabled" });
    host(undefined, "Specified native messaging host not found.");
    expect(await handleMessage({ kind: "flint.codes.list" }, sender, "me")).toEqual({ ok: false, error: "no_host" });
    host(undefined, "Native host has exited.");
    expect(await handleMessage({ kind: "flint.codes.list" }, sender, "me")).toEqual({ ok: false, error: "failed" });
  });
});
