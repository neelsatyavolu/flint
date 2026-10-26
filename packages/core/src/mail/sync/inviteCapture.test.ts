import { Readable } from "node:stream";
import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { fixture } from "../../calendar/fixtures";
import { makeStore, msg, seedImap } from "../../store/testkit";
import { captureInvite } from "./inviteCapture";

const ics = (part = "2", name = "invite.ics") => [{ part, filename: name, contentType: "text/calendar", size: 900, contentId: null, inline: false }];

function client(parts: Record<string, string | Error>): { c: ImapFlow; asked: string[] } {
  const asked: string[] = [];
  const c = {
    download: async (_uid: string, part: string) => {
      asked.push(part);
      const v = parts[part];
      if (v instanceof Error) throw v;
      return { content: Readable.from([Buffer.from(v ?? "", "utf8")]) };
    },
  } as unknown as ImapFlow;
  return { c, asked };
}

function setup(attachments = ics()) {
  const store = makeStore();
  const s = seedImap(store);
  const [o] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 7, hasAttachments: true, attachments })]);
  return { store, accountId: s.account.id, messageRowId: o!.messageRowId, uid: 7 };
}

describe("captureInvite (sync hook)", () => {
  it("downloads the calendar part and stores the invite", async () => {
    const t = setup();
    const { c, asked } = client({ "2": fixture("google-weekly-meet.ics") });
    await captureInvite(c, { ...t, now: 1 });
    expect(asked).toEqual(["2"]);
    expect(t.store.getStoredInvite(t.messageRowId)?.invite).toMatchObject({ title: "Design sync", invitedAs: { address: "me@example.com" } });
    expect(t.store.isInviteChecked(t.messageRowId)).toBe(true);
  });

  it("uses an alias to recognize the user", async () => {
    const t = setup();
    t.store.updateAccount(t.accountId, { aliases: ["alias@example.com"] });
    const { c } = client({ "2": fixture("google-weekly-meet.ics").replace("mailto:me@example.com", "mailto:alias@example.com") });
    await captureInvite(c, { ...t, now: 1 });
    expect(t.store.getStoredInvite(t.messageRowId)?.invite.invitedAs?.address).toBe("alias@example.com");
  });

  it("marks a message without a calendar part as scanned and downloads nothing", async () => {
    const t = setup([{ part: "2", filename: "a.pdf", contentType: "application/pdf", size: 5, contentId: null, inline: false }]);
    const { c, asked } = client({});
    await captureInvite(c, { ...t, now: 1 });
    expect(asked).toEqual([]);
    expect(t.store.isInviteChecked(t.messageRowId)).toBe(true);
    expect(t.store.getStoredInvite(t.messageRowId)).toBeNull();
  });

  it("marks a calendar part with no event as scanned", async () => {
    const t = setup();
    await captureInvite(client({ "2": "BEGIN:VCALENDAR\r\nEND:VCALENDAR" }).c, { ...t, now: 1 });
    expect(t.store.isInviteChecked(t.messageRowId)).toBe(true);
    expect(t.store.getStoredInvite(t.messageRowId)).toBeNull();
  });

  it("leaves the message unscanned when the download fails", async () => {
    const t = setup();
    await captureInvite(client({ "2": new Error("connection reset") }).c, { ...t, now: 1 });
    expect(t.store.isInviteChecked(t.messageRowId)).toBe(false);
  });

  it("skips oversized parts", async () => {
    const t = setup([{ part: "2", filename: "huge.ics", contentType: "text/calendar", size: 5_000_000, contentId: null, inline: false }]);
    const { c, asked } = client({ "2": fixture("google-weekly-meet.ics") });
    await captureInvite(c, { ...t, now: 1 });
    expect(asked).toEqual([]);
  });
});
