import type { FetchMessageObject, MessageAddressObject } from "imapflow";
import type { IngestMessage } from "../../store/types";
import type { Address } from "../../types";
import { hasRealAttachments, walkStructure } from "./bodystructure";
import { parseHeaders, parseReferences } from "./headers";

const toAddresses = (list: MessageAddressObject[] | undefined): Address[] =>
  (list ?? []).filter((a): a is MessageAddressObject & { address: string } => Boolean(a.address)).map((a) => ({ name: a.name ?? "", address: a.address }));

function dateOf(value: Date | string | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export type MapOptions = {
  gmail: boolean;
  /** Gmail only: turns X-GM-LABELS into folder paths. */
  labelPaths?: (labels: Set<string>) => string[];
  now: number;
};

/** One FETCH result to the store's ingest shape. */
export function toIngestMessage(m: FetchMessageObject, opts: MapOptions): IngestMessage {
  const env = m.envelope ?? {};
  const headers = parseHeaders(m.headers);
  const info = walkStructure(m.bodyStructure);
  const flags = m.flags ?? new Set<string>();
  const { references: refsHeader, ...selected } = headers;
  return {
    uid: m.uid,
    gmMsgid: opts.gmail && m.emailId ? String(m.emailId) : null,
    gmThrid: opts.gmail && m.threadId ? String(m.threadId) : null,
    ...(opts.gmail && m.labels && opts.labelPaths ? { gmLabels: opts.labelPaths(m.labels) } : {}),
    messageId: env.messageId ?? null,
    inReplyTo: env.inReplyTo ?? null,
    references: parseReferences(refsHeader),
    subject: env.subject ?? "",
    from: toAddresses(env.from),
    to: toAddresses(env.to),
    cc: toAddresses(env.cc),
    bcc: toAddresses(env.bcc),
    replyTo: toAddresses(env.replyTo),
    date: dateOf(env.date) ?? dateOf(m.internalDate) ?? opts.now,
    flags: { seen: flags.has("\\Seen"), flagged: flags.has("\\Flagged"), answered: flags.has("\\Answered"), draft: flags.has("\\Draft") },
    size: m.size ?? 0,
    hasAttachments: hasRealAttachments(info),
    headers: selected,
    attachments: info.attachments,
  };
}

export const flagsOf = (flags: Set<string> | undefined): { seen: boolean; flagged: boolean; answered: boolean; draft: boolean } => ({
  seen: Boolean(flags?.has("\\Seen")), flagged: Boolean(flags?.has("\\Flagged")), answered: Boolean(flags?.has("\\Answered")), draft: Boolean(flags?.has("\\Draft")),
});
