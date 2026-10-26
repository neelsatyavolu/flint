import type { ImapFlow } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { logger } from "../log";
import { FlintError, type Account, type Provider } from "../types";
import { buildMime, newMessageId, type MimeInput } from "./compose";
import { smtpOptions, describeConnectError, type MailAuth } from "./connect";
import { withMailbox, type ImapRunner } from "./runner";

const log = logger("mail.send");

export type Smtp = Transporter<SMTPTransport.SentMessageInfo>;

export function createSmtp(account: Account, auth: MailAuth): Smtp {
  return createTransport(smtpOptions(account, auth));
}

export type Envelope = { from: string; to: string[] };

/** Sends a finished message over SMTP to exactly the envelope recipients. */
export async function sendMessage(transport: Smtp, mime: Buffer, envelope: Envelope): Promise<void> {
  if (envelope.to.length === 0) throw new FlintError("invalid", "Add at least one recipient.");
  try {
    await transport.sendMail({ envelope: { from: envelope.from, to: envelope.to }, raw: mime });
  } catch (error) {
    throw describeSendError(error);
  }
}

function describeSendError(error: unknown): FlintError {
  const e = error as { responseCode?: number; response?: string };
  if (e.responseCode && e.responseCode >= 500 && e.responseCode < 600 && e.responseCode !== 535) {
    return new FlintError("invalid", `The server refused the message${e.response ? `: ${e.response.slice(0, 120)}` : "."}`);
  }
  return describeConnectError(error, "SMTP");
}

// ---------- Sent folder fix-up ----------

