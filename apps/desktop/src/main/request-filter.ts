import { isTrackerHost } from "./trackers";

export type FilterState = { receiptsHost: string | null; blockTrackers: boolean };

/** Host of the receipts endpoint, or null when it is empty or not a URL. */
export function receiptsHostFromEndpoint(endpoint: string): string | null {
  if (!endpoint.trim()) return null;
  try {
    const host = new URL(endpoint.trim()).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Decides which renderer requests are cancelled. The receipts host is always
 * blocked (SPEC section 6, principle 3); known tracker hosts only when enabled.
 */
export function createRequestFilter(initial: FilterState = { receiptsHost: null, blockTrackers: true }) {
  let state: FilterState = initial;
  return {
    update(next: Partial<FilterState>): void {
      state = { ...state, ...next };
    },
    shouldBlock(url: string): boolean {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return false;
      }
      if (state.receiptsHost && host === state.receiptsHost) return true;
      return state.blockTrackers && isTrackerHost(host);
    },
  };
}

export type RequestFilter = ReturnType<typeof createRequestFilter>;
