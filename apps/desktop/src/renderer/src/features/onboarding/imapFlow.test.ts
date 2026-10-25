import { describe, expect, it } from "vitest";
import { EMPTY_SERVER, connectionProblems, describeServer, toInput, validateForm } from "./imapFlow";
import { checkClient } from "./googleSetup";

const server = { ...EMPTY_SERVER, imapHost: "imap.x.com", smtpHost: "smtp.x.com" };

describe("validateForm", () => {
  it("reports every missing field", () => {
    expect(Object.keys(validateForm({ email: "a", name: "", password: "", server: null })).sort()).toEqual(["email", "name", "password", "server"]);
  });
  it("checks ports", () => {
    expect(validateForm({ email: "a@x.com", name: "A", password: "p", server: { ...server, imapPort: 0 } }).server).toMatch(/Ports/);
  });
  it("passes a full form", () => expect(validateForm({ email: "a@x.com", name: "A", password: "p", server })).toEqual({}));
});

describe("connection messages", () => {
  it("names each failing server", () => {
    const out = connectionProblems({ imap: "Login failed", smtp: "ok" }, server);
    expect(out).toEqual(["Incoming mail (IMAP imap.x.com): Login failed."]);
    expect(connectionProblems({ imap: "bad", smtp: "worse." }, null)).toHaveLength(2);
    expect(connectionProblems({ imap: "ok", smtp: "ok" }, server)).toEqual([]);
  });
  it("describes servers and fills the username", () => {
    expect(describeServer(server)).toContain("STARTTLS");
    expect(toInput({ email: " a@x.com ", name: "A", password: "p", server }, "imap").server?.username).toBe("a@x.com");
  });
});

describe("checkClient", () => {
  it("needs a Google client id and a secret", () => {
    expect(checkClient("abc", "").ok).toBe(false);
    expect(checkClient("123-abc.apps.googleusercontent.com", " s ")).toEqual({ ok: true, clientId: "123-abc.apps.googleusercontent.com", clientSecret: "s" });
  });
});
