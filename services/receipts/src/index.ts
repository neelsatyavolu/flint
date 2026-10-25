import { purge } from "./cron";
import type { Env } from "./env";
import { HttpError, errorResponse, fromError } from "./http";
import { pixelResponse } from "./gif";
import { recordHit, tokenFromPath } from "./pixel";
import { handleDeleteMessage, handleEvents, handleInstall, handleRegister, handleSeen } from "./routes-api";


function requireMethod(request: Request, ...allowed: string[]): void {
  if (!allowed.includes(request.method)) throw new HttpError("method_not_allowed", `Use ${allowed.join(" or ")} for this endpoint.`);
}

export async function handle(request: Request, env: Env, ctx: ExecutionContext, now: number = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Pixel: never errors visibly. Unknown or malformed tokens get the same GIF.
  if (path.startsWith("/i/")) {
    if (request.method !== "GET" && request.method !== "HEAD") return pixelResponse();
    const token = tokenFromPath(path);
    if (token) ctx.waitUntil(recordHit(request, env, token, now));
    return pixelResponse();
  }

  try {
    if (path === "/v1/install") { requireMethod(request, "POST"); return await handleInstall(request, env, now); }
    if (path === "/v1/messages") { requireMethod(request, "POST"); return await handleRegister(request, env, now); }
    const del = /^\/v1\/messages\/([^/]+)$/.exec(path);
    if (del?.[1]) { requireMethod(request, "DELETE"); return await handleDeleteMessage(request, env, del[1]); }
    if (path === "/v1/seen") { requireMethod(request, "POST"); return await handleSeen(request, env, now); }
    if (path === "/v1/events") { requireMethod(request, "GET"); return await handleEvents(request, env); }
    return errorResponse("not_found", "No such endpoint.");
  } catch (err) {
    if (err instanceof HttpError && err.code === "method_not_allowed") return errorResponse(err.code, err.message, { Allow: "GET, POST, DELETE" });
    return fromError(err);
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => handle(request, env, ctx),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext): void => {
    ctx.waitUntil(purge(env, Date.now()));
  },
} satisfies ExportedHandler<Env>;
