import type { Deps } from "./program";
import type { CliClient } from "./ctx";
import { run } from "./run";
import type { FlintEvent } from "@flint/core/types";

export type Fake = { client: CliClient; calls: { method: string; params: unknown[] }[] };

export function fakeClient(results: Record<string, unknown> = {}, events: FlintEvent[] = []): Fake {
  const calls: { method: string; params: unknown[] }[] = [];
  const target: Record<string, unknown> = { events: async function* () { for (const e of events) yield e; } };
  const client = new Proxy(target, {
    get(t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in t) return t[prop];
      return async (...params: unknown[]) => {
        calls.push({ method: prop, params });
        const r = results[prop];
        return typeof r === "function" ? (r as (...a: unknown[]) => unknown)(...params) : r;
      };
    },
  }) as unknown as CliClient;
  return { client, calls };
}

export const NOW = new Date(2026, 9, 25, 10, 0); // Sunday 2026-10-25 10:00 local

export async function exec(argv: string[], fake: Fake, over: Partial<Deps> = {}) {
  let out = "";
  let err = "";
  const agents: string[] = [];
  const code = await run(argv, {
    connect: (a) => { agents.push(a); return fake.client; },
    stdout: (t) => { out += t; }, stderr: (t) => { err += t; },
    isTTY: false, columns: 100, now: () => NOW, env: {}, readFile: async () => "file body",
    ...over,
  });
  return { code, out, err, agents };
}
