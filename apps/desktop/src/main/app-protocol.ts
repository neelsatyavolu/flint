import { extname, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { attachmentSchemeRegistration } from "./attachment-protocol";
import { buildCsp } from "./csp";

export const APP_SCHEME = "app";
export const APP_ORIGIN = `${APP_SCHEME}://flint`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { ...attachmentSchemeRegistration, privileges: { ...attachmentSchemeRegistration.privileges } },
  ]);
}

/** Serves the built renderer from app://flint/ with the CSP header set. */
export function serveRenderer(rendererDir: string): void {
  const root = normalize(rendererDir);
  const csp = buildCsp({ dev: false });
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const target = normalize(join(root, rel));
    if (target !== root && !target.startsWith(root + sep)) return new Response("Not found", { status: 404 });
    try {
      const res = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(res.headers);
      if (extname(target) === ".html") headers.set("Content-Security-Policy", csp);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
