import { logger } from "@flint/core/log";

/** The part of electron-updater's AppUpdater that Flint uses (injected so the flow is testable). */
export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: "update-available" | "update-not-available" | "update-downloaded" | "error", cb: (arg: never) => void): unknown;
};

/** Shows a native message box and resolves with the index of the button pressed. */
export type Ask = (box: { message: string; detail: string; buttons: string[] }) => Promise<number>;

export type UpdateController = {
  /** Starts the launch check and the periodic background checks. */
  start(): void;
  /** Checks now. A user-initiated check reports every outcome; a background one speaks only when an update is ready. */
  check(userInitiated: boolean): void;
  /** Call after settings.updates.mode changes: switching to "restart" with an update already downloaded restarts now. */
  modeChanged(): void;
  stop(): void;
};

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

const describe = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(raw)) return "Flint couldn't reach GitHub. Check your connection and try again.";
  return raw.split("\n")[0]!.slice(0, 200);
};

export type UpdateMode = "restart" | "auto" | "ask" | "manual";

/**
 * Sparkle-style updates from GitHub Releases. Background checks run on launch and every few hours unless the mode is
 * "manual". A download then either offers a restart ("ask"; "Later" installs on the next quit) or, in "auto", installs
 * on the next quit without asking and only announces it. In "restart", a downloaded update quits and relaunches Flint
 * straight away, even mid-session (drafts are flushed first). Outside "restart", a check the user starts from the menu
 * always offers a restart.
 */
export function createUpdateController(deps: {
  updater: UpdaterLike;
  ask: Ask;
  currentVersion: string;
  /** Runs before Restart Now hands over to the installer (the app stops its service so nothing blocks the quit). */
  beforeInstall?: () => Promise<void>;
  /** settings.updates.mode, read at each decision so a change applies without a restart. */
  getMode?: () => UpdateMode;
  /** A quiet notice for "auto" mode that the update installs on the next quit. */
  announce?: (version: string) => void;
  /** A notice for "restart" mode, shown just before Flint quits to install. */
  restarting?: (version: string) => void;
}): UpdateController {
  const { updater, ask, currentVersion, beforeInstall, announce, restarting } = deps;
  const mode = (): UpdateMode => deps.getMode?.() ?? "ask";
  const log = logger("updates");
  let reportNext = false;
  /** The current download was started by a menu check, so it offers a restart whatever the mode. */
  let userCycle = false;
  let checking = false;
  let readyVersion: string | null = null;
  let installing = false;
  let timers: ReturnType<typeof setTimeout>[] = [];

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  const offerRestart = async (version: string): Promise<void> => {
    const choice = await ask({
      message: `Flint ${version} is ready to install`,
      detail: `You have ${currentVersion}. Restart Flint to finish updating, or choose Later and it installs the next time you quit.`,
      buttons: ["Restart Now", "Later"],
    });
    if (choice !== 0) return;
    await install();
  };

  const install = async (): Promise<void> => {
    if (installing) return;
    installing = true;
    try {
      await beforeInstall?.();
    } catch (err) {
      log.warn("preparing to install failed", { message: describe(err) });
    }
    updater.quitAndInstall();
  };

  const restartNow = async (version: string): Promise<void> => {
    if (installing) return;
    log.info("restarting to install", { version });
    restarting?.(version);
    await install();
  };

  updater.on("update-available", ((info: { version: string }) => {
    log.info("update available", { version: info.version });
    if (!reportNext) return;
    reportNext = false;
    void ask({ message: `Downloading Flint ${info.version}`, detail: "It downloads in the background. Flint will ask you to restart when it's ready.", buttons: ["OK"] });
  }) as (arg: never) => void);

  updater.on("update-not-available", (() => {
    if (!reportNext) return;
    reportNext = false;
    void ask({ message: "You're up to date", detail: `Flint ${currentVersion} is the newest version.`, buttons: ["OK"] });
  }) as (arg: never) => void);

  updater.on("update-downloaded", ((info: { version: string }) => {
    log.info("update downloaded", { version: info.version });
    readyVersion = info.version;
    reportNext = false;
    const asked = userCycle;
    userCycle = false;
    if (mode() === "restart") void restartNow(info.version);
    else if (mode() === "auto" && !asked) announce?.(info.version);
    else void offerRestart(info.version);
  }) as (arg: never) => void);

  updater.on("error", ((err: unknown) => {
    log.warn("update failed", { message: describe(err) });
    if (!reportNext) return;
    reportNext = false;
    void ask({ message: "Couldn't check for updates", detail: describe(err), buttons: ["OK"] });
  }) as (arg: never) => void);

  const check = (userInitiated: boolean): void => {
    if (userInitiated && readyVersion) {
      if (mode() === "restart") void restartNow(readyVersion);
      else void offerRestart(readyVersion);
      return;
    }
    if (userInitiated) {
      reportNext = true;
      userCycle = true;
    } else if (mode() === "manual") {
      return;
    }
    if (checking) return;
    checking = true;
    // Failures also arrive as an "error" event, which reports them.
    updater
      .checkForUpdates()
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  };

  return {
    start() {
      timers = [setTimeout(() => check(false), FIRST_CHECK_MS), setInterval(() => check(false), CHECK_EVERY_MS)];
    },
    check,
    modeChanged() {
      if (mode() === "restart" && readyVersion) void restartNow(readyVersion);
    },
    stop() {
      for (const t of timers) clearTimeout(t);
      timers = [];
    },
  };
}
