import type { Address, Draft, Folder, MailboxRole, MessageView, ReceiptDetail, ReceiptRecipient, TrackedMessage } from "@flint/core";
import { SIGNATURES, quoteBlock, textToMailHtml } from "./bodies";
import { ACCOUNT_IDS, defaultAi, defaultSettings, makeAccounts, makeActivity, makeRules, makeSignatures, makeTemplates } from "./fixtures";
import { generateThreads } from "./generated";
import { HERO_THREADS } from "./hero";
import { ME, ME_NAME, PEOPLE } from "./people";
import { createRng } from "./rng";
import type { AcctKey, SeedMsg, SeedRecipient, SeedThread } from "./seedTypes";
import { DAY } from "./seedTypes";
import { nextId, plainSnippet, stripHtml, type MThread, type MockState } from "./state";
import { formatFullDate } from "../lib/format";

const MIN = 60_000;
const ROLE_FOLDERS: { role: MailboxRole; name: string; path: string }[] = [
  { role: "inbox", name: "Inbox", path: "INBOX" },
  { role: "sent", name: "Sent", path: "Sent" },
  { role: "drafts", name: "Drafts", path: "Drafts" },
  { role: "archive", name: "Archive", path: "Archive" },
  { role: "trash", name: "Trash", path: "Trash" },
  { role: "spam", name: "Spam", path: "Spam" },
];
const USER_LABELS: Record<AcctKey, string[]> = { northwind: ["Clients", "Receipts", "Team", "Travel"], orbit: ["Team"], gmail: ["Travel"] };

const acctEmail = (a: AcctKey) => ME[a];

function buildFolders(state: MockState): Folder[] {
  const folders: Folder[] = [];
  for (const acct of state.accounts) {
    const key = (Object.keys(ACCOUNT_IDS) as AcctKey[]).find((k) => ACCOUNT_IDS[k] === acct.id)!;
    for (const r of ROLE_FOLDERS) folders.push({ id: nextId(state, "folder"), accountId: acct.id, path: r.path, name: r.name, role: r.role, unread: 0, total: 0 });
    for (const l of USER_LABELS[key]) folders.push({ id: nextId(state, "folder"), accountId: acct.id, path: l, name: l, role: null, unread: 0, total: 0 });
  }
  return folders;
}

function toRecipient(r: SeedRecipient, sentAt: number): ReceiptRecipient {
  const counted = (r.opens ?? []).filter((o) => o.counted);
  return {
    email: r.who.address, name: r.who.name, status: r.status,
    firstOpenAt: counted[0] ? sentAt + counted[0].minsAfter * MIN : null,
    lastOpenAt: counted.length ? sentAt + counted[counted.length - 1]!.minsAfter * MIN : null,
    openCount: counted.length,
    repliedAt: r.repliedMinsAfter ? sentAt + r.repliedMinsAfter * MIN : null,
    note: r.note ?? null, possiblyForwarded: r.forwarded ?? false,
  };
}

export function registerTracked(state: MockState, accountId: string, threadId: number, subject: string, sentAt: number, seeds: SeedRecipient[]): number {
  const trackedId = nextId(state, "tracked");
  const recipients = seeds.map((r) => toRecipient(r, sentAt));
  const opened = recipients.filter((r) => r.status === "opened" || r.status === "replied").length;
  const status = recipients.every((r) => r.status === "replied") ? "replied" : opened > 0 ? "opened" : recipients.some((r) => r.status === "unknowable") ? "unknowable" : "sent";
  const events = seeds.flatMap((r) => (r.opens ?? []).map((o) => ({ at: sentAt + o.minsAfter * MIN, email: r.who.address, kind: o.kind, client: o.client, device: o.device, location: o.location, counted: o.counted })));
  events.sort((a, b) => a.at - b.at);
  const detail: ReceiptDetail = { trackedId, sentAt, recipients, events };
  state.receipts[trackedId] = detail;
  const last = events.filter((e) => e.counted).at(-1)?.at ?? null;
  const tm: TrackedMessage = { trackedId, accountId, threadId, subject, sentAt, summary: { opened, total: recipients.length, status, lastOpenAt: last }, recipients };
  state.tracked = [...state.tracked, tm];
  return trackedId;
}

