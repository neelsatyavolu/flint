// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FlintError } from "@flint/core/types";
import { dispatchCall, extensionFolder, isSafeExternalUrl, isTrustedFrameUrl, parseCall, serializeError } from "./ipc-core";

describe("parseCall", () => {
  it("accepts a known method with an args array", () => {
    expect(parseCall("listAccounts", [])).toEqual({ method: "listAccounts", args: [] });
  });
  it("rejects unknown methods, including prototype names and subscribe", () => {
    for (const m of ["nope", "subscribe", "constructor", "__proto__", "", 5, null]) {
      expect(() => parseCall(m, [])).toThrow("Invalid call");
    }
  });
  it("rejects non-array args", () => {
    expect(() => parseCall("listAccounts", {})).toThrow();
    expect(() => parseCall("listAccounts", undefined)).toThrow();
  });
});

describe("serializeError", () => {
  it("keeps FlintError code and message", () => {
    expect(serializeError(new FlintError("not_found", "Thread not found"))).toEqual({ code: "not_found", message: "Thread not found" });
  });
  it("maps plain errors and non-errors to internal", () => {
    expect(serializeError(new Error("boom"))).toEqual({ code: "internal", message: "boom" });
    expect(serializeError("text")).toEqual({ code: "internal", message: "text" });
    expect(serializeError(42).code).toBe("internal");
  });
});

describe("dispatchCall", () => {
  it("returns the value and maps undefined to null", async () => {
    const api = { listAccounts: vi.fn(async () => [1]), removeAccount: vi.fn(async () => undefined) };
    expect(await dispatchCall(api, "listAccounts", [])).toEqual({ ok: true, value: [1] });
    expect(await dispatchCall(api, "removeAccount", ["a"])).toEqual({ ok: true, value: null });
    expect(api.removeAccount).toHaveBeenCalledWith("a");
  });
  it("wraps thrown errors", async () => {
    const api = { getThread: async () => { throw new FlintError("not_found", "Thread not found"); } };
    expect(await dispatchCall(api, "getThread", [1])).toEqual({ ok: false, error: { code: "not_found", message: "Thread not found" } });
  });
  it("rejects unknown methods and methods the service lacks", async () => {
    expect(await dispatchCall({}, "evil", [])).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await dispatchCall({}, "listAccounts", [])).toMatchObject({ ok: false, error: { code: "invalid" } });
  });
});

describe("isTrustedFrameUrl", () => {
  it("matches only the app origin", () => {
    expect(isTrustedFrameUrl("app://flint/index.html", "app://flint")).toBe(true);
    expect(isTrustedFrameUrl("app://evil/index.html", "app://flint")).toBe(false);
    expect(isTrustedFrameUrl("about:srcdoc", "app://flint")).toBe(false);
    expect(isTrustedFrameUrl("not a url", "app://flint")).toBe(false);
    expect(isTrustedFrameUrl(undefined, "app://flint")).toBe(false);
  });
});

describe("isSafeExternalUrl", () => {
  it("allows http, https and mailto only", () => {
    expect(isSafeExternalUrl("https://example.com/a")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("mailto:a@b.co")).toBe(true);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("x-apple.systempreferences:")).toBe(false);
    expect(isSafeExternalUrl(12)).toBe(false);
    expect(isSafeExternalUrl("nope")).toBe(false);
  });
});

describe("extensionFolder", () => {
  it("joins only the two known browser families onto the bundled folder", () => {
    expect(extensionFolder("/r/browser-extension", "chromium")).toBe("/r/browser-extension/chromium");
    expect(extensionFolder("/r/browser-extension", "firefox")).toBe("/r/browser-extension/firefox");
    expect(extensionFolder("/r/browser-extension", "../../etc")).toBeNull();
    expect(extensionFolder(null, "chromium")).toBeNull();
  });
});
