// Video-call detection and description cleanup for invitations. Pure string work.
import type { ConferenceKind, InviteConference } from "../types";

const URL_END = String.raw`[^\s<>"')\]]*`;
const PATTERNS: { kind: Exclude<ConferenceKind, "other">; label: string; re: RegExp }[] = [
  { kind: "meet", label: "Google Meet", re: new RegExp(String.raw`https?://meet\.google\.com/(?:lookup/)?[a-z0-9_-]+${URL_END}`, "i") },
  { kind: "zoom", label: "Zoom", re: new RegExp(String.raw`https?://[\w.-]*zoom\.(?:us|com|com\.cn)/(?:j|my|s|w|wc/join)/${URL_END}`, "i") },
  { kind: "teams", label: "Microsoft Teams", re: new RegExp(String.raw`https?://teams\.(?:microsoft|live)\.com/(?:l/meetup-join|meet|meetup-join)/${URL_END}`, "i") },
  { kind: "webex", label: "Webex", re: new RegExp(String.raw`https?://[\w.-]*webex\.com/(?:[\w.-]+/)*(?:meet|join|j\.php|webappng)${URL_END}`, "i") },
];

// Left-to-right / pop-direction marks Google wraps around phone numbers and PINs.
// eslint-disable-next-line no-misleading-character-class
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

const trimUrl = (u: string): string => u.replace(/[.,;:!?]+$/, "");

function matchKnown(text: string): { kind: Exclude<ConferenceKind, "other">; label: string; url: string } | null {
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) return { kind: p.kind, label: p.label, url: trimUrl(m[0]) };
  }
  return null;
}

function codeFor(kind: ConferenceKind, url: string, description: string): string | null {
  if (kind === "meet") {
    const m = /meet\.google\.com\/(?:lookup\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i.exec(url);
    return m ? m[1]!.toLowerCase() : null;
  }
  if (kind === "zoom") {
    const fromText = /meeting id:?\s*([\d ]{9,15})/i.exec(description)?.[1]?.trim();
    return fromText ?? /\/j\/(\d{9,11})/.exec(url)?.[1] ?? null;
  }
  if (kind === "teams") return /meeting id:?\s*([\d ]{9,20})/i.exec(description)?.[1]?.trim() ?? null;
  if (kind === "webex") return /(?:meeting number|access code)(?: \(access code\))?:?\s*([\d ]{8,15})/i.exec(description)?.[1]?.trim() ?? null;
  return null;
}

const PHONE_CUES = [/dial by your location/i, /join by phone/i, /dial[- ]?in/i, /one tap mobile/i, /phone numbers?/i, /tap to call/i];

function phoneFrom(description: string): string | null {
  const text = description.replace(BIDI, "");
  for (const cue of PHONE_CUES) {
    const at = cue.exec(text);
    const m = at ? /(\+\d[\d\s().-]{6,}\d)/.exec(text.slice(at.index)) : null;
    if (m) return m[1]!.replace(/\s+/g, " ").trim();
  }
  const us = /\((?:US|UK|CA|AU|DE|FR|IN)\)\s*(\+\d[\d\s().-]{6,}\d)/.exec(text);
  return us ? us[1]!.replace(/\s+/g, " ").trim() : null;
}

export type ConferenceSources = {
  /** X-GOOGLE-CONFERENCE */
  googleConference?: string | null;
  /** X-MICROSOFT-SKYPETEAMSMEETINGURL, X-MICROSOFT-ONLINEMEETINGEXTERNALLINK and similar. */
  vendorUrls?: (string | null | undefined)[];
  location?: string | null;
  url?: string | null;
  description?: string | null;
};

/** The video call an invitation points at: explicit properties first, then LOCATION, URL and DESCRIPTION. */
export function findConference(src: ConferenceSources): InviteConference | null {
  const description = (src.description ?? "").replace(BIDI, "");
  const candidates = [src.googleConference, ...(src.vendorUrls ?? []), src.location, src.url, description];
  for (const text of candidates) {
    if (!text) continue;
    const known = matchKnown(text);
    if (known) return { kind: known.kind, url: known.url, label: known.label, code: codeFor(known.kind, known.url, description), phone: phoneFrom(description) };
  }
  // An explicit conference URL we do not recognize, or a location that is just a link.
  for (const text of [src.googleConference, ...(src.vendorUrls ?? []), src.location]) {
    const m = text ? /^\s*(https?:\/\/\S+)\s*$/i.exec(text) : null;
    if (!m) continue;
    const url = trimUrl(m[1]!);
    let host = url;
    try { host = new URL(url).host.replace(/^www\./, ""); } catch { /* keep raw */ }
    return { kind: "other", url, label: host, code: null, phone: phoneFrom(description) };
  }
  return null;
}

const DROP_LINES: RegExp[] = [
  /^invitation from google calendar/i, /^you are receiving this (email|message)/i, /^to stop receiving these emails/i,
  /^forwarding this invitation/i, /^reply for\b/i, /^view all event details/i, /^join with google meet/i, /^join: ?https?:/i,
  /^meeting link:?/i, /^join by phone/i, /^more phone numbers/i, /^pin:/i, /^learn more about meet/i, /^please do not edit this section/i,
  /^learn more$/i, /^this event has a video call\.?$/i, /^join the meeting now$/i, /^\(?(?:us|uk|ca|au|de|fr|in)\)?\s*\+\d/i,
];

/** Removes every line between two marker lines (markers included) when `keep` does not say the region holds real text. */
function dropRegions(lines: string[], isMarker: (l: string) => boolean, isBoilerplate: (region: string[]) => boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarker(lines[i]!)) { out.push(lines[i]!); continue; }
    const close = lines.findIndex((l, j) => j > i && isMarker(l));
    const region = close === -1 ? lines.slice(i) : lines.slice(i, close + 1);
    if (isBoilerplate(region)) { i += region.length - 1; continue; }
    out.push(lines[i]!);
  }
  return out;
}

