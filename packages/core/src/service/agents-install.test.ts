import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync, lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentsApi } from "./agents";
import type { ServiceContext } from "./context";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "flint-cli-"));
  const bin = join(root, "bin");
  const script = join(root, "flint.js");
  writeFileSync(script, "//");
  const ctx = { options: { cliPath: script, cliInstallDirs: [bin] }, platform: { dataDir: root } } as unknown as ServiceContext;
  return { root, bin, api: agentsApi(ctx) };
}

describe("installCli", () => {
  it("writes the wrapper atomically with no temp files left", async () => {
    const { bin, api } = setup();
    const { path } = await api.installCli();
    expect(readFileSync(path, "utf8")).toContain("flint.js");
    expect(readdirSync(bin)).toEqual(["flint"]);
  });

  it("refuses to follow a pre-planted symlink", async () => {
    const { root, bin, api } = setup();
    mkdirSync(bin, { recursive: true });
    const victim = join(root, "victim");
    writeFileSync(victim, "keep");
    symlinkSync(victim, join(bin, "flint"));
    await expect(api.installCli()).rejects.toThrow();
    expect(readFileSync(victim, "utf8")).toBe("keep");
    expect(lstatSync(join(bin, "flint")).isSymbolicLink()).toBe(true);
  });
});
