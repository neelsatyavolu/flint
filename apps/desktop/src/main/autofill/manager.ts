/**
 * AutofillManager: owns the FlintAutofill helper process. OWNER: electron builder. The interface and the
 * decisions below are frozen; the body of createAutofillManager is the builder's to write (this file is a stub).
 *
 * Decisions
 * - Lifecycle: the helper runs whenever settings.codes.enabled && settings.codes.autofill is on and the build ships it,
 *   whether or not a code is waiting. Idle it holds one timer and no AX observers (near-zero CPU), and keeping it up
 *   makes the permission state answerable instantly and lets the first suggestion appear without a launch delay.
 *   The expensive work (AXObserver, the 400 ms poll, AXManualAccessibility on browsers) happens only inside the helper
 *   while it holds at least one waiting code. Turning the setting off stops the process.
 * - Codes flow: on start and on every {type:"code"} event, mark-used, or expiry, main sends the full list
 *   (service.recentCodes() filtered to unused and unexpired, newest first) as one `codes` command. It schedules a
 *   timer for the earliest expiry so the helper is told within a second of the last code expiring.
 * - `used` event -> service.markCodeUsed(codeId) (ignore codeId "demo"), then resend `codes`.
 * - Crashes: restart with HELPER_RESTART_BACKOFF_MS; reset after HELPER_HEALTHY_AFTER_MS of uptime; after
 *   HELPER_RESTART_MAX_ATTEMPTS failures in a row status.state is "unavailable" until settings change or the app restarts.
 * - Shortcut: settings.codes.shortcut is held with globalShortcut only while at least one code is waiting, so the key
 *   combination reaches other apps the rest of the time. Pressing it sends `type_newest`. When autofill is on and the
 *   shortcut is set, a probe registration (registered and released at once) checks that it is free; status.shortcutActive
 *   is the accelerator that passed (probe or held), null when off, "" or taken by another app.
 * - Quit: `shutdown` command, then SIGTERM after 1 s, SIGKILL after 2 s.
 * - Never log codes or helper lines (a bad line is logged as "bad helper line" with its byte length only).
 */
import {
  encodeLine, HELPER_HEALTHY_AFTER_MS, HELPER_PROTOCOL_VERSION, HELPER_RESTART_BACKOFF_MS, HELPER_RESTART_MAX_ATTEMPTS,
  parseHelperEvent, UNSUPPORTED_AUTOFILL_STATUS,
  type AutofillHost, type HelperCode, type HelperCommand, type ScreenRect,
} from "@flint/core/autofill/contract";
import type { FlintService } from "@flint/core/service/index";
import { FlintError, type AutofillStatus, type Settings } from "@flint/core/types";

/** The slice of the service the manager uses. */
export type AutofillService = Pick<FlintService, "recentCodes" | "markCodeUsed" | "getSettings" | "subscribe">;

export type AutofillManager = AutofillHost & {
  /** Called once the service exists (the manager is created earlier, to be passed in ServiceOptions.autofill). Reads settings, subscribes, starts the helper if due. */
  attach(service: AutofillService): void;
  /** Stops the helper and unregisters the shortcut. Resolves when the process is gone. Idempotent. */
  stop(): Promise<void>;
};

/** Everything the manager touches outside itself, injected so tests use a fake process, shortcut registry and clock. */
export type HelperProcess = {
  pid: number | undefined;
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
};
export type AutofillDeps = {
  /** Absolute path of the FlintAutofill binary, or null when this build ships none (status "unavailable"). */
  helperPath: string | null;
  isMac: boolean;
  spawnHelper(path: string): HelperProcess;
  shortcuts: { register(accelerator: string, cb: () => void): boolean; unregister(accelerator: string): void };
  /** Opens the demo window with a code input and resolves with its field rectangle in screen coordinates (top-left origin). */
  openDemoField(onClosed?: () => void, onMoved?: (field: ScreenRect) => void): Promise<ScreenRect>;
  openAccessibilityPane(): Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
};

type Timer = { cancel(): void };
const DEMO_CODE = "482913";
const DEMO_MAX_MS = 60_000;
const SIGTERM_AFTER_MS = 1_000;
const SIGKILL_AFTER_MS = 2_000;
/** Cap on the expiry timer so a clock change cannot park it for hours. */
const EXPIRY_SLACK_MS = 250;

const defaultTimer = (fn: () => void, ms: number): Timer => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return { cancel: () => clearTimeout(t) };
};

type Wanted = { enabled: boolean; autofill: boolean; shortcut: string };

