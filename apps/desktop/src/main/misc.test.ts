// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { badgeCount, createBadgeUpdater } from "./badge";
import { buildCsp } from "./csp";
import { mergeDeep, MOCK_DEFAULT_SETTINGS } from "./default-settings";
import { parseMailto } from "./mailto";
import { buildMenuTemplate } from "./menu-template";
import { planeBackground } from "./theme";

afterEach(() => vi.useRealTimers());

describe("parseMailto", () => {
  it("extracts and decodes the address", () => {
    expect(parseMailto("mailto:a@b.co")).toBe("a@b.co");
    expect(parseMailto("MAILTO:a%2Bx@b.co?subject=Hi")).toBe("a+x@b.co");
    expect(parseMailto("mailto:a@b.co,c@d.co")).toBe("a@b.co");
  });
  it("rejects other schemes, empty and malformed", () => {
    expect(parseMailto("https://a.co")).toBeNull();
    expect(parseMailto("mailto:")).toBeNull();
    expect(parseMailto("mailto:%E0%A4%A")).toBeNull();
  });
});

describe("buildCsp", () => {
  it("is strict in production", () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob: https: flint-attachment:");
    expect(csp).toContain("frame-src 'self' about: blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-inline'; img");
    expect(csp).not.toContain("ws:");
  });
  it("allows the dev server in development", () => {
    expect(buildCsp({ dev: true })).toContain("ws://localhost:*");
  });
});

describe("theme", () => {
  it("matches DESIGN plane-1", () => {
    expect(planeBackground(true)).toBe("#161615");
    expect(planeBackground(false)).toBe("#F6F4EE");
  });
});

describe("badge updater", () => {
  it("throttles bursts into one trailing update", async () => {
    vi.useFakeTimers();
    const setBadge = vi.fn();
    const getUnread = vi.fn(async () => 7);
    const u = createBadgeUpdater({ getUnread, setBadge, throttleMs: 1000 });
    u.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(setBadge).toHaveBeenCalledWith(7);
    u.request(); u.request(); u.request();
    await vi.advanceTimersByTimeAsync(500);
    expect(setBadge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(setBadge).toHaveBeenCalledTimes(2);
  });
  it("keeps the badge when the count fails and clamps negatives", async () => {
    vi.useFakeTimers();
    const setBadge = vi.fn();
    let n = -3;
    const u = createBadgeUpdater({ getUnread: async () => { if (n === 99) throw new Error("x"); return n; }, setBadge, throttleMs: 10 });
    u.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(setBadge).toHaveBeenLastCalledWith(0);
    n = 99;
    u.request();
    await vi.advanceTimersByTimeAsync(20);
    expect(setBadge).toHaveBeenCalledTimes(1);
    u.request();
    u.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(setBadge).toHaveBeenCalledTimes(1);
  });
});

describe("menu template", () => {
  const labels = (t: ReturnType<typeof buildMenuTemplate>) => t.map((m) => m.label ?? m.role);
  it("has every section on mac and sends actions", () => {
    const send = vi.fn();
    const t = buildMenuTemplate({ isMac: true, isDev: false, send });
    expect(labels(t)).toEqual(["Flint", "File", "Edit", "View", "Message", "Go", "Window", "help"]);
    const file = t[1]?.submenu as { label?: string; click?: () => void; accelerator?: string }[];
    expect(file[0]).toMatchObject({ label: "New Message", accelerator: "CmdOrCtrl+N" });
    file[0]?.click?.();
    expect(send).toHaveBeenCalledWith("compose");
    const message = t[4]?.submenu as { label?: string; accelerator?: string; registerAccelerator?: boolean }[];
    expect(message.find((i) => i.label === "Reply All")?.accelerator).toBe("Shift+CmdOrCtrl+R");
    expect(message.find((i) => i.label === "Archive")).toMatchObject({ accelerator: "E", registerAccelerator: false });
  });
  it("adds reload and devtools only in dev, and drops the app menu off mac", () => {
    const view = (dev: boolean) => (buildMenuTemplate({ isMac: false, isDev: dev, send: vi.fn() })[2]?.submenu as { role?: string }[]).map((i) => i.role);
    expect(view(false)).not.toContain("toggleDevTools");
    expect(view(true)).toEqual(expect.arrayContaining(["reload", "toggleDevTools"]));
    expect(labels(buildMenuTemplate({ isMac: false, isDev: false, send: vi.fn() }))[0]).toBe("File");
  });
  it("shows Check for Updates only when the updater runs", () => {
    const appItems = (checkForUpdates?: () => void) => buildMenuTemplate({ isMac: true, isDev: false, send: vi.fn(), checkForUpdates })[0]?.submenu as { label?: string; click?: () => void }[];
    expect(appItems().some((i) => i.label === "Check for Updates...")).toBe(false);
    const check = vi.fn();
    appItems(check).find((i) => i.label === "Check for Updates...")?.click?.();
    expect(check).toHaveBeenCalledOnce();
  });
});

describe("mergeDeep", () => {
  it("merges nested settings without mutating the base", () => {
    const next = mergeDeep(MOCK_DEFAULT_SETTINGS, { inbox: { blockTrackers: false } });
    expect(next.inbox.blockTrackers).toBe(false);
    expect(next.inbox.focused).toBe(true);
    expect(MOCK_DEFAULT_SETTINGS.inbox.blockTrackers).toBe(true);
  });
});

describe("badgeCount", () => {
  const page = (n: number, next: string | null = null) => ({ items: Array.from({ length: n }, (_, i) => ({ id: i })), bundles: [], nextCursor: next });
  it("uses the unified inbox count, zero when off, and counts unread people threads across pages", async () => {
    const getSidebar = vi.fn(async () => ({ counts: { inbox: 4 } }));
    const listThreads = vi.fn()
      .mockResolvedValueOnce(page(200, "c1"))
      .mockResolvedValueOnce(page(3));
    const api = { getSidebar, listThreads } as never;
    expect(await badgeCount("unified_unread", api)).toBe(4);
    expect(await badgeCount("off", api)).toBe(0);
    expect(await badgeCount("people_unread", api)).toBe(203);
    expect(listThreads).toHaveBeenLastCalledWith(expect.objectContaining({ view: "inbox", focused: true, unreadOnly: true, cursor: "c1" }));
  });
});