function bodyHtml(m: SeedMsg, prev: { from: Address; date: number; html: string } | null): string {
  if (m.html) return m.html;
  let html = textToMailHtml(m.text);
  if (m.signature) html += `<div style="margin-top:12px">${SIGNATURES[m.signature]}</div>`;
  if (m.quote && prev) html += quoteBlock(prev.from, formatFullDate(prev.date), prev.html);
  return html;
}

function buildThread(state: MockState, seed: SeedThread, now: number, folderByName: Map<string, number>): MThread {
  const accountId = ACCOUNT_IDS[seed.acct];
  const me: Address = { name: ME_NAME, address: acctEmail(seed.acct) };
  const threadId = nextId(state, "thread");
  const msgs: MessageView[] = [];
  let prev: { from: Address; date: number; html: string } | null = null;
  seed.msgs.forEach((m, idx) => {
    const fromMe = m.from === "me";
    const from = fromMe ? me : (m.from as Address);
    const date = now - m.minsAgo * MIN;
    const html = bodyHtml(m, prev);
    const isLast = idx === seed.msgs.length - 1;
    const seen = m.seen ?? (fromMe ? true : !(seed.unread && isLast));
    const id = nextId(state, "message");
    const to = m.to ?? (fromMe ? [] : [me]);
    const view: MessageView = {
      id, accountId, threadId, messageId: `<m${id}@mock.flint>`, from: [from], to, cc: m.cc ?? [], bcc: [], replyTo: [],
      subject: idx === 0 ? seed.subject : `Re: ${seed.subject.replace(/^Re: /, "")}`, date, seen, pinned: false, isFromMe: fromMe,
      snippet: plainSnippet(m.text), html: m.textOnly ? null : html, text: m.text, bodyLoaded: true,
      remoteImages: m.remoteImages ?? "allowed", hasTrackers: m.hasTrackers ?? false,
      attachments: (m.attach ?? []).map((a) => ({ id: nextId(state, "attachment"), filename: a.filename, contentType: a.contentType, size: a.size, inline: a.inline ?? false, contentId: null })),
      unsubscribe: m.unsub ?? null, receipt: null,
    };
    if (m.track) {
      const tid = registerTracked(state, accountId, threadId, seed.subject, date, m.track);
      view.receipt = state.receipts[tid] ?? null;
    }
    msgs.push(view);
    prev = { from, date, html: m.html ?? textToMailHtml(m.text) };
  });
  const hasOthers = msgs.some((m) => !m.isFromMe);
  const location = seed.location ?? (hasOthers ? "inbox" : "sent");
  return {
    id: threadId, accountId, subject: seed.subject, category: seed.category ?? "people", pinned: seed.pinned ?? false, muted: seed.muted ?? false,
    snoozedUntil: null, resurfacedAt: null, location, blocked: seed.blocked ?? false, messages: msgs, draftIds: [],
    folderIds: (seed.labels ?? []).map((l) => folderByName.get(`${accountId}:${l}`)).filter((x): x is number => x !== undefined),
  };
}

