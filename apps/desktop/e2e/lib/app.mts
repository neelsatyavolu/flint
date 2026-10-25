import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DESKTOP = new URL("../../", import.meta.url).pathname;
export const SHOTS = join(DESKTOP, ".artifacts/e2e");

export type Launched = { app: ElectronApplication; win: Page; dataDir: string; logs: string[]; close(): Promise<void> };

export type LaunchOptions = { dataDir?: string; args?: string[]; env?: Record<string, string>; executablePath?: string };

/** Launches the built app against a private data dir (never the user's real one). */
export async function launch(opts: LaunchOptions = {}): Promise<Launched> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "flint-e2e-"));
  mkdirSync(SHOTS, { recursive: true });
  const logs: string[] = [];
  const app = await electron.launch({
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    args: opts.args ?? ["."],
    cwd: DESKTOP,
    env: { ...process.env, FLINT_DATA_DIR: dataDir, ...opts.env } as Record<string, string>,
  });
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  const win = await app.firstWindow();
  win.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") logs.push(`[console.${m.type()}] ${m.text()}`);
  });
  win.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await win.waitForLoadState("domcontentloaded");
  return {
    app, win, dataDir, logs,
    async close() {
      await app.close().catch(() => undefined);
    },
  };
}

export async function setSize(l: Launched, width: number, height: number): Promise<void> {
  await l.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setContentSize(w!, h!);
  }, [width, height]);
  await l.win.waitForTimeout(250);
}

export async function setTheme(l: Launched, theme: "dark" | "light"): Promise<void> {
  await l.win.evaluate((t) => window.flint.updateSettings({ appearance: { theme: t } }), theme);
  await l.win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
  await l.win.waitForTimeout(150);
}

export function cleanup(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
