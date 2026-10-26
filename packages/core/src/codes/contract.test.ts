import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHOD_TIERS } from "../api";
import {
  BROWSER_MANIFEST_DIRS, CODES_ALLOWED_ORIGIN, CODES_EXTENSION_ID, CODES_FIREFOX_ID, CODES_HOST_NAME, codesPaths, hostManifest,
  isFlintManifest, nativeRequestSchema, socketRequestSchema,
} from "./contract";

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "browser-extension");
const readJson = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(extDir, name), "utf8"));

describe("codes contract", () => {
  it("derives the Chromium extension id from the manifest key", () => {
    const key = readJson("manifest.chromium.json").key as string;
    const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
    expect(id).toBe(CODES_EXTENSION_ID);
    expect(CODES_ALLOWED_ORIGIN).toBe(`chrome-extension://${id}/`);
  });

  it("matches the Firefox gecko id and keeps the permission list minimal", () => {
    const ff = readJson("manifest.firefox.json") as { browser_specific_settings: { gecko: { id: string } }; permissions: string[] };
    expect(ff.browser_specific_settings.gecko.id).toBe(CODES_FIREFOX_ID);
    expect(ff.permissions).toEqual(["nativeMessaging"]);
    expect((readJson("manifest.chromium.json") as { permissions: string[] }).permissions).toEqual(["nativeMessaging"]);
  });

  it("builds host manifests per browser family and recognizes only its own", () => {
    const chromium = hostManifest("chromium", "/data/flint-native-host");
    const firefox = hostManifest("firefox", "/data/flint-native-host");
    expect(chromium).toMatchObject({ name: CODES_HOST_NAME, type: "stdio", allowed_origins: [CODES_ALLOWED_ORIGIN] });
    expect(firefox).toMatchObject({ allowed_extensions: [CODES_FIREFOX_ID] });
    expect(isFlintManifest(chromium)).toBe(true);
    expect(isFlintManifest({ ...chromium, path: "/usr/bin/other" })).toBe(false);
    expect(isFlintManifest({ ...chromium, description: "Someone else" })).toBe(false);
    expect(isFlintManifest(null)).toBe(false);
  });

  it("keeps the socket path short enough for AF_UNIX", () => {
    expect(codesPaths("/data").socketPath).toBe("/data/codes.sock");
    const long = codesPaths(`/${"x".repeat(120)}`, "/tmp");
    expect(Buffer.byteLength(long.socketPath)).toBeLessThanOrEqual(100);
    expect(long.socketPath.endsWith("/codes.sock")).toBe(true);
  });

  it("validates the socket and native messaging requests", () => {
    expect(socketRequestSchema.safeParse({ id: 1, op: "hello", token: "t" }).success).toBe(true);
    expect(socketRequestSchema.safeParse({ id: 2, op: "list" }).success).toBe(true);
    expect(socketRequestSchema.safeParse({ id: 3, op: "sendDraft" }).success).toBe(false);
    expect(nativeRequestSchema.safeParse({ type: "list", origin: "https://kayak.com" }).success).toBe(true);
    expect(nativeRequestSchema.safeParse({ type: "used", id: "" }).success).toBe(false);
  });

  it("keeps every code method away from agents", () => {
    for (const m of ["recentCodes", "markCodeUsed", "browserHelperStatus", "installBrowserHelper", "removeBrowserHelper"] as const) {
      expect(METHOD_TIERS[m]).toBe("admin");
    }
  });

  it("lists every supported browser once", () => {
    const ids = BROWSER_MANIFEST_DIRS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["chrome", "chrome-beta", "chrome-canary", "chromium", "brave", "edge", "vivaldi", "arc", "dia", "firefox"]));
  });
});
