import type { FlintApi } from "@flint/core/api";
import type { Address, FlintEvent } from "@flint/core/types";
import { FlintError } from "@flint/core/types";
import type { Style } from "./style";

export type CliClient = Omit<FlintApi, "subscribe"> & { events(): AsyncIterable<FlintEvent> };

export type Ctx = {
  client: CliClient;
  json: boolean;
  out(line: string): void;
  /** Notes for the person or agent that must not pollute stdout (JSON stays parseable). */
  warn(line: string): void;
  sleep(ms: number): Promise<void>;
  now: Date;
  style: Style;
  width: number;
  readFile(path: string): Promise<string>;
};

/** Prints JSON in --json mode, otherwise runs the human renderer. */
export function emit<T>(ctx: Ctx, data: T, human: (d: T) => string): void {
  ctx.out(ctx.json ? JSON.stringify(data, null, 2) : human(data));
}

export function parseId(raw: string, what = "thread id"): number {
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) throw new FlintError("invalid", `"${raw}" isn't a ${what}. Use a number from "flint list".`);
  return Number(raw);
}

export function parseIds(raw: string[], what?: string): number[] {
  return raw.map((r) => parseId(r, what));
}

export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 200) throw new FlintError("invalid", `--limit must be a number from 1 to 200.`);
  return Number(raw);
}

/** Collects repeated or comma-separated option values. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, ...value.split(",").map((s) => s.trim()).filter(Boolean)];
}

const ADDRESS = /^(?:(.*?)\s*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/;

export function parseAddresses(values: string[] | undefined): Address[] {
  return (values ?? []).map((v) => {
    const m = ADDRESS.exec(v.trim());
    if (!m) throw new FlintError("invalid", `"${v}" isn't an email address.`);
    return { name: (m[1] ?? "").replace(/^"|"$/g, ""), address: m[2] ?? m[3] ?? "" };
  });
}

export async function resolveAccountId(ctx: Ctx, email: string | undefined): Promise<string | undefined> {
  if (!email) return undefined;
  const accounts = await ctx.client.listAccounts();
  const hit = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase() || a.id === email);
  if (!hit) throw new FlintError("not_found", `No account for ${email}. Run "flint accounts" to see them.`);
  return hit.id;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
