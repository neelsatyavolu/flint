// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { encodeLine, HELPER_PROTOCOL_VERSION, HELPER_RESTART_BACKOFF_MS, type HelperCommand, type HelperEvent, type ScreenRect } from "@flint/core/autofill/contract";
import type { FlintEvent, Settings, VerificationCode } from "@flint/core/types";
import { createAutofillManager, type AutofillDeps, type AutofillService, type HelperProcess } from "./manager";
import { createLineReader } from "./helper-process";

class FakeProc implements HelperProcess {
  pid = 99;
  written: HelperCommand[] = [];
  killed: string[] = [];
  private lines: Array<(l: string) => void> = [];
  private exits: Array<(c: number | null, s: string | null) => void> = [];
  write(line: string) { this.written.push(JSON.parse(line) as HelperCommand); }
  onLine(cb: (l: string) => void) { this.lines.push(cb); }
  onExit(cb: (c: number | null, s: string | null) => void) { this.exits.push(cb); }
  kill(sig: "SIGTERM" | "SIGKILL") { this.killed.push(sig); }
  emit(e: HelperEvent) { this.lines.forEach((cb) => cb(encodeLine(e).trim())); }
  emitRaw(l: string) { this.lines.forEach((cb) => cb(l)); }
  exit(code: number | null = 1) { this.exits.forEach((cb) => cb(code, null)); }
  ops() { return this.written.map((c) => c.op); }
  last<T extends HelperCommand["op"]>(op: T) { return [...this.written].reverse().find((c) => c.op === op) as Extract<HelperCommand, { op: T }> | undefined; }
}

const baseSettings = (codes: Partial<Settings["codes"]> = {}): Settings => ({ codes: { enabled: true, notify: true, autoCopy: false, autofill: true, shortcut: "Control+Option+V", ...codes } } as Settings);
const code = (id: string, over: Partial<VerificationCode> = {}): VerificationCode => ({
  id, code: `${id}-code`, service: "KAYAK", senderAddress: "a@mail.kayak.com", senderDomain: "mail.kayak.com", threadId: "t", messageId: "m", accountId: "a",
  receivedAt: 1_000, expiresAt: 600_000, used: false, ...over,
} as VerificationCode);

function setup(opts: { codes?: VerificationCode[]; settings?: Settings; helperPath?: string | null; isMac?: boolean } = {}) {
  let clock = 10_000;
  const procs: FakeProc[] = [];
  const timers: Array<{ fn: () => void; at: number; cancelled: boolean }> = [];
  const shortcuts = new Map<string, () => void>();
  let listener: ((e: FlintEvent) => void) | null = null;
  let codes = opts.codes ?? [];
  const service = {
    recentCodes: vi.fn(async () => codes),
    markCodeUsed: vi.fn(async (id: string) => { codes = codes.map((c) => (c.id === id ? { ...c, used: true } : c)); }),
    getSettings: vi.fn(async () => opts.settings ?? baseSettings()),
    subscribe: vi.fn((cb: (e: FlintEvent) => void) => { listener = cb; return () => { listener = null; }; }),
  } as unknown as AutofillService;
  const openAccessibilityPane = vi.fn(async () => {});
  const openDemoField = vi.fn(async (_onClosed?: () => void, _onMoved?: (f: ScreenRect) => void): Promise<ScreenRect> => ({ x: 10, y: 20, width: 200, height: 30 }));
  const deps: AutofillDeps = {
    helperPath: opts.helperPath === undefined ? "/x/FlintAutofill" : opts.helperPath,
    isMac: opts.isMac ?? true,
    spawnHelper: () => { const p = new FakeProc(); procs.push(p); return p; },
    shortcuts: {
      register: (a, cb) => { if (a === "Taken") return false; shortcuts.set(a, cb); return true; },
      unregister: (a) => { shortcuts.delete(a); },
    },
    openDemoField, openAccessibilityPane,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, cancelled: false }; timers.push(t); return { cancel: () => { t.cancelled = true; } }; },
  };
  const manager = createAutofillManager(deps);
  const advance = async (ms: number) => {
    clock += ms;
    for (const t of timers.filter((x) => !x.cancelled && x.at <= clock)) { t.cancelled = true; t.fn(); }
    await flush();
  };
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const ready = async (trusted = true) => {
    await flush();
    procs.at(-1)!.emit({ event: "ready", protocol: HELPER_PROTOCOL_VERSION, version: "0.1.0", pid: 99, trusted });
    await flush();
  };
  return {
    manager, procs, shortcuts, service, deps, openAccessibilityPane, openDemoField, advance, flush, ready,
    attach: async () => { manager.attach(service); await flush(); },
    emit: async (e: FlintEvent) => { listener!(e); await flush(); },
    setCodes: (c: VerificationCode[]) => { codes = c; },
    pending: () => timers.filter((t) => !t.cancelled).length,
  };
}

