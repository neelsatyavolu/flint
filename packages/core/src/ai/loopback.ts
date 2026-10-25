import { createServer, type Server } from "node:http";
import { logger } from "../log";

const log = logger("ai-loopback");

export type LoopbackResult = { ok: boolean; /** Unrelated or stale request: answer it but keep listening. */ ignore?: boolean };
export type LoopbackOptions = {
  port: number;
  path: string;
  ttlMs: number;
  handle: (url: URL) => Promise<LoopbackResult>;
  onClose?: () => void;
};
export type LoopbackHandle = { port: number; close(): void };
/** Returns null when the port cannot be bound (the user can still paste the URL). */
export type LoopbackStarter = (opts: LoopbackOptions) => Promise<LoopbackHandle | null>;

const page = (message: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Flint</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
  `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#16140f;color:#e8e4da;font:15px/1.5 system-ui,sans-serif">` +
  `<p>${message}</p></body></html>`;

export const CONNECTED_PAGE = page("Flint is connected. You can close this tab.");
export const FAILED_PAGE = page("Flint couldn't connect. Close this tab and try again from Settings → +AI.");

export const startLoopback: LoopbackStarter = (opts) =>
  new Promise((resolve) => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const server: Server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
        if (url.pathname !== opts.path || req.method !== "GET") {
          res.writeHead(404, headers).end(page("Not found."));
          return;
        }
        let result: LoopbackResult = { ok: false };
        try {
          result = await opts.handle(url);
        } catch (err) {
          log.warn("callback handler failed", { error: err instanceof Error ? err.message : String(err) });
        }
        res.writeHead(result.ok ? 200 : 400, headers).end(result.ok ? CONNECTED_PAGE : FAILED_PAGE, () => {
          if (!result.ignore) close();
        });
      })();
    });
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      opts.onClose?.();
    };
    server.once("error", (err) => {
      log.warn("could not listen for the sign-in callback", { error: err.message });
      resolve(null);
    });
    server.listen(opts.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      timer = setTimeout(close, opts.ttlMs);
      timer.unref();
      resolve({ port, close });
    });
  });
