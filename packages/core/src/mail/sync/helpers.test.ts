import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchMessageObject, ListResponse, MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";
import { attachmentPath, readCached, safeFilename, writeCached } from "./attachments";
import { decodeTextPart } from "./body";
import { hasRealAttachments, walkStructure } from "./bodystructure";
import { classifyMailboxes, gmailLabelPaths } from "./folders";
import { parseHeaders, parseReferences } from "./headers";
import { flagsOf, toIngestMessage } from "./mapping";

const node = (type: string, extra: Partial<MessageStructureObject> = {}): MessageStructureObject => ({ type, ...extra });

describe("walkStructure", () => {
  it("treats a single text part as the body, part 1", () => {
    const r = walkStructure(node("text/plain", { parameters: { charset: "utf-8" }, encoding: "quoted-printable" }));
    expect(r.text).toEqual([{ part: "1", type: "text/plain", charset: "utf-8", encoding: "quoted-printable" }]);
    expect(r.attachments).toEqual([]);
  });

  it("finds alternative bodies and attachments in nested multiparts", () => {
    const tree = node("multipart/mixed", { childNodes: [
      node("multipart/alternative", { childNodes: [node("text/plain", { encoding: "7bit" }), node("text/html", { encoding: "base64", parameters: { charset: "iso-8859-1" } })] }),
      node("application/pdf", { disposition: "attachment", dispositionParameters: { filename: "invoice.pdf" }, size: 1234, encoding: "base64" }),
    ] });
    const r = walkStructure(tree);
    expect(r.text.map((t) => [t.part, t.type])).toEqual([["1.1", "text/plain"], ["1.2", "text/html"]]);
    expect(r.attachments).toEqual([{ part: "2", filename: "invoice.pdf", contentType: "application/pdf", size: 1234, contentId: null, inline: false }]);
    expect(hasRealAttachments(r)).toBe(true);
  });

  it("marks cid images as inline and does not count them as attachments", () => {
    const tree = node("multipart/related", { childNodes: [
      node("text/html"),
      node("image/png", { id: "<logo@x>", disposition: "inline", parameters: { name: "logo.png" }, size: 10 }),
    ] });
    const r = walkStructure(tree);
    expect(r.attachments[0]).toMatchObject({ part: "2", filename: "logo.png", contentId: "logo@x", inline: true });
    expect(hasRealAttachments(r)).toBe(false);
  });

  it("names unnamed attachments and keeps text files with names as attachments", () => {
    const r = walkStructure(node("multipart/mixed", { childNodes: [
      node("text/plain"), node("text/plain", { disposition: "attachment", dispositionParameters: { filename: "notes.txt" } }),
      node("image/jpeg", { disposition: "attachment" }), node("text/calendar"),
    ] }));
    expect(r.text).toHaveLength(1);
    expect(r.attachments.map((a) => a.filename)).toEqual(["notes.txt", "attachment-3.jpg", "attachment-4.ics"]);
  });

  it("does not descend into embedded messages", () => {
    const r = walkStructure(node("multipart/mixed", { childNodes: [node("text/plain"), node("message/rfc822", { childNodes: [node("text/plain")], disposition: "attachment", size: 5 })] }));
    expect(r.text).toHaveLength(1);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]!.contentType).toBe("message/rfc822");
  });

  it("handles a missing structure", () => {
    expect(walkStructure(undefined)).toEqual({ text: [], attachments: [] });
  });
});

describe("decodeTextPart", () => {
  it("decodes quoted-printable and charsets", async () => {
    const out = await decodeTextPart(Buffer.from("caf=E9 =3D ok"), { part: "1", type: "text/plain", charset: "iso-8859-1", encoding: "quoted-printable" });
    expect(out).toBe("café = ok");
  });

  it("decodes base64 html", async () => {
    const out = await decodeTextPart(Buffer.from(Buffer.from("<p>héllo</p>").toString("base64")), { part: "1", type: "text/html", charset: "utf-8", encoding: "base64" });
    expect(out).toContain("<p>héllo</p>");
  });

  it("copes with a missing charset", async () => {
    expect(await decodeTextPart(Buffer.from("plain"), { part: "1", type: "text/plain", charset: null, encoding: "7bit" })).toBe("plain");
  });
});

