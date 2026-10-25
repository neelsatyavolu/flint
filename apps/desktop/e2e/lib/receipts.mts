import { spawn, type ChildProcess } from "node:child_process";

export const GMAIL_PROXY_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
export const GOOGLE_NET = { asn: 15169, asOrganization: "Google LLC", country: "US", city: "Mountain View" };

export type ReceiptsServer = {
  endpoint: string;
  tokens(): Promise<{ token: string; ref: string }[]>;
  /** A recipient's mail app loading the pixel; `ip` is the address the Worker sees. */
  hit(token: string, o: { ua: string; ip?: string; cf?: typeof GOOGLE_NET }): Promise<number>;
  stop(): Promise<void>;
};

/** Starts the real receipts Worker router on a loopback port in a child process (it needs node's TypeScript transform). */
export async function startReceiptsServer(): Promise<ReceiptsServer> {
  const script = new URL("./receipts-server.mts", import.meta.url).pathname;
  const child: ChildProcess = spawn(process.execPath, ["--experimental-transform-types", "--no-warnings", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => { stderr += String(d); });
  const port = await new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`receipts server did not start: ${stderr.slice(0, 400)}`)), 15_000);
    child.stdout?.on("data", (d) => {
      buffer += String(d);
      const m = /LISTENING (\d+)/.exec(buffer);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`receipts server exited ${code}: ${stderr.slice(0, 400)}`)); });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  return {
    endpoint,
    async tokens() {
      return (await (await fetch(`${endpoint}/__e2e/tokens`)).json()) as { token: string; ref: string }[];
    },
    async hit(token, o) {
      const headers: Record<string, string> = { "user-agent": o.ua };
      if (o.ip) headers["x-e2e-ip"] = o.ip;
      if (o.cf) headers["x-e2e-cf"] = JSON.stringify(o.cf);
      return (await fetch(`${endpoint}/i/${token}.gif`, { headers })).status;
    },
    async stop() {
      child.removeAllListeners("exit");
      child.kill("SIGTERM");
    },
  };
}
