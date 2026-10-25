import { describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { isTlsHandshakeError, openSmtp } from "./bridgeSmtp";
import { imapOptions, smtpOptions } from "./connect";

const auth = { user: "me@proton.me", pass: "bridge-pass" };
const server = (over: Partial<{ smtpHost: string; smtpPort: number; smtpSecure: boolean }> = {}) =>
  ({ smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: true, ...over });

const wrongVersion = Object.assign(new Error("error:0A00010B:SSL routines:ssl3_get_record:wrong version number"), { code: "ESOCKET" });

/** A factory whose transports verify according to the secure flag they were built with. */
function fakeFactory(secureWorks: boolean, startTlsWorks = true) {
  const built: SMTPTransport.Options[] = [];
  const closed: boolean[] = [];
  const create = (options: SMTPTransport.Options) => {
    built.push(options);
    return {
      verify: vi.fn(async () => {
        if (options.secure ? !secureWorks : !startTlsWorks) throw options.secure ? wrongVersion : new Error("connection closed");
        return true;
      }),
      close: () => closed.push(true),
    } as unknown as Transporter<SMTPTransport.SentMessageInfo>;
  };
  return { create, built, closed };
}

describe("isTlsHandshakeError", () => {
  it("recognises handshake failures only", () => {
    expect(isTlsHandshakeError(wrongVersion)).toBe(true);
    expect(isTlsHandshakeError(Object.assign(new Error("write EPROTO"), { code: "EPROTO" }))).toBe(true);
    expect(isTlsHandshakeError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isTlsHandshakeError(Object.assign(new Error("Invalid login"), { code: "EAUTH" }))).toBe(false);
  });
});

describe("openSmtp (Proton Bridge)", () => {
  it("falls back to STARTTLS on a handshake error and reports the working mode", async () => {
    const f = fakeFactory(false);
    const r = await openSmtp(server(), auth, f.create);
    expect(r.smtpSecure).toBe(false);
    expect(f.built.map((o) => o.secure)).toEqual([true, false]);
    expect(f.built[1]).toMatchObject({ port: 1025, requireTLS: true });
    expect(f.closed).toHaveLength(1);
  });

  it("keeps implicit SSL when it works", async () => {
    const f = fakeFactory(true);
    expect((await openSmtp(server(), auth, f.create)).smtpSecure).toBe(true);
    expect(f.built).toHaveLength(1);
  });

  it("does not retry for errors that are not TLS handshakes", async () => {
    const create = () => ({ verify: async () => { throw Object.assign(new Error("Invalid login"), { code: "EAUTH" }); }, close: () => undefined }) as unknown as Transporter<SMTPTransport.SentMessageInfo>;
    await expect(openSmtp(server(), auth, create)).rejects.toMatchObject({ code: "EAUTH" });
  });

  it("surfaces the STARTTLS failure when both modes fail", async () => {
    const f = fakeFactory(false, false);
    await expect(openSmtp(server(), auth, f.create)).rejects.toThrow("connection closed");
  });

  it("leaves remote hosts and STARTTLS accounts alone, without probing", async () => {
    const remote = fakeFactory(false);
    expect((await openSmtp(server({ smtpHost: "smtp.example.com", smtpPort: 465 }), auth, remote.create)).smtpSecure).toBe(true);
    expect(remote.built).toHaveLength(1);
    const plain = fakeFactory(false);
    expect((await openSmtp(server({ smtpSecure: false }), auth, plain.create)).smtpSecure).toBe(false);
    expect(plain.built).toHaveLength(1);
  });
});

describe("Proton Bridge connection options", () => {
  const imap = (over: Partial<{ imapHost: string; imapPort: number; imapSecure: boolean }>) =>
    imapOptions({ imapHost: "127.0.0.1", imapPort: 1143, imapSecure: false, ...over }, auth);

  it("requires STARTTLS on Bridge's IMAP port", () => {
    expect(imap({})).toMatchObject({ doSTARTTLS: true, tls: { rejectUnauthorized: false } });
  });

  it("leaves other loopback servers (GreenMail) opportunistic", () => {
    expect(imap({ imapPort: 34143 }).doSTARTTLS).toBeUndefined();
    expect(imap({ imapSecure: true }).doSTARTTLS).toBeUndefined();
  });

  it("still requires STARTTLS for remote plain hosts", () => {
    expect(imap({ imapHost: "imap.example.com", imapPort: 143 }).doSTARTTLS).toBe(true);
  });

  it("requires STARTTLS on Bridge's SMTP port when not implicit SSL", () => {
    expect(smtpOptions({ smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: false }, auth).requireTLS).toBe(true);
    expect(smtpOptions({ smtpHost: "127.0.0.1", smtpPort: 3025, smtpSecure: false }, auth).requireTLS).toBeUndefined();
  });
});

describe("checkConnection with a Bridge-like SMTP server", () => {
  it("reports STARTTLS-mode success when implicit SSL hits a plain SMTP port", async () => {
    const { createServer } = await import("node:net");
    const { checkConnection } = await import("../service/connectionCheck");
    const srv = createServer((sock) => {
      sock.write("220 bridge ready\r\n");
      sock.on("data", (d) => {
        const line = d.toString();
        if (/^(EHLO|LHLO)/i.test(line)) sock.write("250-bridge\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^AUTH/i.test(line)) sock.write("235 ok\r\n");
        else if (/^QUIT/i.test(line)) sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      const result = await checkConnection(
        { imapHost: "127.0.0.1", imapPort: 1, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: port, smtpSecure: true, username: "me@proton.me" },
        auth,
      );
      expect(result.smtp).toBe("ok");
      expect(result.smtpSecure).toBe(false);
    } finally {
      srv.close();
    }
  });
});
