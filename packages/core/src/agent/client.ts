import { readFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { z } from "zod";
import { FLINT_METHODS, type FlintApi, type FlintMethod } from "../api";
import { FlintError, type FlintEvent } from "../types";
import { agentPaths, defaultDataDir, NOT_RUNNING_MESSAGE } from "./paths";

/** Thrown when the socket or token file is missing or refuses connections. The CLI maps it to exit code 2. */
export class AppNotRunningError extends FlintError {
  constructor() {
    super("network", NOT_RUNNING_MESSAGE);
    this.name = "AppNotRunningError";
  }
}

export type ConnectOptions = {
  socketPath?: string;
  tokenPath?: string;
  dataDir?: string;
  /** Name recorded in Agent Activity. Default 'agent'. */
  agent?: string;
};

/** FlintApi minus `subscribe`, which becomes `events()`. */
export type AgentClient = Omit<FlintApi, "subscribe"> & {
  events(): AsyncGenerator<FlintEvent, void, void>;
};

const NOT_RUNNING_CODES = new Set(["ECONNREFUSED", "ENOENT", "ENOTDIR", "ENOTSOCK", "ECONNRESET", "EPIPE"]);
const ERROR_CODES = ["not_found", "invalid", "auth", "network", "permission", "conflict", "ai_not_connected", "internal"] as const;

const replySchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

function mapTransportError(e: unknown): FlintError {
  const code = (e as { code?: string } | null)?.code;
  if (code && NOT_RUNNING_CODES.has(code)) return new AppNotRunningError();
  if (e instanceof FlintError) return e;
  return new FlintError("network", "Couldn't talk to Flint. Open Flint, then try again.");
}

function toFlintError(code: string, message: string): FlintError {
  const known = (ERROR_CODES as readonly string[]).includes(code) ? (code as FlintError["code"]) : "internal";
  return new FlintError(known, message);
}

export function connectAgent(opts: ConnectOptions = {}): AgentClient {
  const dir = opts.dataDir ?? defaultDataDir();
  const defaults = agentPaths(dir);
  const socketPath = opts.socketPath ?? defaults.socketPath;
  const tokenPath = opts.tokenPath ?? defaults.tokenPath;
  const agent = opts.agent ?? "agent";

  const readToken = (): string => {
    try {
      return readFileSync(tokenPath, "utf8").trim();
    } catch {
      throw new AppNotRunningError();
    }
  };

  const send = (method: string, path: string, body?: string): Promise<IncomingMessage> =>
    new Promise<IncomingMessage>((resolve, reject) => {
      const headers: Record<string, string | number> = { authorization: `Bearer ${readToken()}` };
      if (body !== undefined) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(body);
      }
      const req = request({ socketPath, method, path, headers }, resolve);
      req.on("error", (e) => reject(mapTransportError(e)));
      if (body !== undefined) req.write(body);
      req.end();
    }).catch((e: unknown) => {
      throw mapTransportError(e);
    });

  async function call(method: string, params: unknown[]): Promise<unknown> {
    const res = await send("POST", "/v1/call", JSON.stringify({ method, params, agent }));
    const chunks: Buffer[] = [];
    try {
      for await (const c of res) chunks.push(c as Buffer);
    } catch (e) {
      throw mapTransportError(e);
    }
    let parsed: z.infer<typeof replySchema>;
    try {
      parsed = replySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new FlintError("internal", "Flint sent a reply the CLI couldn't read. Update the flint command and try again.");
    }
    if (!parsed.ok) throw toFlintError(parsed.error.code, parsed.error.message);
    return parsed.result;
  }

  async function* events(): AsyncGenerator<FlintEvent, void, void> {
    const res = await send("GET", `/v1/events?agent=${encodeURIComponent(agent)}`);
    if (res.statusCode !== 200) {
      const chunks: Buffer[] = [];
      for await (const c of res) chunks.push(c as Buffer);
      try {
        const parsed = replySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (!parsed.ok) throw toFlintError(parsed.error.code, parsed.error.message);
      } catch (e) {
        if (e instanceof FlintError) throw e;
      }
      throw new FlintError("internal", "Couldn't open the event stream.");
    }
    res.setEncoding("utf8");
    let buffer = "";
    try {
      for await (const chunk of res as AsyncIterable<string>) {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (data) yield JSON.parse(data) as FlintEvent;
        }
      }
    } catch (e) {
      if (e instanceof SyntaxError) throw new FlintError("internal", "Got an unreadable event from Flint.");
      throw mapTransportError(e);
    } finally {
      res.destroy();
    }
  }

  const methods = new Set<string>(FLINT_METHODS satisfies FlintMethod[]);
  const target: Record<string, unknown> = { events };
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in t) return t[prop];
      if (!methods.has(prop)) return undefined;
      return (...params: unknown[]) => call(prop, params);
    },
  }) as unknown as AgentClient;
}
