import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { SHOTS, type Launched } from "./app.mts";

export type Config = { theme: "dark" | "light"; w: number; h: number };
export const CONFIGS: Config[] = [
  { theme: "dark", w: 1440, h: 900 },
  { theme: "light", w: 1440, h: 900 },
  { theme: "dark", w: 1100, h: 760 },
  { theme: "light", w: 1100, h: 760 },
];

export const results: { name: string; ok: boolean; note?: string }[] = [];

export let themeProbe: (() => Promise<string>) | null = null;
export function setThemeProbe(fn: () => Promise<string>): void {
  themeProbe = fn;
}

export async function step(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || undefined });
    console.log(`PASS ${name}${note ? `: ${note}` : ""}${themeProbe ? ` [theme ${await themeProbe()}]` : ""}`);
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0] ?? String(err);
    results.push({ name, ok: false, note: msg });
    console.log(`FAIL ${name}: ${msg}`);
  }
}

export class Shooter {
  dir = "";
  private l: Launched;
  constructor(l: Launched) {
    this.l = l;
  }
  use(c: Config): void {
    this.dir = join(SHOTS, `${c.theme}-${c.w}x${c.h}`);
    mkdirSync(this.dir, { recursive: true });
  }
  async shot(name: string): Promise<void> {
    await this.l.win.waitForTimeout(250);
    await this.l.win.screenshot({ path: join(this.dir, `${name}.png`) });
  }
}

export const sidebar = (win: Page) => win.locator('nav[aria-label="Mailboxes"]');

export async function goTo(win: Page, label: string): Promise<void> {
  await sidebar(win).getByText(label, { exact: true }).first().click();
  await win.waitForTimeout(300);
}

export async function openThreadBySubject(win: Page, subject: string | RegExp): Promise<void> {
  const row = win.locator('[role="option"]', { hasText: subject }).first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await row.click();
  await win.waitForTimeout(500);
}

export async function waitForRows(win: Page, min = 1): Promise<void> {
  await win.waitForFunction((n) => document.querySelectorAll('[role="option"]').length >= n, min, { timeout: 20_000 });
}

export async function openSettingsSection(win: Page, label: string): Promise<void> {
  const nav = win.getByRole("navigation", { name: "Settings sections" });
  if (!(await nav.isVisible().catch(() => false))) await sidebar(win).getByText("Settings", { exact: true }).click();
  await nav.waitFor({ state: "visible" });
  await nav.getByRole("button", { name: label, exact: true }).click();
  await win.waitForTimeout(300);
}

export async function closeSettings(win: Page): Promise<void> {
  if (await win.getByRole("navigation", { name: "Settings sections" }).isVisible().catch(() => false)) {
    await win.keyboard.press("Escape");
    await win.waitForTimeout(200);
  }
}
