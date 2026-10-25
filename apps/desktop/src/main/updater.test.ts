import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUpdateController, type UpdaterLike } from "./updater";

function fakeUpdater(result: () => Promise<unknown> = async () => null) {
  const events = new EventEmitter();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(result),
    quitAndInstall: vi.fn(),
    on: (e: string, cb: (arg: never) => void) => events.on(e, cb as (...args: unknown[]) => void),
  } satisfies UpdaterLike;
  return { updater, emit: (e: string, arg?: unknown) => events.emit(e, arg) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createUpdateController", () => {
  it("downloads automatically and installs on quit", () => {
    const { updater } = fakeUpdater();
    createUpdateController({ updater, ask: vi.fn(), currentVersion: "0.1.0" });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it("stays quiet on a background check with no update", async () => {
    const { updater, emit } = fakeUpdater();
    const ask = vi.fn(async () => 0);
    const c = createUpdateController({ updater, ask, currentVersion: "0.1.0" });
    c.check(false);
    emit("update-not-available");
    emit("error", new Error("getaddrinfo ENOTFOUND api.github.com"));
    await flush();
    expect(ask).not.toHaveBeenCalled();
  });

  it("tells the user they're up to date after a menu check", async () => {
    const { updater, emit } = fakeUpdater();
    const ask = vi.fn(async () => 0);
    const c = createUpdateController({ updater, ask, currentVersion: "0.1.0" });
    c.check(true);
    emit("update-not-available");
    await flush();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ message: "You're up to date", detail: "Flint 0.1.0 is the newest version." }));
  });

  it("offers a restart once the update is downloaded, and installs on Restart Now", async () => {
    const { updater, emit } = fakeUpdater();
    const ask = vi.fn(async () => 0);
    createUpdateController({ updater, ask, currentVersion: "0.1.0" });
    emit("update-downloaded", { version: "0.2.0" });
    await flush();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ message: "Flint 0.2.0 is ready to install", buttons: ["Restart Now", "Later"] }));
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("lets the app shut down before handing over to the installer", async () => {
    const { updater, emit } = fakeUpdater();
    const order: string[] = [];
    updater.quitAndInstall.mockImplementation(() => { order.push("install"); });
    createUpdateController({ updater, ask: async () => 0, currentVersion: "0.1.0", beforeInstall: async () => { order.push("stop"); } });
    emit("update-downloaded", { version: "0.2.0" });
    await flush(); await flush();
    expect(order).toEqual(["stop", "install"]);
  });

  it("leaves the update for the next quit on Later, and offers it again from the menu", async () => {
    const { updater, emit } = fakeUpdater();
    const ask = vi.fn(async () => 1);
    const c = createUpdateController({ updater, ask, currentVersion: "0.1.0" });
    emit("update-downloaded", { version: "0.2.0" });
    await flush();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    c.check(true);
    await flush();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("explains a failed menu check in plain words", async () => {
    const { updater, emit } = fakeUpdater();
    const ask = vi.fn(async () => 0);
    const c = createUpdateController({ updater, ask, currentVersion: "0.1.0" });
    c.check(true);
    emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
    await flush();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ message: "Couldn't check for updates", detail: "Flint couldn't reach GitHub. Check your connection and try again." }));
  });

  it("does not start a second check while one is running", async () => {
    let finish!: () => void;
    const { updater } = fakeUpdater(() => new Promise<void>((r) => (finish = r)));
    const c = createUpdateController({ updater, ask: vi.fn(), currentVersion: "0.1.0" });
    c.check(false);
    c.check(true);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    finish();
    await flush();
    c.check(false);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
