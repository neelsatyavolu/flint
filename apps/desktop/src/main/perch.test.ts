import { describe, expect, it, vi } from "vitest";
import { PERCH_BUNDLE_ID, findPerchApp, linkMenuTemplate, openInPerch } from "./perch";

function actions() {
  return { open: vi.fn(), openInPerch: vi.fn(), copy: vi.fn() };
}

describe("findPerchApp", () => {
  it("finds Perch in /Applications, then in the home folder's Applications", () => {
    expect(findPerchApp((p) => p === "/Applications/Perch.app", "/Users/me")).toBe("/Applications/Perch.app");
    expect(findPerchApp((p) => p === "/Users/me/Applications/Perch.app", "/Users/me")).toBe("/Users/me/Applications/Perch.app");
    expect(findPerchApp(() => false, "/Users/me")).toBeNull();
  });
});

describe("linkMenuTemplate", () => {
  it("offers Open in Perch for web links when Perch is installed", () => {
    const a = actions();
    const items = linkMenuTemplate("https://example.com/a", { perch: true, ...a });
    expect(items?.map((i) => i.label ?? i.type)).toEqual(["Open Link", "Open in Perch", "separator", "Copy Link"]);
    items?.find((i) => i.label === "Open in Perch")?.click?.({} as never, undefined, {} as never);
    expect(a.openInPerch).toHaveBeenCalledWith("https://example.com/a");
    items?.find((i) => i.label === "Copy Link")?.click?.({} as never, undefined, {} as never);
    expect(a.copy).toHaveBeenCalledWith("https://example.com/a");
  });

  it("leaves Perch out when it isn't installed, and for mailto links", () => {
    expect(linkMenuTemplate("https://example.com", { perch: false, ...actions() })?.map((i) => i.label ?? i.type))
      .toEqual(["Open Link", "separator", "Copy Link"]);
    expect(linkMenuTemplate("mailto:someone@example.com", { perch: true, ...actions() })?.map((i) => i.label ?? i.type))
      .toEqual(["Open Link", "separator", "Copy Link"]);
  });

  it("shows no menu for anything that isn't a link Flint opens", () => {
    for (const link of ["", "javascript:alert(1)", "file:///etc/hosts", "about:blank", "not a url"]) {
      expect(linkMenuTemplate(link, { perch: true, ...actions() })).toBeNull();
    }
  });
});

describe("openInPerch", () => {
  it("asks macOS to open the link with Perch, without a shell", async () => {
    const run = vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null));
    await openInPerch("https://example.com/x?y=1", run);
    expect(run).toHaveBeenCalledWith("/usr/bin/open", ["-b", PERCH_BUNDLE_ID, "https://example.com/x?y=1"], expect.any(Function));
  });

  it("refuses links that aren't http or https", async () => {
    const run = vi.fn();
    await expect(openInPerch("file:///etc/hosts", run)).rejects.toThrow(/web links/);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes on a failure to open", async () => {
    const run = vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(new Error("no app")));
    await expect(openInPerch("https://example.com", run)).rejects.toThrow("no app");
  });
});
