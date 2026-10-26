import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODES_HOST_NAME, hostManifest, isFlintManifest } from "../codes/contract";
import { nativeHostWrapperScript } from "../codes/helper/files";
import { codesHelperApi } from "./codesHelper";
import type { ServiceContext } from "./context";

function setup(opts: { cli?: boolean; browsers?: string[]; extension?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "flint-helper-"));
  const home = join(root, "home");
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const support = join(home, "Library", "Application Support");
  for (const b of opts.browsers ?? ["Google/Chrome", "Arc/User Data"]) mkdirSync(join(support, b), { recursive: true });
  const cliPath = join(root, "flint.js");
  if (opts.cli !== false) writeFileSync(cliPath, "//");
  const extensionDir = join(root, "ext");
  if (opts.extension) mkdirSync(extensionDir);
  const ctx = { options: { cliPath, browserHome: home, extensionDir }, platform: { dataDir } } as unknown as ServiceContext;
  const manifest = (dir: string): string => join(support, dir, "NativeMessagingHosts", `${CODES_HOST_NAME}.json`);
  return { root, home, dataDir, support, manifest, api: codesHelperApi(ctx), wrapper: join(dataDir, "flint-native-host") };
}

describe("wrapper script", () => {
  it("runs the CLI native-host command with the app binary in node mode", () => {
    const s = nativeHostWrapperScript("/Applications/Flint.app/Contents/MacOS/Flint", "/x/it's/flint.js", true);
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/Applications/Flint.app/Contents/MacOS/Flint' '/x/it'\\''s/flint.js' native-host "$@"`);
    expect(nativeHostWrapperScript("/usr/bin/node", "/f.js", false)).not.toContain("ELECTRON_RUN_AS_NODE");
  });
});

describe("browserHelperStatus", () => {
  it("detects browsers by their folder under the injected home and reports nothing installed", async () => {
    const { api, wrapper } = setup();
    const s = await api.browserHelperStatus();
    const by = Object.fromEntries(s.browsers.map((b) => [b.id, b]));
    expect(by.chrome).toMatchObject({ detected: true, installed: false, foreign: false });
    expect(by.arc!.detected).toBe(true);
    expect(by.brave!.detected).toBe(false);
    expect(by.firefox!.detected).toBe(false);
    expect(s).toMatchObject({ wrapperInstalled: false, cliAvailable: true, extensionDir: null, wrapperPath: wrapper });
  });

  it("reports the extension folder only when it exists", async () => {
    const { api, root } = setup({ extension: true });
    expect((await api.browserHelperStatus()).extensionDir).toBe(join(root, "ext"));
  });
});

describe("installBrowserHelper", () => {
  it("writes an executable wrapper and a manifest only into detected browsers", async () => {
    const { api, manifest, wrapper, support } = setup();
    const s = await api.installBrowserHelper();
    expect(lstatSync(wrapper).mode & 0o111).not.toBe(0);
    expect(readFileSync(wrapper, "utf8")).toContain("native-host");
    const chrome = JSON.parse(readFileSync(manifest("Google/Chrome"), "utf8"));
    expect(chrome).toEqual(hostManifest("chromium", wrapper));
    expect(existsSync(manifest("Arc/User Data"))).toBe(true);
    expect(existsSync(join(support, "BraveSoftware"))).toBe(false);
    expect(s.wrapperInstalled).toBe(true);
    expect(s.browsers.filter((b) => b.installed).map((b) => b.id).sort()).toEqual(["arc", "chrome"]);
  });

  it("writes the Firefox manifest with allowed_extensions", async () => {
    const { api, support } = setup({ browsers: ["Firefox"] });
    await api.installBrowserHelper();
    const m = JSON.parse(readFileSync(join(support, "Mozilla", "NativeMessagingHosts", `${CODES_HOST_NAME}.json`), "utf8"));
    expect(m.allowed_extensions).toEqual(["flint-codes@xanom.co"]);
    expect(m.allowed_origins).toBeUndefined();
  });

  it("is idempotent and refreshes Flint's own manifest", async () => {
    const { api, manifest } = setup();
    await api.installBrowserHelper();
    const stale = { ...JSON.parse(readFileSync(manifest("Google/Chrome"), "utf8")), allowed_origins: ["chrome-extension://old/"] };
    writeFileSync(manifest("Google/Chrome"), JSON.stringify(stale));
    await api.installBrowserHelper();
    expect(JSON.parse(readFileSync(manifest("Google/Chrome"), "utf8")).allowed_origins[0]).toContain("gacbkfpccalfbcooobpoppipaaidlink");
  });

  it("never overwrites or removes a manifest that is not Flint's", async () => {
    const { api, manifest } = setup();
    mkdirSync(join(manifest("Google/Chrome"), ".."), { recursive: true });
    const foreign = JSON.stringify({ name: CODES_HOST_NAME, description: "Someone else", path: "/opt/other/host", type: "stdio" });
    writeFileSync(manifest("Google/Chrome"), foreign);
    const s = await api.installBrowserHelper();
    expect(readFileSync(manifest("Google/Chrome"), "utf8")).toBe(foreign);
    expect(s.browsers.find((b) => b.id === "chrome")).toMatchObject({ foreign: true, installed: false });
    expect(s.browsers.find((b) => b.id === "arc")!.installed).toBe(true);
    await api.removeBrowserHelper();
    expect(readFileSync(manifest("Google/Chrome"), "utf8")).toBe(foreign);
    expect(existsSync(manifest("Arc/User Data"))).toBe(false);
  });

  it("treats an unparseable manifest as foreign", async () => {
    const { api, manifest } = setup();
    mkdirSync(join(manifest("Google/Chrome"), ".."), { recursive: true });
    writeFileSync(manifest("Google/Chrome"), "{not json");
    await api.installBrowserHelper();
    expect(readFileSync(manifest("Google/Chrome"), "utf8")).toBe("{not json");
  });

  it("refuses to follow a symlinked manifest or wrapper", async () => {
    const { api, manifest, root, wrapper } = setup();
    const victim = join(root, "victim");
    writeFileSync(victim, "keep");
    symlinkSync(victim, wrapper);
    await expect(api.installBrowserHelper()).rejects.toThrow();
    expect(readFileSync(victim, "utf8")).toBe("keep");
    expect(existsSync(manifest("Google/Chrome"))).toBe(false);
  });

  it("fails clearly when this build has no CLI", async () => {
    const { api } = setup({ cli: false });
    await expect(api.installBrowserHelper()).rejects.toMatchObject({ code: "not_found" });
    expect((await api.browserHelperStatus()).cliAvailable).toBe(false);
  });

  it("does not leave temp files behind", async () => {
    const { api, dataDir } = setup();
    await api.installBrowserHelper();
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dataDir)).toEqual(["flint-native-host"]);
  });
});

describe("removeBrowserHelper", () => {
  it("removes the wrapper and Flint's manifests", async () => {
    const { api, manifest, wrapper } = setup();
    await api.installBrowserHelper();
    const s = await api.removeBrowserHelper();
    expect(existsSync(wrapper)).toBe(false);
    expect(existsSync(manifest("Google/Chrome"))).toBe(false);
    expect(s.wrapperInstalled).toBe(false);
    expect(s.browsers.some((b) => b.installed)).toBe(false);
  });

  it("is a no-op when nothing is installed", async () => {
    const { api } = setup();
    await expect(api.removeBrowserHelper()).resolves.toMatchObject({ wrapperInstalled: false });
  });
});

describe("manifest identity", () => {
  it("recognises its own manifest only", () => {
    expect(isFlintManifest(hostManifest("chromium", "/a/flint-native-host"))).toBe(true);
    expect(isFlintManifest({ ...hostManifest("chromium", "/a/flint-native-host"), path: "/a/other" })).toBe(false);
  });
});
