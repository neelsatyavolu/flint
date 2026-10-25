import { handle } from "../index";
import type { Env } from "../env";
import { createFakeD1 } from "./fakeD1";
import type { CfProps } from "../request";

export const SALT = "test-salt";
export const T0 = 1_800_000_000_000;

export function setup() {
  const { d1, raw } = createFakeD1();
  const env: Env = { DB: d1, FINGERPRINT_SALT: SALT };
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
  async function call(path: string, init: RequestInit & { ip?: string; cf?: CfProps; now?: number; auth?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.ip) headers.set("CF-Connecting-IP", init.ip);
    if (init.auth) headers.set("Authorization", `Bearer ${init.auth}`);
    const req = new Request(`https://r.test${path}`, { ...init, headers });
    if (init.cf) Object.defineProperty(req, "cf", { value: init.cf });
    const res = await handle(req, env, ctx, init.now ?? T0);
    await Promise.all(waits.splice(0));
    return res;
  }
  return { env, raw, call };
}

export async function install(call: ReturnType<typeof setup>["call"], ip = "198.51.100.1"): Promise<string> {
  const res = await call("/v1/install", { method: "POST", ip });
  const b = (await res.json()) as { installId: string; secret: string };
  return `${b.installId}.${b.secret}`;
}

export const TOKEN_A = "AAAAAAAAAAAAAAAAAAAAAA";
export const TOKEN_B = "BBBBBBBBBBBBBBBBBBBBBB";
