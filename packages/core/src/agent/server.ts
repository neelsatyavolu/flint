import { timingSafeEqual } from "node:crypto";
import { chmodSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { FLINT_METHODS, METHOD_TIERS, type FlintApi, type FlintMethod } from "../api";
import { logger } from "../log";
import { FlintError, type AgentActivity, type Draft, type FlintEvent, type Settings } from "../types";
import { runAsAgent } from "./context";
import { redactParams } from "./redact";
import { summarize, summarizeFailure } from "./summarize";
import { ensureToken } from "./token";

const log = logger("agent");

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEPALIVE_MS = 15_000;
const METHOD_SET: ReadonlySet<string> = new Set(FLINT_METHODS);
const MAX_TRACKED_RUNS = 1000;

export type ActivityEntry = Omit<AgentActivity, "id" | "at">;

export type AgentServerOptions = {
  api: FlintApi;
  socketPath: string;
  tokenPath: string;
  getSettings: () => Settings | Promise<Settings>;
  /** Called once per call (reads included). The host stores the row and emits an `agent_activity` event. */
  logActivity: (entry: ActivityEntry) => void | Promise<void>;
  /** Optional notification when an event stream opens or closes. */
  onEventSubscribe?: (info: { agent: string; open: boolean }) => void;
  /**
   * Runs `fn` with the caller identified as `agent`. The service reads the caller
   * back so it can mark drafts and queued sends as created by that agent and turn
   * `settings.agents.send = 'ask'` into `awaiting_approval`.
   * Default: `runAsAgent` from ./context (AsyncLocalStorage); the service calls `currentAgent()`.
   */
  callAs?: <T>(agent: string, fn: () => Promise<T>) => Promise<T>;
  /** SSE keepalive comment interval. Default 15s. */
  keepaliveMs?: number;
};

export type AgentServerHandle = {
  socketPath: string;
  token: string;
  close(): Promise<void>;
};

const callBody = z.object({
  method: z.string().min(1),
  params: z.array(z.unknown()).default([]),
  agent: z.string().max(64).optional(),
});

const STATUS: Record<FlintError["code"], number> = {
  not_found: 404, invalid: 400, auth: 401, network: 502, permission: 403,
  conflict: 409, ai_not_connected: 412, internal: 500,
};

function isFlintError(e: unknown): e is FlintError {
  if (e instanceof FlintError) return true;
  return e instanceof Error && e.name === "FlintError" && typeof (e as { code?: unknown }).code === "string";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function fail(res: ServerResponse, code: FlintError["code"], message: string, status = STATUS[code]): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function agentName(raw: string | null | undefined): string {
  const t = raw?.trim();
  return t ? t.slice(0, 64) : "agent";
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m?.[1]) return false;
  const given = Buffer.from(m[1]);
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

type Gate = { ok: true } | { ok: false; message: string };

function gate(tier: (typeof METHOD_TIERS)[FlintMethod], settings: Settings, method?: FlintMethod): Gate {
  const a = settings.agents;
  if (!a.enabled) return { ok: false, message: "Agent access is off. Turn it on in Settings, Agents." };
  if (tier === "admin") return { ok: false, message: "Agents can't do this. It's only available in the Flint app." };
  if (tier === "modify" && a.modify === "deny") {
    return { ok: false, message: "Agents can only read mail right now. Allow changes in Settings, Agents." };
  }
  if (tier === "send" && a.send === "deny") {
    return { ok: false, message: "Agents can't send mail right now. Allow sending in Settings, Agents." };
  }
  // unsubscribe can send mail straight from the account (mailto), and only sendDraft knows how to wait for approval.
  if (method === "unsubscribe" && a.send === "ask") {
    return { ok: false, message: "Agents can't unsubscribe while sending needs your approval. Unsubscribe in the Flint app, or allow sending in Settings, Agents." };
  }
  return { ok: true };
}

export async function startAgentServer(opts: AgentServerOptions): Promise<AgentServerHandle> {
  const { api, socketPath, getSettings, logActivity } = opts;
  const callAs = opts.callAs ?? runAsAgent;
  const keepaliveMs = opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
  const token = ensureToken(opts.tokenPath);
  const aiRuns = new Set<string>();
  const streams = new Set<ServerResponse>();

  const record = async (entry: ActivityEntry): Promise<void> => {
    try {
      await logActivity(entry);
    } catch (e) {
      log.error("could not record agent activity", { error: e instanceof Error ? e.message : String(e) });
    }
  };

  async function handleCall(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (e) {
      if (e instanceof BodyTooLarge) return fail(res, "invalid", "The request is larger than 10 MB.", 413);
      return fail(res, "invalid", "Couldn't read the request.");
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(res, "invalid", "The request body isn't valid JSON.");
    }
    const parsed = callBody.safeParse(json);
    if (!parsed.success) return fail(res, "invalid", "Expected {method, params, agent?}.");
    const { method, params } = parsed.data;
    const agent = agentName(parsed.data.agent);
    if (!METHOD_SET.has(method)) return fail(res, "invalid", `Unknown method "${method.slice(0, 60)}".`);
    const m = method as FlintMethod;

    const settings = await getSettings();
    const allowed = gate(METHOD_TIERS[m], settings, m);
    if (!allowed.ok) {
      if (settings.agents.enabled) {
        await record({ agent, method: m, summary: `Blocked: ${summarize(m, params, undefined)}`, status: "denied", detail: { params: redactParams(params) } });
      }
      return fail(res, "permission", allowed.message);
    }

    let draft: Draft | undefined;
    if (m === "sendDraft" && typeof params[0] === "number") {
      try { draft = await api.getDraft(params[0]); } catch { /* the call itself reports a missing draft */ }
    }

    try {
      const fn = api[m] as (...a: unknown[]) => Promise<unknown>;
      const result = (await callAs(agent, () => fn.apply(api, params))) ?? null;
      if ((m === "aiRun") && typeof result === "object" && result !== null && "runId" in result) {
        aiRuns.add(String((result as { runId: unknown }).runId));
        if (aiRuns.size > MAX_TRACKED_RUNS) aiRuns.delete(aiRuns.values().next().value as string);
      }
      const awaiting = typeof result === "object" && result !== null && (result as { status?: unknown }).status === "awaiting_approval";
      await record({
        agent, method: m,
        summary: summarize(m, params, result, { draft }),
        status: awaiting ? "awaiting_approval" : "ok",
        detail: {
          params: redactParams(params),
          ...(awaiting && typeof (result as { scheduledId?: unknown }).scheduledId === "number"
            ? { scheduledId: (result as { scheduledId: number }).scheduledId } : {}),
        },
      });
      sendJson(res, 200, { ok: true, result });
    } catch (e) {
      const known = isFlintError(e);
      const code = known ? e.code : "internal";
      const message = known ? e.message : "Something went wrong inside Flint. Try again.";
      if (!known) log.error("agent call failed", { method: m, error: e instanceof Error ? e.message : String(e) });
      await record({ agent, method: m, summary: summarizeFailure(m, message), status: "error", detail: { params: redactParams(params), code } });
      fail(res, code, message);
    }
  }

  function allowEvent(event: FlintEvent): boolean {
    if (event.type === "settings") return false; // settings carry the Google client secret
    if (event.type === "ai") return aiRuns.has(event.chunk.runId);
    return true;
  }

  async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const settings = await getSettings();
    const allowed = gate("read", settings);
    if (!allowed.ok) return fail(res, "permission", allowed.message);
    const url = new URL(req.url ?? "/", "http://flint.local");
    const agent = agentName(url.searchParams.get("agent"));
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    streams.add(res);
    opts.onEventSubscribe?.({ agent, open: true });
    let closed = false;
    // Re-check access per event so turning agents off ends open streams; the chain keeps events in order.
    let pending: Promise<void> = Promise.resolve();
    const unsubscribe = api.subscribe((event) => {
      const disabled = event.type === "settings" && !event.settings.agents.enabled;
      if (!disabled && !allowEvent(event)) return;
      pending = pending.then(async () => {
        if (closed) return;
        let stillAllowed = !disabled;
        if (stillAllowed) {
          try { stillAllowed = gate("read", await getSettings()).ok; } catch { stillAllowed = false; }
        }
        if (!stillAllowed) {
          res.end();
          cleanup();
          return;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    });
    const timer = setInterval(() => res.write(": keepalive\n\n"), keepaliveMs);
    timer.unref();
    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
      streams.delete(res);
      opts.onEventSubscribe?.({ agent, open: false });
    }
    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const route = async () => {
      if (!authorized(req, token)) return fail(res, "auth", "Missing or wrong token. Reopen Flint and try again.");
      if (req.method === "POST" && path === "/v1/call") return handleCall(req, res);
      if (req.method === "GET" && path === "/v1/events") return handleEvents(req, res);
      return fail(res, "not_found", "No such endpoint.");
    };
    route().catch((e: unknown) => {
      log.error("agent request failed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) fail(res, "internal", "Something went wrong inside Flint. Try again.");
      else res.end();
    });
  });

  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);
  log.info("agent server listening");

  return {
    socketPath,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of streams) s.end();
        server.close(() => {
          rmSync(socketPath, { force: true });
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
