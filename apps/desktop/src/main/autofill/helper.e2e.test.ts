// @vitest-environment node
// End-to-end against the REAL built helper (apps/autofill-helper/dist/FlintAutofill). Needs no Accessibility permission:
// it only exercises the handshake, permission reporting and shutdown. No live code is ever sent, so the helper never
// observes another app. Skipped when the binary is not built or the platform is not macOS.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { encodeLine, HELPER_PROTOCOL_VERSION, parseHelperEvent, type HelperEvent } from "@flint/core/autofill/contract";
import type { FlintEvent, Settings } from "@flint/core/types";
import { createAutofillManager, type AutofillService } from "./manager";
import { spawnHelperProcess } from "./helper-process";

const bin = fileURLToPath(new URL("../../../../autofill-helper/dist/FlintAutofill", import.meta.url));
const runnable = process.platform === "darwin" && existsSync(bin);

const waitFor = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!runnable)("real FlintAutofill helper", () => {
  it("speaks the protocol: ready, permission on status, ignores junk, exits 0 on shutdown", async () => {
    const proc = spawnHelperProcess(bin);
    const events: HelperEvent[] = [];
    let bad = 0;
    proc.onLine((l) => { const e = parseHelperEvent(l); if (e) events.push(e); else bad += 1; });
    let exit: [number | null, string | null] | null = null;
    proc.onExit((c, s) => { exit = [c, s]; });
    await waitFor(() => events.some((e) => e.event === "ready"));
    const ready = events.find((e) => e.event === "ready");
    expect(ready).toMatchObject({ protocol: HELPER_PROTOCOL_VERSION, trusted: expect.any(Boolean) });
    proc.write("this is not json\n");
    proc.write(encodeLine({ op: "status" }));
    proc.write(encodeLine({ op: "codes", codes: [] }));
    await waitFor(() => events.some((e) => e.event === "permission"));
    proc.write(encodeLine({ op: "shutdown" }));
    await waitFor(() => exit !== null);
    expect(exit).toEqual([0, null]);
    expect(bad).toBe(0);
  });

  it("manager: starts the real helper, learns permission, shuts it down cleanly", async () => {
    let listener: ((e: FlintEvent) => void) | null = null;
    const settings = { codes: { enabled: true, notify: true, autoCopy: false, autofill: true, shortcut: "" } } as Settings;
    const service = {
      recentCodes: vi.fn(async () => []),
      markCodeUsed: vi.fn(async () => {}),
      getSettings: vi.fn(async () => settings),
      subscribe: vi.fn((cb: (e: FlintEvent) => void) => { listener = cb; return () => { listener = null; }; }),
    } as unknown as AutofillService;
    let pid: number | undefined;
    const manager = createAutofillManager({
      helperPath: bin,
      isMac: true,
      spawnHelper: (p) => { const h = spawnHelperProcess(p); pid = h.pid; return h; },
      shortcuts: { register: () => true, unregister: () => {} },
      openDemoField: async () => ({ x: 0, y: 0, width: 1, height: 1 }),
      openAccessibilityPane: async () => {},
    });
    manager.attach(service);
    await waitFor(() => ["ready", "needs_permission"].includes(manager.status().state));
    const s = manager.status();
    expect(s.helperRunning).toBe(true);
    expect(s.supported).toBe(true);
    expect(s.state).toBe(s.permission === "granted" ? "ready" : "needs_permission");
    expect(listener).not.toBeNull();
    await manager.stop();
    expect(manager.status().helperRunning).toBe(false);
    await waitFor(() => { try { process.kill(pid!, 0); return false; } catch { return true; } });
  });
});