describe("headers", () => {
  it("parses folded headers into lowercase names, first value wins", () => {
    const raw = Buffer.from("List-Unsubscribe: <https://x.example/u>,\r\n <mailto:u@x.example>\r\nList-Id: <news.x.example>\r\nlist-id: second\r\n\r\n");
    expect(parseHeaders(raw)).toEqual({ "list-unsubscribe": "<https://x.example/u>, <mailto:u@x.example>", "list-id": "<news.x.example>" });
    expect(parseHeaders(undefined)).toEqual({});
  });

  it("extracts message ids from References", () => {
    expect(parseReferences("<a@x> <b@y>\n <c@z>")).toEqual(["a@x", "b@y", "c@z"]);
    expect(parseReferences(undefined)).toEqual([]);
  });
});

const entry = (path: string, flags: string[] = [], specialUse?: string): ListResponse => ({
  path, pathAsListed: path, name: path.split("/").pop()!, delimiter: "/", parent: [], parentPath: "", flags: new Set(flags), specialUse, listed: true, subscribed: true,
});

describe("classifyMailboxes", () => {
  it("maps special-use flags and the INBOX name", () => {
    const r = classifyMailboxes([
      entry("INBOX"), entry("Sent", [], "\\Sent"), entry("Drafts", [], "\\Drafts"), entry("Trash", [], "\\Trash"), entry("Junk", [], "\\Junk"),
      entry("Archive", [], "\\Archive"), entry("All Mail", [], "\\All"), entry("Starred", [], "\\Flagged"), entry("Important", [], "\\Important"),
    ]);
    expect(Object.fromEntries(r.map((m) => [m.path, m.role]))).toEqual({
      INBOX: "inbox", Sent: "sent", Drafts: "drafts", Trash: "trash", Junk: "spam", Archive: "archive", "All Mail": "all", Starred: "flagged", Important: "important",
    });
  });

  it("falls back to name heuristics and keeps one folder per role", () => {
    const r = classifyMailboxes([entry("INBOX"), entry("Sent Items"), entry("Deleted Items"), entry("Junk E-mail"), entry("Entwürfe"), entry("Sent"), entry("Projects")]);
    const roles = Object.fromEntries(r.map((m) => [m.path, m.role]));
    expect(roles).toMatchObject({ "Sent Items": "sent", "Deleted Items": "trash", "Junk E-mail": "spam", Entwürfe: "drafts", Projects: null });
    expect(roles["Sent"]).toBeNull(); // second sent-like folder
  });

  it("lets special-use win over a name and skips unselectable folders", () => {
    const r = classifyMailboxes([entry("[Gmail]", ["\\Noselect"]), entry("Bin", [], "\\Trash"), entry("Trash")]);
    expect(r.map((m) => m.path)).toEqual(["Bin", "Trash"]);
    expect(r.find((m) => m.path === "Bin")!.role).toBe("trash");
    expect(r.find((m) => m.path === "Trash")!.role).toBeNull();
  });
});

describe("classifyMailboxes: Gmail system folders", () => {
  it("maps [Gmail]/Important and Starred by path, including localized names, without special-use flags", () => {
    const r = classifyMailboxes([entry("INBOX"), entry("[Gmail]/Important"), entry("[Gmail]/Wichtig"), entry("[Google Mail]/Starred"), entry("Important")]);
    const roles = Object.fromEntries(r.map((m) => [m.path, m.role]));
    expect(roles).toMatchObject({ "[Gmail]/Important": "important", "[Gmail]/Wichtig": "important", "[Google Mail]/Starred": "flagged", Important: null });
  });
  it("maps a localized \\Important special-use flag", () => {
    const r = classifyMailboxes([entry("[Gmail]/Importantes", [], "\\Important")]);
    expect(r[0]!.role).toBe("important");
  });
});

describe("gmailLabelPaths", () => {
  const paths = { inbox: "INBOX", sent: "[Gmail]/Sent Mail", drafts: "[Gmail]/Drafts", spam: "[Gmail]/Spam", trash: "[Gmail]/Trash" } as Record<string, string>;
  it("resolves system labels, keeps user labels and skips Starred and Important", () => {
    const out = gmailLabelPaths(["\\Inbox", "\\Sent", "\\Important", "\\Starred", "Work/Clients", "\\Draft", "\\Unknown", "", "Work/Clients"], (role) => paths[role] ?? null);
    expect(out).toEqual(["INBOX", "[Gmail]/Sent Mail", "Work/Clients", "[Gmail]/Drafts"]);
  });

  it("drops system labels whose folder is not known", () => {
    expect(gmailLabelPaths(["\\Trash"], () => null)).toEqual([]);
  });
});

