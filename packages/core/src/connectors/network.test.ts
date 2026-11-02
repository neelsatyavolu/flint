import { describe, expect, it, vi } from "vitest";
import { assertPublicConnectorUrl, isPublicConnectorAddress } from "./network";

describe("connector destination addresses", () => {
  it.each([
    "0.0.0.0", "0.255.255.255", "10.0.0.1", "10.255.255.255",
    "127.0.0.1", "127.255.255.255", "172.16.0.0", "172.31.255.255",
    "192.168.0.0", "192.168.255.255", "100.64.0.0", "100.127.255.255",
    "169.254.0.0", "169.254.169.254", "169.254.255.255", "224.0.0.1", "255.255.255.255",
    "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "febf:ffff::1", "fc00::1", "fdff:ffff::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:172.16.0.1", "::ffff:192.168.1.1",
    "::ffff:100.64.0.1", "::ffff:169.254.169.254", "::ffff:0.1.2.3",
    "::ffff:7f00:1", "0:0:0:0:0:ffff:a00:1", "::ffff:c0a8:101",
    "", "not-an-ip", "999.1.1.1", "fe80::1%en0",
  ])("refuses %s", (address) => {
    expect(isPublicConnectorAddress(address)).toBe(false);
  });

  it.each([
    "1.1.1.1", "8.8.8.8", "9.255.255.255", "11.0.0.0", "100.63.255.255", "100.128.0.0",
    "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0", "169.253.255.255", "169.255.0.0",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "fe7f::1", "fec0::1",
    "::ffff:8.8.8.8", "::ffff:808:808", "0:0:0:0:0:ffff:808:808",
  ])("allows %s", (address) => {
    expect(isPublicConnectorAddress(address)).toBe(true);
  });
});

describe("connector destination lookup", () => {
  it("checks every returned address, rejecting a mixed public/private answer", async () => {
    const lookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }]);
    await expect(assertPublicConnectorUrl("https://app.example/deliver", lookup)).rejects.toThrow("public");
    expect(lookup).toHaveBeenCalledWith("app.example");
  });

  it("allows exclusively public DNS answers and resolves each time", async () => {
    const lookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
    await assertPublicConnectorUrl("https://app.example/manifest.json", lookup);
    await assertPublicConnectorUrl("https://app.example/pair", lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each(["https://127.1/", "https://2130706433/", "https://0x7f000001/", "https://[::ffff:192.168.1.1]/", "https://[::1]/"])("rejects normalized IP literal %s without DNS", async (url) => {
    const lookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
    await expect(assertPublicConnectorUrl(url, lookup)).rejects.toThrow("public");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("accepts public literals without DNS", async () => {
    const lookup = vi.fn(async () => []);
    await assertPublicConnectorUrl("https://8.8.8.8/", lookup);
    await assertPublicConnectorUrl("https://[2606:4700:4700::1111]/", lookup);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails closed on empty DNS answers or lookup errors", async () => {
    await expect(assertPublicConnectorUrl("https://app.example/", async () => [])).rejects.toThrow("public");
    await expect(assertPublicConnectorUrl("https://app.example/", async () => { throw new Error("DNS failed"); })).rejects.toThrow("DNS failed");
  });

  it.each(["http://app.example/", "https://user:pass@app.example/", "https://app.example/#fragment"])("refuses invalid connector URL %s before DNS", async (url) => {
    const lookup = vi.fn(async () => []);
    await expect(assertPublicConnectorUrl(url, lookup)).rejects.toThrow("HTTPS");
    expect(lookup).not.toHaveBeenCalled();
  });
});