/**
 * Plain description text with the generated boilerplate removed: Google's "Invitation from Google Calendar" footer and
 * "-::~" join block, Teams' underscore-ruled join block, Zoom's join details, and lines that are only a call link.
 * Returns null when nothing meaningful is left.
 */
export function cleanDescription(raw: string | null | undefined, conferenceUrl?: string | null): string | null {
  if (!raw) return null;
  let text = raw.replace(BIDI, "").replace(/\r\n?/g, "\n").replace(/<br\s*\/?>/gi, "\n");
  const zoom = /\n?\s*Join Zoom Meeting\b/i.exec(text);
  if (zoom) {
    text = text.slice(0, zoom.index);
    text = text.split("\n").filter((l) => !/(inviting you to a scheduled zoom meeting|^\s*topic:|^\s*time:|^\s*hi there,?\s*$)/i.test(l)).join("\n");
  }
  let lines = text.split("\n");
  lines = dropRegions(lines, (l) => /^-::~/.test(l.trim()), () => true);
  lines = dropRegions(lines, (l) => /^_{20,}\s*$/.test(l.trim()), (r) => /microsoft teams|join (the )?meeting|meeting id|need help|webex/i.test(r.join("\n")));
  const webex = lines.findIndex((l) => /^join from the meeting link|^join meeting$|^join from a video (conferencing )?system/i.test(l.trim()));
  if (webex !== -1) lines = lines.slice(0, webex);
  lines = lines.filter((l) => {
    const t = l.trim();
    if (!t) return true;
    if (DROP_LINES.some((re) => re.test(t))) return false;
    if (conferenceUrl && t.replace(/[<>]/g, "") === conferenceUrl) return false;
    return !(/^https?:\/\/\S+$/i.test(t) && matchKnown(t));
  });
  const cleaned = lines.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || null;
}