export function createAutofillManager(deps: AutofillDeps): AutofillManager {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? defaultTimer;
  const available = deps.isMac && deps.helperPath !== null;

  let service: AutofillService | null = null;
  let unsubscribe: (() => void) | null = null;
  let wanted: Wanted = { enabled: false, autofill: false, shortcut: "" };
  let proc: HelperProcess | null = null;
  let trusted: boolean | null = null;
  let waiting: HelperCode[] = [];
  let failures = 0;
  let startedAt = 0;
  let gaveUp = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let restartTimer: Timer | null = null;
  let expiryTimer: Timer | null = null;
  let demoTimer: Timer | null = null;
  /** Accelerator that is free to use (probed or held); what status reports. */
  let shortcutActive: string | null = null;
  /** Accelerator registered right now; only while a code is waiting. */
  let shortcutHeld: string | null = null;
  let pendingShutdown: Promise<void> | null = null;
  let refreshSeq = 0;

  const on = (): boolean => available && !stopped && !gaveUp && wanted.enabled && wanted.autofill;
  const log = (msg: string): void => console.warn(`[autofill] ${msg}`);

  const send = (command: HelperCommand): void => {
    if (!proc) return;
    try { proc.write(encodeLine(command)); } catch { log("could not write to the helper"); }
  };

  // ---------- codes ----------

  const liveCodes = (): HelperCode[] => waiting.filter((c) => c.expiresAt > now());

  const scheduleExpiry = (): void => {
    expiryTimer?.cancel();
    expiryTimer = null;
    const live = liveCodes();
    if (live.length === 0 || stopped) return;
    const next = Math.min(...live.map((c) => c.expiresAt));
    expiryTimer = setTimer(() => { expiryTimer = null; void refreshCodes(); }, Math.max(0, next - now()) + EXPIRY_SLACK_MS);
  };

  async function refreshCodes(): Promise<void> {
    if (!service || stopped) return;
    const seq = ++refreshSeq;
    let list: HelperCode[];
    try {
      const all = await service.recentCodes();
      list = all
        .filter((c) => !c.used && c.expiresAt > now())
        .sort((a, b) => b.expiresAt - a.expiresAt)
        .slice(0, 20)
        .map((c) => ({ id: c.id, code: c.code, service: c.service, senderDomain: c.senderDomain, receivedAt: c.receivedAt, expiresAt: c.expiresAt }));
    } catch {
      log("could not read recent codes");
      return;
    }
    if (seq !== refreshSeq || stopped) return;
    waiting = on() ? list : [];
    send({ op: "codes", codes: waiting });
    scheduleExpiry();
    syncShortcut();
  }

  // ---------- shortcut ----------

  const syncShortcut = (): void => {
    const accel = on() ? wanted.shortcut.trim() : "";
    const hold = accel && liveCodes().length > 0 ? accel : "";
    if (shortcutHeld && shortcutHeld !== hold) {
      try { deps.shortcuts.unregister(shortcutHeld); } catch { /* already gone */ }
      shortcutHeld = null;
    }
    if (shortcutActive && shortcutActive !== accel) shortcutActive = null;
    if (hold) {
      if (shortcutHeld !== hold) {
        let ok = false;
        try { ok = deps.shortcuts.register(hold, onShortcut); } catch { ok = false; }
        shortcutHeld = ok ? hold : null;
        shortcutActive = shortcutHeld;
        if (!ok) log("could not register the shortcut");
      }
    } else if (accel && shortcutActive !== accel) {
      // No code is waiting, so keep the key free for other apps; just check that it could be taken.
      let ok = false;
      try { ok = deps.shortcuts.register(accel, () => {}); } catch { ok = false; }
      if (ok) { try { deps.shortcuts.unregister(accel); } catch { /* already gone */ } }
      shortcutActive = ok ? accel : null;
      if (!ok) log("could not register the shortcut");
    }
  };

  function onShortcut(): void {
    if (proc && liveCodes().length > 0) send({ op: "type_newest" });
  }

  // ---------- helper process ----------

  function startHelper(): void {
    if (proc || restartTimer || pendingShutdown || !on() || !deps.helperPath) return;
    let p: HelperProcess;
    try {
      p = deps.spawnHelper(deps.helperPath);
    } catch {
      log("could not start the helper");
      onHelperGone(0);
      return;
    }
    proc = p;
    trusted = null;
    startedAt = now();
    let intentional = false;
    intentionalExit.set(p, () => { intentional = true; });
    p.onLine((line) => { if (proc === p) onLine(line); });
    p.onExit(() => {
      if (proc !== p) return;
      proc = null;
      trusted = null;
      if (intentional || stopped) return;
      onHelperGone(now() - startedAt);
    });
    send({ op: "status" });
    void refreshCodes();
  }

  function onHelperGone(uptime: number): void {
    if (uptime >= HELPER_HEALTHY_AFTER_MS) failures = 0;
    failures += 1;
    if (failures >= HELPER_RESTART_MAX_ATTEMPTS) {
      gaveUp = true;
      syncShortcut();
      log("the helper keeps stopping, giving up until settings change");
      return;
    }
    const delay = HELPER_RESTART_BACKOFF_MS[Math.min(failures - 1, HELPER_RESTART_BACKOFF_MS.length - 1)]!;
    restartTimer = setTimer(() => { restartTimer = null; startHelper(); }, delay);
  }

  const intentionalExit = new WeakMap<HelperProcess, () => void>();

  /** Asks the helper to quit, escalating to SIGTERM and SIGKILL. Resolves when it is gone (or killed). */
  function shutdownHelper(): Promise<void> {
    restartTimer?.cancel();
    restartTimer = null;
    const p = proc;
    if (!p) return Promise.resolve();
    intentionalExit.get(p)?.();
    proc = null;
    trusted = null;
    const promise: Promise<void> = new Promise<void>((resolve) => {
      const timers: Timer[] = [];
      const done = (): void => { timers.forEach((t) => t.cancel()); resolve(); };
      p.onExit(done);
      timers.push(setTimer(() => { try { p.kill("SIGTERM"); } catch { /* gone */ } }, SIGTERM_AFTER_MS));
      timers.push(setTimer(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } done(); }, SIGKILL_AFTER_MS));
      try { p.write(encodeLine({ op: "shutdown" })); } catch { /* stdin closed */ }
    });
    // A new helper waits for this one to be gone, so two never observe and show panels at once.
    pendingShutdown = promise;
    void promise.then(() => {
      if (pendingShutdown !== promise) return;
      pendingShutdown = null;
      if (on()) startHelper();
    });
    return promise;
  }

  function onLine(line: string): void {
    const ev = parseHelperEvent(line);
    if (!ev) { log(`bad helper line (${Buffer.byteLength(line)} bytes)`); return; }
    switch (ev.event) {
      case "ready":
        if (ev.protocol !== HELPER_PROTOCOL_VERSION) {
          log(`helper speaks protocol ${ev.protocol}, expected ${HELPER_PROTOCOL_VERSION}`);
          gaveUp = true;
          syncShortcut();
          void shutdownHelper();
          return;
        }
        trusted = ev.trusted;
        send({ op: "codes", codes: liveCodes() });
        return;
      case "permission":
        trusted = ev.trusted;
        return;
      case "used":
        if (ev.codeId !== "demo") void markUsed(ev.codeId);
        return;
      case "fill_failed":
        log(`fill failed: ${ev.reason}`);
        if (ev.reason === "expired") void refreshCodes();
        return;
      case "error":
        log(`helper: ${ev.message}`);
        return;
      case "observing":
        return;
    }
  }

  async function markUsed(id: string): Promise<void> {
    try { await service?.markCodeUsed(id); } catch { log("could not mark a code used"); }
    await refreshCodes();
  }

  // ---------- settings ----------

  function applySettings(s: Settings): void {
    if (stopped) return;
    const next: Wanted = { enabled: s.codes.enabled, autofill: s.codes.autofill, shortcut: s.codes.shortcut };
    const changed = next.enabled !== wanted.enabled || next.autofill !== wanted.autofill;
    wanted = next;
    if (changed) { gaveUp = false; failures = 0; }
    if (on()) {
      startHelper();
    } else {
      waiting = [];
      expiryTimer?.cancel();
      expiryTimer = null;
      void shutdownHelper();
    }
    syncShortcut();
  }

  // ---------- AutofillHost ----------

  function status(): AutofillStatus {
    if (!available) return UNSUPPORTED_AUTOFILL_STATUS;
    const base = { supported: true, helperRunning: proc !== null, waiting: liveCodes().length, shortcutActive };
    if (!wanted.enabled || !wanted.autofill) return { ...base, state: "off", permission: trusted === null ? "unknown" : trusted ? "granted" : "needed" };
    if (gaveUp || trusted === null) return { ...base, state: "unavailable", permission: "unknown" };
    return trusted ? { ...base, state: "ready", permission: "granted" } : { ...base, state: "needs_permission", permission: "needed" };
  }

  async function requestPermission(): Promise<AutofillStatus> {
    if (proc) send({ op: "request_permission", openPane: true });
    else if (available) await deps.openAccessibilityPane();
    return status();
  }

  const stopDemo = (): void => {
    demoTimer?.cancel();
    demoTimer = null;
    send({ op: "demo_stop" });
  };

  async function tryDemo(): Promise<void> {
    if (!proc) throw new FlintError("invalid", "Autofill isn't running. Turn it on first.");
    if (trusted !== true) throw new FlintError("permission", "Allow Accessibility for Flint first.");
    const showDemo = (field: ScreenRect): void => send({ op: "demo", field, code: DEMO_CODE, service: "Flint" });
    // The sample suggestion follows the sample window when it is dragged.
    const field = await deps.openDemoField(stopDemo, showDemo);
    showDemo(field);
    demoTimer?.cancel();
    demoTimer = setTimer(stopDemo, DEMO_MAX_MS);
  }

  return {
    status,
    requestPermission,
    tryDemo,
    attach(svc) {
      if (service || stopped) return;
      service = svc;
      unsubscribe = svc.subscribe((ev) => {
        if (ev.type === "settings") applySettings(ev.settings);
        else if (ev.type === "code" && on()) void refreshCodes();
      });
      void svc.getSettings().then(applySettings, () => log("could not read settings"));
    },
    stop() {
      stopPromise ??= (async () => {
        stopped = true;
        unsubscribe?.();
        unsubscribe = null;
        expiryTimer?.cancel();
        demoTimer?.cancel();
        waiting = [];
        syncShortcut();
        await shutdownHelper();
      })();
      return stopPromise;
    },
  };
}