export type SentFolders = {
  provider: Provider;
  /** Path of the Sent folder. When null the server's \Sent special-use folder is used. */
  sentPath: string | null;
  /** Gmail only: Trash path, used to really delete a server-saved copy. */
  trashPath?: string | null;
  /** Wait times between searches for a server-saved copy (Gmail files its own copy a moment after SMTP). */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

const sleepReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** APPEND. When the server refuses, create the folder (it may not exist yet) and try once more. */
async function appendCreating(c: ImapFlow, path: string, mime: Buffer, flags: string[]): Promise<Exclude<Awaited<ReturnType<ImapFlow["append"]>>, false>> {
  const attempt = async () => c.append(path, mime, flags).catch(() => false as const);
  const first = await attempt();
  if (first) return first;
  await c.mailboxCreate(path).catch(() => undefined);
  const second = await attempt();
  if (second) return second;
  throw new FlintError("network", "The server would not save the message.");
}

async function specialUsePath(runner: ImapRunner, use: string): Promise<string | null> {
  return runner.run(async (c) => (await c.list()).find((m) => m.specialUse === use)?.path ?? null);
}

/** How many of the newest messages to read envelopes of when the server's header search comes back empty. */
const ENVELOPE_SCAN = 50;

const bareId = (id: string | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

async function findUids(runner: ImapRunner, path: string, messageId: string): Promise<number[]> {
  return runner.run(async (c) => {
    if (!(await c.list()).some((m) => m.path === path)) return [];
    return withMailbox(c, path, async () => {
      const found = await c.search({ header: { "message-id": `<${messageId}>` } }, { uid: true });
      if (found && found.length > 0) return found;
      // Some servers (Proton Bridge) answer SEARCH HEADER with nothing: match the newest envelopes instead.
      const exists = c.mailbox ? c.mailbox.exists : 0;
      if (exists === 0) return [];
      const rows = await c.fetchAll(`${Math.max(1, exists - ENVELOPE_SCAN + 1)}:*`, { uid: true, envelope: true });
      const want = bareId(messageId);
      return (rows || []).filter((r) => bareId(r.envelope?.messageId) === want).map((r) => r.uid);
    }, true);
  });
}

async function deleteUids(runner: ImapRunner, path: string, uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  await runner.run((c) => withMailbox(c, path, async () => { await c.messageDelete(uids.join(","), { uid: true }); }));
}

/** True when a Gmail message also carries the Inbox label, i.e. it is the copy the user received (self or Bcc-self sends). */
async function gmailInboxCopies(runner: ImapRunner, path: string, uids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (uids.length === 0) return out;
  const rows = await runner.run((c) => withMailbox(c, path, () => c.fetchAll(uids.join(","), { uid: true, labels: true }, { uid: true }), true));
  for (const r of rows || []) {
    if ([...(r.labels ?? [])].some((l) => /^\\?inbox$/i.test(String(l)))) out.add(r.uid);
  }
  return out;
}

/** Removes server-saved copies. On Gmail, mail that also has the Inbox label is the user's received copy and is never deleted. */
async function removeServerCopies(runner: ImapRunner, folders: SentFolders, sentPath: string, found: number[], messageId: string): Promise<number[]> {
  if (found.length === 0) return [];
  const gmail = folders.provider === "gmail";
  const trash = gmail ? (folders.trashPath ?? (await specialUsePath(runner, "\\Trash"))) : null;
  if (!(gmail && trash)) {
    await deleteUids(runner, sentPath, found);
    return [];
  }
  const keep = await gmailInboxCopies(runner, sentPath, found);
  const doomed = found.filter((u) => !keep.has(u));
  if (doomed.length > 0) {
    // Gmail keeps expunged mail in All Mail; moving to Trash and deleting there removes it for good.
    const moved = await runner.run((c) => withMailbox(c, sentPath, async () => c.messageMove(doomed.join(","), trash, { uid: true })));
    const trashed = moved && moved.uidMap ? [...moved.uidMap.values()] : await findUids(runner, trash, messageId);
    await deleteUids(runner, trash, trashed);
  }
  return [...keep];
}

/**
 * Leaves exactly one clean copy of a sent message in Sent: finds copies by Message-ID (the server may have saved
 * one with a tracking pixel), deletes them, then APPENDs the clean copy with \Seen. A second search after the APPEND
 * removes a copy the server filed late. When serverCopyIsClean (nothing was tracked) the server's own copy is kept.
 * On Gmail a copy that is also in the Inbox (the user was a recipient) is never deleted and no second copy is appended.
 * Returns the UID of the copy that remains in Sent when known.
 */
export async function fileSentCopy(
  runner: ImapRunner, folders: SentFolders, messageId: string, cleanMime: Buffer, opts: { serverCopyIsClean?: boolean } = {},
): Promise<{ path: string; uid: number | null }> {
  const sentPath = folders.sentPath ?? (await specialUsePath(runner, "\\Sent"));
  if (!sentPath) throw new FlintError("not_found", "This account has no Sent folder to save the message in.");
  const gmail = folders.provider === "gmail";
  const delays = folders.delaysMs ?? (gmail ? [0, 1500, 4000] : [0]);
  const sleep = folders.sleep ?? sleepReal;

  let found: number[] = [];
  for (const wait of delays) {
    if (wait > 0) await sleep(wait);
    found = await findUids(runner, sentPath, messageId);
    if (found.length > 0) break;
  }
  if (opts.serverCopyIsClean && found.length > 0) return { path: sentPath, uid: found[0] ?? null };

  const kept = await removeServerCopies(runner, folders, sentPath, found, messageId);
  if (kept.length > 0) return { path: sentPath, uid: kept[0] ?? null };
  const appended = await runner.run((c) => appendCreating(c, sentPath, cleanMime, ["\\Seen"]));
  const ours = appended.uid ?? null;

  // Servers such as Exchange file their own copy a few seconds after SMTP. Look again and drop any copy that is not ours.
  // With the default schedule this runs in the background so sending does not wait for it; an explicit schedule runs inline.
  const recheck = async (): Promise<void> => {
    try {
      if (!folders.delaysMs) await sleep(2500);
      const late = (await findUids(runner, sentPath, messageId)).filter((u) => u !== ours);
      if (ours !== null && late.length > 0) await removeServerCopies(runner, folders, sentPath, late, messageId);
    } catch (error) {
      log.warn("sent copy re-check failed", { reason: (error as Error).message });
    }
  };
  if (folders.delaysMs) await recheck();
  else void recheck();
  return { path: sentPath, uid: ours };
}

// ---------- Tracked and untracked sends ----------

export type TrackedRecipient = { address: string; token: string };

export type SendInput = {
  message: MimeInput;
  folders: SentFolders;
  /** Runs the Sent fix-up. Without it the message is sent and nothing is filed. */
  runner?: ImapRunner;
};

export type SendTrackedInput = SendInput & {
  /** One copy each, with a pixel for the token. */
  tracked: TrackedRecipient[];
  /** Addresses that get the clean message together in one envelope (the user's own addresses, recipients without tracking). */
  untracked: string[];
  injectPixel: (html: string, token: string) => string;
};

export type SendOutcome = {
  messageId: string;
  /** SMTP transactions that succeeded. */
  copies: number;
  failed: { address: string; error: string }[];
  sent: { path: string; uid: number | null } | null;
};

async function fileCopy(input: SendInput, messageId: string, serverCopyIsClean = false): Promise<SendOutcome["sent"]> {
  if (!input.runner) return null;
  try {
    const clean = await buildMime({ ...input.message, messageId, keepBcc: true });
    return await fileSentCopy(input.runner, input.folders, messageId, clean, { serverCopyIsClean });
  } catch (error) {
    log.warn("could not file the sent copy", { reason: (error as Error).message });
    return null;
  }
}

export function allRecipients(m: Pick<MimeInput, "to" | "cc" | "bcc">): string[] {
  return [...new Set([...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])].map((a) => a.address.trim()).filter(Boolean))];
}