describe("autofill manager", () => {
  it("reports unsupported without a helper or off macOS and never spawns", async () => {
    for (const o of [{ helperPath: null }, { isMac: false }]) {
      const t = setup(o);
      await t.attach();
      expect(t.manager.status().supported).toBe(false);
      expect(t.manager.status().state).toBe("unavailable");
      expect(t.procs).toHaveLength(0);
      await expect(t.manager.tryDemo()).rejects.toThrow();
    }
  });

  it("starts the helper on attach, reports permission, and sends waiting codes after ready", async () => {
    const t = setup({ codes: [code("a", { expiresAt: 500_000 }), code("b", { expiresAt: 600_000 }), code("used", { used: true }), code("old", { expiresAt: 5_000 })] });
    await t.attach();
    expect(t.procs).toHaveLength(1);
    expect(t.manager.status().state).toBe("unavailable"); // permission not known yet
    await t.ready(false);
    expect(t.manager.status()).toMatchObject({ state: "needs_permission", permission: "needed", helperRunning: true, waiting: 2, shortcutActive: "Control+Option+V", supported: true });
    const sent = t.procs[0]!.last("codes")!;
    expect(sent.codes.map((c) => c.id)).toEqual(["b", "a"]); // newest first, used and expired dropped
    expect(Object.keys(sent.codes[0]!).sort()).toEqual(["code", "expiresAt", "id", "receivedAt", "senderDomain", "service"]);
    t.procs[0]!.emit({ event: "permission", trusted: true });
    expect(t.manager.status()).toMatchObject({ state: "ready", permission: "granted" });
  });

  it("sends the full list on each new code event and an empty list at expiry", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    t.setCodes([code("n", { expiresAt: 20_000 })]);
    await t.emit({ type: "code", code: code("n") });
    expect(t.procs[0]!.last("codes")!.codes.map((c) => c.id)).toEqual(["n"]);
    await t.advance(11_000);
    expect(t.procs[0]!.last("codes")!.codes).toEqual([]);
    expect(t.manager.status().waiting).toBe(0);
  });

  it("marks a code used on a used event, resends the list, and ignores the demo code", async () => {
    const t = setup({ codes: [code("a")] });
    await t.attach();
    await t.ready();
    t.procs[0]!.emit({ event: "used", codeId: "demo", via: "demo", method: "typed" });
    await t.flush();
    expect(t.service.markCodeUsed).not.toHaveBeenCalled();
    t.procs[0]!.emit({ event: "used", codeId: "a", via: "suggestion", method: "typed" });
    await t.flush();
    expect(t.service.markCodeUsed).toHaveBeenCalledWith("a");
    expect(t.procs[0]!.last("codes")!.codes).toEqual([]);
  });

  it("survives junk lines and a protocol mismatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup({ codes: [code("a")] });
    await t.attach();
    t.procs[0]!.emitRaw("not json 530331");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("530331");
    t.procs[0]!.emit({ event: "ready", protocol: 99, version: "9", pid: 1, trusted: true });
    await t.flush();
    expect(t.procs[0]!.ops()).toContain("shutdown");
    expect(t.manager.status().state).toBe("unavailable");
    warn.mockRestore();
  });

  it("restarts after a crash with backoff and gives up after six failures in a row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    await t.attach();
    for (let i = 0; i < 5; i++) {
      expect(t.procs).toHaveLength(i + 1);
      t.procs[i]!.exit(1);
      await t.advance(HELPER_RESTART_BACKOFF_MS[i]! - 1);
      expect(t.procs).toHaveLength(i + 1);
      await t.advance(1);
      expect(t.procs).toHaveLength(i + 2);
    }
    t.procs[5]!.exit(1);
    await t.advance(60_000);
    expect(t.procs).toHaveLength(6);
    expect(t.manager.status()).toMatchObject({ state: "unavailable", helperRunning: false, shortcutActive: null });
    // A settings change gives it another go.
    await t.emit({ type: "settings", settings: baseSettings({ autofill: false }) });
    await t.emit({ type: "settings", settings: baseSettings({ autofill: true }) });
    expect(t.procs).toHaveLength(7);
  });

  it("resets the backoff after a healthy run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    await t.attach();
    t.procs[0]!.exit(1);
    await t.advance(1_000);
    await t.advance(61_000);
    t.procs[1]!.exit(1);
    await t.advance(1_000); // first-step backoff again, not 2 s
    expect(t.procs).toHaveLength(3);
  });

  it("stops the helper when autofill or code detection is turned off, and starts it again once the old one is gone", async () => {
    const t = setup({ codes: [code("a", { expiresAt: 500_000 })] });
    await t.attach();
    await t.ready();
    expect(t.shortcuts.has("Control+Option+V")).toBe(true);
    await t.emit({ type: "settings", settings: baseSettings({ autofill: false }) });
    expect(t.procs[0]!.ops()).toContain("shutdown");
    expect(t.manager.status().state).toBe("off");
    expect(t.shortcuts.size).toBe(0);
    await t.emit({ type: "settings", settings: baseSettings({ enabled: false }) });
    expect(t.procs).toHaveLength(1);
    await t.emit({ type: "settings", settings: baseSettings() });
    expect(t.procs).toHaveLength(1); // the old helper is still shutting down: never two at once
    t.procs[0]!.exit(0);
    await t.flush();
    expect(t.procs).toHaveLength(2);
    await t.ready();
    expect(t.shortcuts.has("Control+Option+V")).toBe(true);
  });

  it("starts the replacement helper when the old one has to be killed", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    await t.emit({ type: "settings", settings: baseSettings({ autofill: false }) });
    await t.emit({ type: "settings", settings: baseSettings() });
    expect(t.procs).toHaveLength(1);
    await t.advance(2_000); // SIGKILL escalation releases it
    expect(t.procs[0]!.killed).toContain("SIGKILL");
    expect(t.procs).toHaveLength(2);
  });

  it("holds the shortcut only while a code is waiting, so other apps keep the key", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    expect(t.shortcuts.size).toBe(0); // no code: only a probe ran
    expect(t.manager.status().shortcutActive).toBe("Control+Option+V");
    t.setCodes([code("a", { expiresAt: 20_000 })]);
    await t.emit({ type: "code", code: code("a") });
    expect(t.shortcuts.has("Control+Option+V")).toBe(true);
    await t.advance(10_300); // the code expires
    expect(t.shortcuts.size).toBe(0);
    expect(t.manager.status().shortcutActive).toBe("Control+Option+V");
  });

  it("releases the shortcut once the waiting code is used", async () => {
    const t = setup({ codes: [code("a", { expiresAt: 500_000 })] });
    await t.attach();
    await t.ready();
    expect(t.shortcuts.has("Control+Option+V")).toBe(true);
    t.procs[0]!.emit({ event: "used", codeId: "a", via: "suggestion", method: "typed" });
    await t.flush();
    expect(t.shortcuts.size).toBe(0);
  });

  it("types the newest code on the shortcut only when one is waiting; changes and clears the shortcut", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    t.setCodes([code("a", { expiresAt: 500_000 })]);
    await t.emit({ type: "code", code: code("a") });
    t.shortcuts.get("Control+Option+V")!();
    expect(t.procs[0]!.ops()).toContain("type_newest");
    await t.emit({ type: "settings", settings: baseSettings({ shortcut: "Control+Shift+K" }) });
    expect([...t.shortcuts.keys()]).toEqual(["Control+Shift+K"]);
    expect(t.manager.status().shortcutActive).toBe("Control+Shift+K");
    await t.emit({ type: "settings", settings: baseSettings({ shortcut: "" }) });
    expect(t.shortcuts.size).toBe(0);
    expect(t.manager.status().shortcutActive).toBeNull();
    await t.emit({ type: "settings", settings: baseSettings({ shortcut: "Taken" }) });
    expect(t.manager.status().shortcutActive).toBeNull(); // taken by another app, reported even with no code waiting
  });

  it("requestPermission asks the helper to prompt and open the pane; without a helper it opens the pane itself", async () => {
    const t = setup();
    await t.attach();
    await t.ready(false);
    const st = await t.manager.requestPermission();
    expect(t.procs[0]!.last("request_permission")).toEqual({ op: "request_permission", openPane: true });
    expect(st.state).toBe("needs_permission");
    expect(t.openAccessibilityPane).not.toHaveBeenCalled();

    const off = setup({ settings: baseSettings({ autofill: false }) });
    await off.attach();
    await off.manager.requestPermission();
    expect(off.openAccessibilityPane).toHaveBeenCalledTimes(1);
  });

  it("tryDemo needs permission, then opens the field and sends a demo with a fake code; closing the window stops it", async () => {
    const t = setup();
    await t.attach();
    await t.ready(false);
    await expect(t.manager.tryDemo()).rejects.toMatchObject({ code: "permission" });
    t.procs[0]!.emit({ event: "permission", trusted: true });
    await t.manager.tryDemo();
    const demo = t.procs[0]!.last("demo")!;
    expect(demo.field).toEqual({ x: 10, y: 20, width: 200, height: 30 });
    expect(demo.code).toMatch(/^\d{6}$/);
    t.procs[0]!.written.length = 0;
    t.openDemoField.mock.calls[0]![1]!({ x: 50, y: 60, width: 200, height: 30 }); // the sample window was dragged
    expect(t.procs[0]!.last("demo")!.field).toEqual({ x: 50, y: 60, width: 200, height: 30 });
    t.openDemoField.mock.calls[0]![0]!();
    expect(t.procs[0]!.ops().at(-1)).toBe("demo_stop");
  });

  it("stop shuts the helper down, escalates to SIGTERM then SIGKILL, unregisters the shortcut and is idempotent", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    const p = t.procs[0]!;
    let done = false;
    const stopping = t.manager.stop().then(() => { done = true; });
    expect(t.manager.stop()).toBe(t.manager.stop());
    await t.flush();
    expect(p.ops().at(-1)).toBe("shutdown");
    expect(t.shortcuts.size).toBe(0);
    await t.advance(1_000);
    expect(p.killed).toEqual(["SIGTERM"]);
    expect(done).toBe(false);
    await t.advance(1_000);
    await stopping;
    expect(p.killed).toEqual(["SIGTERM", "SIGKILL"]);
    p.exit(null);
    await t.advance(60_000);
    expect(t.procs).toHaveLength(1); // no restart after quit
  });

  it("stop resolves at once when the helper exits on shutdown", async () => {
    const t = setup();
    await t.attach();
    await t.ready();
    const stopping = t.manager.stop();
    t.procs[0]!.exit(0);
    await stopping;
    expect(t.procs[0]!.killed).toEqual([]);
    expect(t.pending()).toBe(0);
  });
});

describe("createLineReader", () => {
  const collect = (max?: number) => { const out: string[] = []; return { out, push: createLineReader((l) => out.push(l), max) }; };
  it("joins lines split across chunks and handles several lines in one chunk", () => {
    const r = collect();
    r.push(Buffer.from('{"a":1}\n{"b"'));
    r.push(Buffer.from(':2}\n\n{"c":3}\n'));
    expect(r.out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
  it("keeps multi-byte characters intact across chunks", () => {
    const r = collect();
    const bytes = Buffer.from("é\n");
    r.push(bytes.subarray(0, 1));
    r.push(bytes.subarray(1));
    expect(r.out).toEqual(["é"]);
  });
  it("drops an oversized line and resyncs at the next newline", () => {
    const r = collect(10);
    r.push(Buffer.from("x".repeat(30)));
    r.push(Buffer.from("yyy\nok\n"));
    expect(r.out).toEqual(["ok"]);
  });
});
