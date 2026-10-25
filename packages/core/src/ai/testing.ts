// Shared helpers for ai tests: fake SSE responses and an in-memory AiContext.
import { memorySecrets } from "../platform";
import type { Settings } from "../types";
import type { AiContext } from "./ports";

export function sseResponse(events: object[], status = 200): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

export const textEvents = (...parts: string[]): object[] => [
  ...parts.map((delta) => ({ type: "response.output_text.delta", delta })),
  { type: "response.completed", response: {} },
];

export function baseSettings(ai: Partial<Settings["ai"]> = {}): Settings {
  return {
    ai: { enabled: true, provider: null, model: null, autoSummarize: true, smartReplies: true, autoCategorize: true, writingStyle: "", replyLanguage: "", ...ai },
  } as Settings;
}

export function makeContext(over: Partial<AiContext> = {}): AiContext & { cache: Map<string, string> } {
  const cache = new Map<string, string>();
  return {
    getSettings: () => baseSettings(),
    secrets: memorySecrets(),
    getThreadForAi: async () => null,
    searchForAi: async () => [],
    cacheGet: (k) => cache.get(k) ?? null,
    cacheSet: (k, v) => { cache.set(k, v); },
    now: () => 1_700_000_000_000,
    cache,
    ...over,
  };
}

export const jwt = (claims: object): string =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

export type FakeRoutes = {
  token?: (body: URLSearchParams) => Response | Promise<Response>;
  responses?: (url: string, init: RequestInit) => Response | Promise<Response>;
};

/** A fetch that serves the OAuth token endpoints, the responses endpoints and an unreachable model catalog. */
export function fakeFetch(routes: FakeRoutes): typeof fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (/\/oauth2?\/token$/.test(url)) {
      const body = new URLSearchParams(String(init.body ?? ""));
      return routes.token ? routes.token(body) : tokenResponse();
    }
    if (/\/responses$/.test(url) && routes.responses) return routes.responses(url, init);
    return new Response("", { status: 404 });
  }) as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}

export function tokenResponse(over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, id_token: jwt({ sub: "acct-1" }), ...over }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