describe("toIngestMessage", () => {
  const base: FetchMessageObject = {
    seq: 1, uid: 7, size: 321, flags: new Set(["\\Seen", "\\Flagged"]), internalDate: new Date("2026-10-01T12:00:00Z"),
    envelope: {
      date: new Date("2026-10-01T11:00:00Z"), subject: "Hi", messageId: "<m1@x>", inReplyTo: "<m0@x>",
      from: [{ name: "Ann", address: "ann@x.org" }], to: [{ address: "me@x.org" }, { name: "Group" }], cc: [], bcc: [], replyTo: [],
    },
    bodyStructure: node("multipart/mixed", { childNodes: [node("text/plain"), node("application/zip", { disposition: "attachment", dispositionParameters: { filename: "a.zip" } })] }),
    headers: Buffer.from("References: <m-1@x> <m0@x>\r\nList-Id: <l.x>\r\nPrecedence: bulk\r\n"),
    emailId: "1234", threadId: "99", labels: new Set(["\\Inbox", "Work"]),
  };

  it("maps a generic IMAP message", () => {
    const m = toIngestMessage(base, { gmail: false, now: 5 });
    expect(m).toMatchObject({
      uid: 7, gmMsgid: null, gmThrid: null, messageId: "<m1@x>", inReplyTo: "<m0@x>", references: ["m-1@x", "m0@x"], subject: "Hi",
      from: [{ name: "Ann", address: "ann@x.org" }], to: [{ name: "", address: "me@x.org" }], date: Date.parse("2026-10-01T11:00:00Z"),
      flags: { seen: true, flagged: true, answered: false, draft: false }, size: 321, hasAttachments: true,
      headers: { "list-id": "<l.x>", precedence: "bulk" },
    });
    expect(m.gmLabels).toBeUndefined();
    expect(m.attachments).toHaveLength(1);
  });

  it("adds Gmail ids and label paths", () => {
    const m = toIngestMessage(base, { gmail: true, now: 5, labelPaths: (l) => [...l].map((x) => (x === "\\Inbox" ? "INBOX" : x)) });
    expect(m).toMatchObject({ gmMsgid: "1234", gmThrid: "99", gmLabels: ["INBOX", "Work"] });
  });

  it("falls back to the internal date, then the clock", () => {
    const noEnvDate = { ...base, envelope: { ...base.envelope!, date: undefined } };
    expect(toIngestMessage(noEnvDate, { gmail: false, now: 5 }).date).toBe(Date.parse("2026-10-01T12:00:00Z"));
    expect(toIngestMessage({ ...noEnvDate, internalDate: undefined }, { gmail: false, now: 5 }).date).toBe(5);
    expect(toIngestMessage({ ...noEnvDate, envelope: { ...noEnvDate.envelope, date: "garbage" }, internalDate: undefined }, { gmail: false, now: 6 }).date).toBe(6);
  });

  it("copes with a bare fetch result", () => {
    const m = toIngestMessage({ seq: 1, uid: 1 }, { gmail: false, now: 9 });
    expect(m).toMatchObject({ subject: "", from: [], messageId: null, flags: { seen: false }, size: 0, hasAttachments: false, date: 9 });
  });

  it("reads flags", () => {
    expect(flagsOf(new Set(["\\Answered", "\\Draft"]))).toEqual({ seen: false, flagged: false, answered: true, draft: true });
    expect(flagsOf(undefined).seen).toBe(false);
  });
});

describe("attachment files", () => {
  it("makes names safe", () => {
    expect(safeFilename("../../etc/passwd")).not.toContain("/");
    expect(safeFilename("a\u0000b\u0007c.txt")).toBe("abc.txt");
    expect(safeFilename("  ..hidden. ")).toBe("hidden");
    expect(safeFilename("CON:*?.txt")).toBe("CON_.txt");
    expect(safeFilename("")).toBe("attachment");
    expect(safeFilename("...", "x")).toBe("x");
    const long = safeFilename(`${"a".repeat(300)}.pdf`);
    expect(long.length).toBe(120);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("builds a cache path that stays inside the data dir", () => {
    const p = attachmentPath("/data", "acc/../x", 5, 9, "../evil.sh");
    expect(p.startsWith("/data/attachments/")).toBe(true);
    expect(p.split("/")).not.toContain("..");
    expect(p.endsWith("/5/9-_evil.sh")).toBe(true);
  });

  it("writes atomically and reads back; missing files read as null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flint-att-"));
    const path = join(dir, "x", "y.bin");
    await writeCached(path, Buffer.from("data"));
    expect((await readCached(path))!.toString()).toBe("data");
    expect(existsSync(`${path}.part`)).toBe(false);
    expect(await readCached(join(dir, "missing"))).toBeNull();
    expect(await readCached(null)).toBeNull();
  });
});
