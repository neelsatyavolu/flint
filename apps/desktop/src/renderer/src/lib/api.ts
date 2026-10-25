import { FLINT_METHODS } from "@flint/core/api";
import { FlintError } from "@flint/core/types";
import type { FlintApi } from "@flint/core";

type Win = { flint?: FlintApi };

/**
 * Wraps an async loader as a FlintApi. Used for the mock so Electron builds only fetch the mock
 * chunk if window.flint is missing. subscribe() is synchronous, so it defers until the API loads.
 */
export function createLazyApi(load: () => Promise<FlintApi>): FlintApi {
  let loaded: Promise<FlintApi> | null = null;
  const get = () => (loaded ??= load());
  const target: Record<string, unknown> = {};
  for (const method of FLINT_METHODS) {
    target[method] = (...args: unknown[]) =>
      get().then((api) => (api[method] as (...a: unknown[]) => unknown)(...args));
  }
  target.subscribe = (listener: Parameters<FlintApi["subscribe"]>[0]) => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void get().then((api) => {
      if (!cancelled) off = api.subscribe(listener);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  };
  return target as unknown as FlintApi;
}

type Wire = { name?: unknown; code?: unknown; message?: unknown };
const CODES: ReadonlySet<string> = new Set(["not_found", "invalid", "auth", "network", "permission", "conflict", "ai_not_connected", "internal"]);

/** The preload rejects with a plain { name: 'FlintError', code, message } object (Error subclasses lose their code over the bridge). */
export function toFlintError(err: unknown): unknown {
  if (err instanceof FlintError || typeof err !== "object" || err === null) return err;
  const w = err as Wire;
  if (w.name !== "FlintError" || typeof w.message !== "string") return err;
  return new FlintError((typeof w.code === "string" && CODES.has(w.code) ? w.code : "internal") as FlintError["code"], w.message);
}

/** Wraps the bridge so every rejection is a real FlintError with its code. */
export function wrapBridge(real: FlintApi): FlintApi {
  const wrapped: Record<string, unknown> = {};
  for (const method of FLINT_METHODS) {
    wrapped[method] = async (...args: unknown[]) => {
      try {
        return await (real[method] as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        throw toFlintError(err);
      }
    };
  }
  wrapped.subscribe = real.subscribe.bind(real);
  return wrapped as unknown as FlintApi;
}

/** `?latency=<ms>` in the browser preview simulates the real app's round trips. */
export function previewLatency(search: string = typeof window === "undefined" ? "" : window.location.search): number {
  const n = Number(new URLSearchParams(search).get("latency"));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 0;
}

function pick(): FlintApi {
  const real = typeof window === "undefined" ? undefined : (window as unknown as Win).flint;
  if (real) return wrapBridge(real);
  const latency = previewLatency();
  return createLazyApi(async () => (await import("../mock")).createMockApi(latency > 0 ? { latencyMs: latency } : {}));
}

/** The API every renderer module uses: window.flint in Electron, the in-memory mock in a browser or tests. */
export const flint: FlintApi = pick();
