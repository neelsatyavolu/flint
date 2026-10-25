// Child process: the real receipts Worker router over an in-memory SQLite D1 fake, behind a loopback HTTP server.
// Run with: node --experimental-transform-types receipts-server.mts
// Test hooks (only this shim understands them, the Worker is unchanged):
//   x-e2e-ip   overrides the client IP the Worker sees (CF-Connecting-IP)
//   x-e2e-cf   JSON of Cloudflare request.cf fields (asn, asOrganization, country, city)
//   GET /__e2e/tokens   lists registered pixel tokens
import { registerHooks } from "node:module";
import { createServer } from "node:http";

// The Worker sources import siblings without extensions (bundler style); give them the .ts node needs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[a-z]+$/.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const { setup } = (await import("../../../../services/receipts/src/test/helpers.ts")) as typeof import("../../../../services/receipts/src/test/helpers.ts");
const worker = setup();

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/__e2e/tokens") {
        const rows = worker.raw.prepare("SELECT token, ref FROM tokens ORDER BY rowid").all();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rows));
        return;
      }
      const header = (name: string): string | undefined => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const headers: Record<string, string> = {};
      for (const name of ["authorization", "content-type", "user-agent"]) {
        const v = header(name);
        if (v) headers[name] = v;
      }
      const ip = header("x-e2e-ip") ?? (req.socket.remoteAddress ?? "127.0.0.1").replace(/^::ffff:/, "");
      const cfRaw = header("x-e2e-cf");
      const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
      const out = await worker.call(url.pathname + url.search, {
        method: req.method, headers, body, ip, now: Date.now(), cf: cfRaw ? JSON.parse(cfRaw) : undefined,
      });
      const bytes = Buffer.from(await out.arrayBuffer());
      res.writeHead(out.status, Object.fromEntries(out.headers)).end(bytes);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.stdout.write(`LISTENING ${address.port}\n`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
