import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTransport } from "nodemailer";

const VERSION = "1.6.15";
const JAR_URL = `https://repo1.maven.org/maven2/com/icegreen/greenmail-standalone/${VERSION}/greenmail-standalone-${VERSION}.jar`;
const CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const JAR = join(CACHE, `greenmail-standalone-${VERSION}.jar`);
const LOCK = join(CACHE, "greenmail.lock");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const TEST_DOMAIN = "test.local";
export const TEST_PASSWORD = "secret";

export function javaAvailable(): boolean {
  try {
    return spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

async function download(): Promise<void> {
  const [jar, sha] = await Promise.all([fetch(JAR_URL), fetch(`${JAR_URL}.sha1`)]);
  if (!jar.ok || !sha.ok) throw new Error(`GreenMail download failed (${jar.status})`);
  const bytes = Buffer.from(await jar.arrayBuffer());
  const expected = (await sha.text()).trim().split(/\s+/)[0];
  if (createHash("sha1").update(bytes).digest("hex") !== expected) throw new Error("GreenMail download failed its checksum");
  const tmp = `${JAR}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, JAR);
}

/** Downloads greenmail-standalone once into packages/core/.cache. Parallel test files wait for the first one. */
export async function ensureJar(): Promise<string> {
  if (existsSync(JAR)) return JAR;
  mkdirSync(CACHE, { recursive: true });
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  } catch {
    for (let i = 0; i < 240 && !existsSync(JAR); i++) await sleep(500);
    if (existsSync(JAR)) return JAR;
    rmSync(LOCK, { force: true });
    return ensureJar();
  }
  try {
    await download();
  } finally {
    rmSync(LOCK, { force: true });
  }
  return JAR;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

async function waitForPorts(ports: number[], child: ChildProcess): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`GreenMail exited with code ${child.exitCode}`);
    if ((await Promise.all(ports.map(portOpen))).every(Boolean)) return;
    await sleep(200);
  }
  throw new Error("GreenMail did not open its ports in time");
}

export type Delivery = {
  to: string | string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer | string; contentType?: string; cid?: string }[];
  date?: Date;
};

export type GreenMail = {
  host: string;
  imapPort: number;
  smtpPort: number;
  /** Mailbox owners, created at startup. */
  users: { name: string; email: string; password: string }[];
  user(name: string): { name: string; email: string; password: string };
  /** Delivers a message over SMTP, the same way a remote sender would. */
  deliver(d: Delivery): Promise<void>;
  stop(): Promise<void>;
};

export type StartOptions = { users?: string[] };

/** Starts a private GreenMail instance on free ports with the given users (login = local part, password "secret"). */
export async function startGreenMail(opts: StartOptions = {}): Promise<GreenMail> {
  const jar = await ensureJar();
  const names = opts.users ?? ["alice", "bob", "carol", "dave"];
  const [imapPort, smtpPort, apiPort] = [await freePort(), await freePort(), await freePort()];
  const args = [
    `-Dgreenmail.imap.hostname=127.0.0.1`, `-Dgreenmail.imap.port=${imapPort}`,
    `-Dgreenmail.smtp.hostname=127.0.0.1`, `-Dgreenmail.smtp.port=${smtpPort}`,
    `-Dgreenmail.api.hostname=127.0.0.1`, `-Dgreenmail.api.port=${apiPort}`,
    `-Dgreenmail.users=${names.map((n) => `${n}:${TEST_PASSWORD}@${TEST_DOMAIN}`).join(",")}`,
    "-jar", jar,
  ];
  const child = spawn("java", args, { stdio: "ignore" });
  const kill = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  process.once("exit", kill);
  try {
    await waitForPorts([imapPort, smtpPort], child);
  } catch (error) {
    kill();
    throw error;
  }
  const users = names.map((name) => ({ name, email: `${name}@${TEST_DOMAIN}`, password: TEST_PASSWORD }));
  const smtp = createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  return {
    host: "127.0.0.1", imapPort, smtpPort, users,
    user(name) {
      const u = users.find((x) => x.name === name);
      if (!u) throw new Error(`No GreenMail user ${name}`);
      return u;
    },
    async deliver(d) {
      await smtp.sendMail({
        from: d.from ?? `Sender <sender@remote.example>`, to: d.to, cc: d.cc, subject: d.subject, text: d.text ?? (d.html ? undefined : "Hello"),
        html: d.html, messageId: d.messageId, inReplyTo: d.inReplyTo, references: d.references, headers: d.headers, attachments: d.attachments, date: d.date,
      });
    },
    async stop() {
      smtp.close();
      process.off("exit", kill);
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => { kill(); resolve(); }, 3000);
      });
    },
  };
}

/** Starts GreenMail, or returns null with a one-line reason on stderr when Java or the download is unavailable. */
export async function tryStartGreenMail(opts: StartOptions = {}): Promise<GreenMail | null> {
  if (!javaAvailable()) {
    process.stderr.write("Skipping GreenMail integration tests: java is not installed.\n");
    return null;
  }
  try {
    return await startGreenMail(opts);
  } catch (error) {
    process.stderr.write(`Skipping GreenMail integration tests: ${(error as Error).message}\n`);
    return null;
  }
}
