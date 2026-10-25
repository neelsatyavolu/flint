import { FLINT_METHODS } from "@flint/core/api";
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

function pick(): FlintApi {
  const real = typeof window === "undefined" ? undefined : (window as unknown as Win).flint;
  if (real) return real;
  return createLazyApi(async () => (await import("../mock")).createMockApi());
}

/** The API every renderer module uses: window.flint in Electron, the in-memory mock in a browser or tests. */
export const flint: FlintApi = pick();
