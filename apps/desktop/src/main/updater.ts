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
  stop(): void;
};

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const describe = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(raw)) return "Flint couldn't reach GitHub. Check your connection and try again.";
  return raw.split("\n")[0]!.slice(0, 200);
};

/**
 * Sparkle-style updates from GitHub Releases: check on launch and every few hours, download in the
 * background, then offer to restart. "Later" installs the update the next time Flint quits.
 */
export function createUpdateController(deps: { updater: UpdaterLike; ask: Ask; currentVersion: string }): UpdateController {
  const { updater, ask, currentVersion } = deps;
  const log = logger("updates");
  let reportNext = false;
  let checking = false;
  let readyVersion: string | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  const offerRestart = async (version: string): Promise<void> => {
    const choice = await ask({
      message: `Flint ${version} is ready to install`,
      detail: `You have ${currentVersion}. Restart Flint to finish updating, or choose Later and it installs the next time you quit.`,
      buttons: ["Restart Now", "Later"],
    });
    if (choice === 0) updater.quitAndInstall();
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
    void offerRestart(info.version);
  }) as (arg: never) => void);

  updater.on("error", ((err: unknown) => {
    log.warn("update failed", { message: describe(err) });
    if (!reportNext) return;
    reportNext = false;
    void ask({ message: "Couldn't check for updates", detail: describe(err), buttons: ["OK"] });
  }) as (arg: never) => void);

  const check = (userInitiated: boolean): void => {
    if (userInitiated && readyVersion) {
      void offerRestart(readyVersion);
      return;
    }
    if (userInitiated) reportNext = true;
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
    stop() {
      for (const t of timers) clearTimeout(t);
      timers = [];
    },
  };
}