/** One message to everyone in a single envelope, then the Sent fix-up. */
export async function sendUntracked(transport: Smtp, input: SendInput): Promise<SendOutcome> {
  const messageId = input.message.messageId ?? newMessageId(input.message.from.address);
  const mime = await buildMime({ ...input.message, messageId, keepBcc: false });
  await sendMessage(transport, mime, { from: input.message.from.address, to: allRecipients(input.message) });
  return { messageId, copies: 1, failed: [], sent: await fileCopy(input, messageId, true) };
}

/**
 * Per-recipient copies for read receipts. Every copy has the same headers and Message-ID and no Bcc header;
 * only the envelope recipient and the pixel differ. The user's own and untracked recipients share one clean copy.
 */
export async function sendTracked(transport: Smtp, input: SendTrackedInput): Promise<SendOutcome> {
  if (input.tracked.length === 0 && input.untracked.length === 0) throw new FlintError("invalid", "Add at least one recipient.");
  const messageId = input.message.messageId ?? newMessageId(input.message.from.address);
  const from = input.message.from.address;
  const failed: SendOutcome["failed"] = [];
  let copies = 0;

  for (const r of input.tracked) {
    try {
      const mime = await buildMime({ ...input.message, messageId, html: input.injectPixel(input.message.html, r.token), text: input.message.text, keepBcc: false });
      await sendMessage(transport, mime, { from, to: [r.address] });
      copies += 1;
    } catch (error) {
      failed.push({ address: r.address, error: (error as Error).message });
    }
  }
  if (input.untracked.length > 0) {
    try {
      const mime = await buildMime({ ...input.message, messageId, keepBcc: false });
      await sendMessage(transport, mime, { from, to: input.untracked });
      copies += 1;
    } catch (error) {
      for (const address of input.untracked) failed.push({ address, error: (error as Error).message });
    }
  }
  if (copies === 0) throw new FlintError("network", failed[0]?.error ?? "The message could not be sent.");
  return { messageId, copies, failed, sent: await fileCopy(input, messageId, input.tracked.length === 0) };
}

// ---------- Server drafts ----------

/** Saves a draft to the server Drafts folder. Returns the new UID when the server reports it. */
export async function appendDraft(runner: ImapRunner, draftsPath: string, mime: Buffer): Promise<number | null> {
  const res = await runner.run((c) => appendCreating(c, draftsPath, mime, ["\\Draft", "\\Seen"]));
  return res.uid ?? null;
}

export async function deleteDraftByUid(runner: ImapRunner, draftsPath: string, uid: number): Promise<void> {
  await deleteUids(runner, draftsPath, [uid]);
}

/** UID of the copy of a draft in the server Drafts folder, found by Message-ID (null when the server has none). */
export async function findDraftUid(runner: ImapRunner, draftsPath: string, messageId: string): Promise<number | null> {
  return (await findUids(runner, draftsPath, messageId))[0] ?? null;
}

/** Appends the new copy first, then removes the previous one, so a failure never leaves the server with no draft. */
export async function replaceDraft(runner: ImapRunner, draftsPath: string, previousUid: number | null, mime: Buffer): Promise<number | null> {
  const uid = await appendDraft(runner, draftsPath, mime);
  if (previousUid !== null) await deleteDraftByUid(runner, draftsPath, previousUid).catch((e) => log.warn("old draft copy not removed", { reason: (e as Error).message }));
  return uid;
}
