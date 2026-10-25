import type { Address } from "../types";

// A cheap second look at mail the heuristics filed as "people". It never changes
// a category; it only says whether a model should be asked. Replies and mail with
// no bulk signals are left alone, so the model sees as little as possible.

export type UncertainInput = {
  from: Address;
  subject: string;
  /** Start of the plain text. */
  text: string;
  headers: Record<string, string>;
  isReply: boolean;
  html: boolean;
};

const ROLE_LOCAL = /^(admissions?|admit|apply|application|registrar|financial-?aid|enroll(ment)?|alumni|office|events?|news|newsletter|hello|hi|info|team|contact|marketing|promo(tions)?|offers?|deals?|store|shop|sales|careers?|jobs?|recruit(ing|ment)?|communications?|campaign|mail|email|members?|community|rewards?|welcome|feedback|surveys?|outreach|engage(ment)?)([-_.+0-9].*)?$/i;
const SENDING_SUBDOMAIN = /^(mail|email|e|em|news|send|mg|t|go|info|updates?|campaign|marketing|bounce|reply)\d*$/i;
const BULK_TEXT = /\b(unsubscribe|view (this email )?in (your )?browser|manage (your )?(email )?preferences|update (your )?(email )?preferences|you (are|were) receiving this|privacy policy|all rights reserved)\b|©\s?\d{4}/i;
const BULK_SUBJECT = /\b(newsletter|webinar|sale|% off|discount|offer|deadline|last chance|don't miss|register now|apply now|join us|invitation|announcing|reminder:)\b|[!]{2,}/i;
const PERSON_NAME = /^\p{Lu}[\p{L}'.-]+(\s+\p{Lu}[\p{L}'.-]+){1,2}$/u;
const LINK = /https?:\/\//g;

/** Reasons to ask a model, or an empty list when the message looks like ordinary personal mail. */
export function uncertainSignals(m: UncertainInput): string[] {
  if (m.isReply || /^\s*(re|aw|sv):/i.test(m.subject)) return [];
  const signals: string[] = [];
  const [local = "", domain = ""] = m.from.address.toLowerCase().split("@");
  if (ROLE_LOCAL.test(local)) signals.push("role address");
  const sub = domain.split(".").slice(0, -2)[0];
  if (sub && SENDING_SUBDOMAIN.test(sub)) signals.push("sending subdomain");
  if (BULK_TEXT.test(m.text.slice(0, 3000)) || BULK_TEXT.test(m.text.slice(-1500))) signals.push("bulk footer");
  if (BULK_SUBJECT.test(m.subject)) signals.push("promotional subject");
  if ((m.text.match(LINK) ?? []).length >= 6) signals.push("many links");
  if (m.headers["list-unsubscribe"] || m.headers["list-id"]) signals.push("list headers");
  const name = m.from.name.trim();
  if (name && !PERSON_NAME.test(name) && !name.includes("@") && signals.length > 0) signals.push("organisation name");
  return signals;
}

export const isUncertain = (m: UncertainInput): boolean => uncertainSignals(m).length > 0;
