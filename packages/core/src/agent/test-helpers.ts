import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLINT_METHODS, type FlintApi } from "../api";
import { FlintError, type FlintEvent, type Settings } from "../types";
import type { ActivityEntry } from "./server";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fl-"));
}

export function settings(agents: Partial<Settings["agents"]> = {}): Settings {
  return { agents: { enabled: true, modify: "allow", send: "ask", ...agents } } as Settings;
}

export type FakeApi = FlintApi & { emit(e: FlintEvent): void; calls: { method: string; params: unknown[] }[]; listeners: number };

export function fakeApi(overrides: Partial<Record<string, (...a: unknown[]) => unknown>> = {}): FakeApi {
  const listeners = new Set<(e: FlintEvent) => void>();
  const calls: { method: string; params: unknown[] }[] = [];
  const base: Record<string, unknown> = {};
  for (const m of FLINT_METHODS) {
    base[m] = async (...params: unknown[]) => {
      calls.push({ method: m, params });
      const o = overrides[m];
      if (o) return o(...params);
      return undefined;
    };
  }
  base.subscribe = (l: (e: FlintEvent) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  base.emit = (e: FlintEvent) => listeners.forEach((l) => l(e));
  base.calls = calls;
  Object.defineProperty(base, "listeners", { get: () => listeners.size });
  return base as unknown as FakeApi;
}

export function activityLog(): { entries: ActivityEntry[]; log: (e: ActivityEntry) => void } {
  const entries: ActivityEntry[] = [];
  return { entries, log: (e) => void entries.push(e) };
}

export function rawRequest(socketPath: string, method: string, path: string, opts: { token?: string; body?: string } = {}): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const req = request({ socketPath, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export { FlintError };
