import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyDefaultReceiptsEndpoint, DEFAULT_RECEIPTS_ENDPOINT } from "./receipts-default";

function fakeApi(endpoint: string) {
  let current = endpoint;
  return {
    getSettings: vi.fn(async () => ({ receipts: { endpoint: current } }) as never),
    updateSettings: vi.fn(async (p: { receipts?: { endpoint?: string } }) => { current = p.receipts?.endpoint ?? current; return {} as never; }),
    get endpoint() { return current; },
  };
}

describe("applyDefaultReceiptsEndpoint", () => {
  it("fills the hosted endpoint once on first run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flint-rd-"));
    const api = fakeApi("");
    await applyDefaultReceiptsEndpoint(api, dir);
    expect(api.endpoint).toBe(DEFAULT_RECEIPTS_ENDPOINT);
    expect(existsSync(join(dir, ".receipts-default-applied"))).toBe(true);
    api.updateSettings.mockClear();
    await applyDefaultReceiptsEndpoint(fakeApi(""), dir);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps an endpoint the user already set", async () => {
    const api = fakeApi("https://receipts.example.org");
    await applyDefaultReceiptsEndpoint(api, mkdtempSync(join(tmpdir(), "flint-rd-")));
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(api.endpoint).toBe("https://receipts.example.org");
  });
});
