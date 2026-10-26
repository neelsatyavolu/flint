import { describe, expect, it } from "vitest";
import { item } from "../../state/testFixtures";
import { buildPageSections, buildSections, NO_REMOTE, type SectionInput } from "./sections";
import type { Entry } from "./model";
import { bump } from "./usage";

const e = (id: string, label: string, extra: Partial<Entry> = {}): Entry => ({ id, label, group: "Actions", kind: "action", run: () => undefined, ...extra });
const NOW = 1_000_000_000;
const base: SectionInput = {
  mode: "all", text: "", now: NOW, usage: {}, remote: NO_REMOTE, aiEnabled: true,
  entries: [
    e("read", "Mark read or unread"), e("spam", "Mark as spam"), e("archive", "Archive"), e("go:Archive", "Archive", { group: "Go to", kind: "go" }),
    e("go:Sent", "Sent", { group: "Go to", kind: "go" }), e("folder:1", "Receipts", { group: "Folders", kind: "folder", quiet: true }),
    e("cat:people", "Inbox: People", { group: "Categories", kind: "folder", quiet: true }),
  ],
};
const ids = (s: ReturnType<typeof buildSections>) => s.flatMap((x) => x.rows.map((r) => r.id));

describe("buildSections", () => {
  it("shows Recent first on an empty query, then groups without the quiet entries", () => {
    const usage = bump(bump({}, "go:Sent", NOW - 5), "archive", NOW - 1);
    const s = buildSections({ ...base, usage });
    expect(s[0]).toMatchObject({ id: "recent", title: "Recent" });
    expect(s[0]!.rows.map((r) => r.id)).toEqual(["recent:archive", "recent:go:Sent"]);
    expect(s.map((x) => x.title)).toEqual(["Recent", "Actions", "Go to"]);
    expect(ids(s)).not.toContain("folder:1");
  });

  it("leaves out Recent when nothing was used or the entry is gone", () => {
    expect(buildSections(base)[0]!.title).toBe("Actions");
    const stale = bump({}, "removed", NOW);
    expect(buildSections({ ...base, usage: stale })[0]!.title).toBe("Actions");
  });

  it("ranks by match quality and lets use float equal matches up", () => {
    const plain = buildSections({ ...base, text: "mark" });
    expect(plain[0]!.rows.map((r) => r.id)).toEqual(["spam", "read"]);
    let usage = {};
    for (let i = 0; i < 6; i++) usage = bump(usage, "read", NOW - 1000);
    const boosted = buildSections({ ...base, text: "mark", usage });
    expect(boosted[0]!.rows.map((r) => r.id)).toEqual(["read", "spam"]);
  });

  it("does not let heavy use beat a much better match", () => {
    let usage = {};
    for (let i = 0; i < 500; i++) usage = bump(usage, "go:Sent", NOW);
    const s = buildSections({ ...base, text: "arch", usage });
    expect(ids(s)[0]).toBe("archive");
  });

  it("carries highlight ranges for the label", () => {
    const row = buildSections({ ...base, text: "arch" })[0]!.rows[0]!;
    expect(row.ranges).toEqual([[0, 4]]);
  });

  it("adds mail, people, search and ask rows once text is typed", () => {
    const s = buildSections({
      ...base, text: "invoice",
      remote: { ...NO_REMOTE, threads: [item(7, { subject: "Invoice 2291" })], contacts: [{ email: "i@x.test", name: "Ines", score: 1 }] },
    });
    expect(s.map((x) => x.title)).toEqual(["Mail", "People", "Elsewhere"]);
    expect(s[0]!.rows[0]).toMatchObject({ id: "thread:7", label: "Invoice 2291", kind: "mail" });
    expect(s[1]!.rows[0]!.label).toBe("Write to Ines");
    expect(s[2]!.rows.map((r) => r.id)).toEqual(["search-all", "ask-ai"]);
  });

  it("offers Ask AI only for real text and when AI is on", () => {
    expect(ids(buildSections({ ...base, text: "ab" }))).not.toContain("ask-ai");
    expect(ids(buildSections({ ...base, text: "abcd", aiEnabled: false }))).not.toContain("ask-ai");
  });

  it("offers a typed address as a person to write to", () => {
    expect(ids(buildSections({ ...base, text: "new@person.test" }))).toContain("contact:new@person.test");
  });

  it("keeps the mail status under the last section so rows above never move", () => {
    const loading = buildSections({ ...base, text: "zzz", remote: { ...NO_REMOTE, mailLoading: true } });
    expect(loading.at(-1)!.status).toEqual({ kind: "loading", text: "Searching mail" });
    expect(loading.slice(0, -1).every((x) => !x.status)).toBe(true);
    const failed = buildSections({ ...base, text: "zzz", remote: { ...NO_REMOTE, mailError: true } });
    expect(failed.at(-1)!.status?.kind).toBe("error");
  });

  it("limits each prefix mode to what it is for", () => {
    expect(ids(buildSections({ ...base, mode: "commands", text: "" }))).toEqual(["read", "spam", "archive"]);
    expect(ids(buildSections({ ...base, mode: "folders", text: "" }))).toEqual(["cat:people", "folder:1"]);
    expect(ids(buildSections({ ...base, mode: "folders", text: "rec" }))).toEqual(["folder:1"]);
    const mail = buildSections({ ...base, mode: "mail", text: "budget", remote: { ...NO_REMOTE, threads: [item(1), item(2)] } });
    expect(ids(mail)).toEqual(["thread:1", "thread:2", "search-all"]);
    expect(buildSections({ ...base, mode: "mail", text: "" })).toEqual([]);
    expect(ids(buildSections({ ...base, mode: "contacts", text: "c", remote: { ...NO_REMOTE, contacts: [{ email: "c@x.test", name: "", score: 1 }] } }))).toEqual(["contact:c@x.test"]);
  });

  it("puts the thread count beside Actions", () => {
    expect(buildSections({ ...base, actionMeta: "3 threads" })[0]!.meta).toBe("3 threads");
  });
});

describe("buildPageSections", () => {
  const opts = [e("p:a", "Later today"), e("p:b", "Tomorrow morning"), e("p:c", "Next week")];
  it("keeps order, then filters by what is typed", () => {
    expect(buildPageSections(opts, "")[0]!.rows.map((r) => r.id)).toEqual(["p:a", "p:b", "p:c"]);
    expect(buildPageSections(opts, "tom")[0]!.rows.map((r) => r.id)).toEqual(["p:b"]);
    expect(buildPageSections(opts, "zz")).toEqual([]);
  });
});