function seedDrafts(state: MockState, now: number): void {
  const nw = ACCOUNT_IDS.northwind;
  const roadmap = state.threads.find((t) => t.subject.startsWith("Q4 roadmap"));
  const mkDraft = (d: Partial<Draft> & Pick<Draft, "subject" | "html" | "to">): Draft => ({
    id: nextId(state, "draft"), accountId: nw, from: ME.northwind, mode: "new", sourceMessageId: null, threadId: null, cc: [], bcc: [], quotedHtml: "",
    attachments: [], signatureId: 2, track: true, remindAt: null, createdBy: "user", updatedAt: now - 30 * MIN, ...d,
  });
  const fresh = mkDraft({ subject: "Ideas for the November offsite agenda", to: [PEOPLE.priya], html: "<p>Priya, a first pass at the agenda:</p><ul><li>Morning: roadmap</li><li>Afternoon: pairing sessions</li></ul>" });
  const freshThread: MThread = { id: nextId(state, "thread"), accountId: nw, subject: fresh.subject, category: "people", pinned: false, muted: false, snoozedUntil: null, resurfacedAt: null, location: "drafts", folderIds: [], blocked: false, messages: [], draftIds: [fresh.id] };
  fresh.threadId = freshThread.id;
  const drafts = [fresh];
  const threads = [freshThread];
  if (roadmap) {
    const src = roadmap.messages.at(-1)!;
    const reply = mkDraft({ mode: "reply", sourceMessageId: src.id, threadId: roadmap.id, subject: `Re: ${roadmap.subject}`, to: [PEOPLE.tomas], html: "<p>Yes, ten minutes on the pricing experiment is fine. I will trim the design section to make room.</p>", signatureId: 2 });
    drafts.push(reply);
    roadmap.draftIds = [reply.id];
  }
  state.drafts = drafts;
  state.threads = [...state.threads, ...threads];

  // Scheduled sends: one send-later, one agent send waiting for approval.
  const later = mkDraft({ subject: "Cycle 3 kickoff: agenda", to: [PEOPLE.carla, PEOPLE.rodney], html: "<p>Agenda for Monday: scope, milestones, risks.</p>" });
  const waiting = mkDraft({ subject: "Contract questions", to: [{ name: "Nina Castellanos", address: "nina@bluepine.example" }], html: "<p>Hi Nina, a few questions on the contract before we sign.</p>", createdBy: "claude-code", track: false });
  state.drafts = [...state.drafts, later, waiting];
  for (const d of [later, waiting]) {
    state.threads.push({ id: nextId(state, "thread"), accountId: nw, subject: d.subject, category: "people", pinned: false, muted: false, snoozedUntil: null, resurfacedAt: null, location: "drafts", folderIds: [], blocked: false, messages: [], draftIds: [d.id] });
  }
  const s1 = { id: nextId(state, "scheduled"), draftId: later.id, subject: later.subject, to: later.to, sendAt: now + 20 * 60 * MIN, status: "pending" as const, error: null, requestedBy: "user" };
  const s2 = { id: nextId(state, "scheduled"), draftId: waiting.id, subject: waiting.subject, to: waiting.to, sendAt: now + 2 * MIN, status: "awaiting_approval" as const, error: null, requestedBy: "claude-code" };
  state.scheduled = [s1, s2];
  state.activity = state.activity.map((a) => (a.status === "awaiting_approval" ? { ...a, detail: { ...a.detail, scheduledId: s2.id } } : a));
}

/** Builds the full initial mock state. Deterministic for a given `now` and `seed`. */
export function buildState(now: number, seed = 7): MockState {
  const rng = createRng(seed);
  const state: MockState = {
    accounts: makeAccounts(now), folders: [], threads: [], drafts: [], scheduled: [], signatures: makeSignatures(), templates: makeTemplates(), rules: makeRules(),
    blocked: [{ pattern: "outreach@growth-hacker.example", createdAt: now - 12 * DAY * MIN }, { pattern: "@bulk-deals.example", createdAt: now - 40 * DAY * MIN }],
    tracked: [], receipts: {}, activity: makeActivity(now), settings: defaultSettings(), ai: defaultAi(),
    sync: [], ids: {},
  };
  state.folders = buildFolders(state);
  state.sync = state.accounts.map((a) => ({ accountId: a.id, state: "idle", lastSyncAt: now - 40_000 }));
  const folderByName = new Map(state.folders.filter((f) => !f.role).map((f) => [`${f.accountId}:${f.name}`, f.id]));

  const seeds: SeedThread[] = [...HERO_THREADS, ...generateThreads(rng)];
  state.threads = seeds.map((s) => buildThread(state, s, now, folderByName));
  seedDrafts(state, now);
  return state;
}
