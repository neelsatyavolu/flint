// Text-level iCalendar edits for CalDAV: change only what must change and leave every other byte as the server sent it
// (line endings, folding, property order, VTIMEZONE, X- properties). ical.js would re-serialize the whole file.
import { resolveZone, wallIn, wallToEpoch, type Wall } from "./zones";

type Item = { phys: string[]; text: string; dirty: boolean };
export type Doc = { items: Item[]; eol: string };

export function parseDoc(ics: string): Doc {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const items: Item[] = [];
  for (const line of ics.split(eol)) {
    const last = items[items.length - 1];
    if (last && (line.startsWith(" ") || line.startsWith("\t"))) {
      last.phys.push(line);
      last.text += line.slice(1);
    } else items.push({ phys: [line], text: line, dirty: false });
  }
  return { items, eol };
}

const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** RFC 5545 folding: at most 75 octets per physical line, continuation lines start with one space. */
export function fold(text: string): string[] {
  if (utf8(text) <= 75) return [text];
  const out: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of text) {
    if (utf8(cur) + utf8(ch) > limit) { out.push(out.length ? ` ${cur}` : cur); cur = ""; limit = 74; }
    cur += ch;
  }
  out.push(out.length ? ` ${cur}` : cur);
  return out;
}

export function render(doc: Doc): string {
  return doc.items.map((i) => (i.dirty ? fold(i.text) : i.phys).join(doc.eol)).join(doc.eol);
}

/** Index of the ":" that ends the name and parameters (quotes in parameter values are respected). */
function colon(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) return i;
  }
  return -1;
}

export type Prop = { name: string; params: string; value: string };

export function propOf(item: Item): Prop | null {
  const i = colon(item.text);
  if (i < 0) return null;
  const head = item.text.slice(0, i);
  const semi = head.indexOf(";");
  return { name: (semi < 0 ? head : head.slice(0, semi)).toUpperCase(), params: semi < 0 ? "" : head.slice(semi), value: item.text.slice(i + 1) };
}

const param = (params: string, name: string): string | null => {
  const m = new RegExp(`;${name}=("([^"]*)"|[^;:]*)`, "i").exec(params);
  return m ? (m[2] ?? m[1] ?? "") : null;
};

/** A VEVENT: the item range [begin, end] (indexes of BEGIN and END lines) and its direct properties. */
export type EventBlock = { begin: number; end: number; props: { index: number; prop: Prop }[] };

export function events(doc: Doc): EventBlock[] {
  const out: EventBlock[] = [];
  let cur: EventBlock | null = null;
  let depth = 0;
  doc.items.forEach((item, index) => {
    const p = propOf(item);
    if (!p) return;
    if (p.name === "BEGIN") {
      if (cur) depth++;
      else if (p.value.toUpperCase() === "VEVENT") cur = { begin: index, end: index, props: [] };
    } else if (p.name === "END") {
      if (cur && depth > 0) depth--;
      else if (cur && p.value.toUpperCase() === "VEVENT") { cur.end = index; out.push(cur); cur = null; }
    } else if (cur && depth === 0) cur.props.push({ index, prop: p });
  });
  return out;
}

const first = (b: EventBlock, name: string): Prop | undefined => b.props.find((x) => x.prop.name === name)?.prop;

/** Epoch ms of a DTSTART/DTEND/RECURRENCE-ID style property. Date values are 00:00 UTC; floating times use `floatingZone`. */
export function momentOf(p: Prop | undefined, floatingZone = "UTC"): { epoch: number; dateOnly: boolean } | null {
  if (!p) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const wall: Wall = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) };
  if (m[4] === undefined || /VALUE=DATE(?!-)/i.test(p.params)) return { epoch: Date.UTC(wall.year, wall.month - 1, wall.day), dateOnly: true };
  if (m[7]) return { epoch: wallToEpoch(wall, "UTC"), dateOnly: false };
  const zone = resolveZone(param(p.params, "TZID")) ?? floatingZone;
  return { epoch: wallToEpoch(wall, zone), dateOnly: false };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
const stamp = (w: Wall): string => `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;

/** Renders an instant the way `like` writes its values (same TZID, UTC "Z" or a plain date). */
function formatLike(epoch: number, like: Prop): string {
  const old = like.value.trim();
  if (!old.includes("T") || /VALUE=DATE(?!-)/i.test(like.params)) {
    const d = new Date(epoch);
    return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  if (old.endsWith("Z")) return `${stamp(wallIn(epoch, "UTC"))}Z`;
  return stamp(wallIn(epoch, resolveZone(param(like.params, "TZID")) ?? "UTC"));
}

export type PartstatWord = "ACCEPTED" | "TENTATIVE" | "DECLINED";
export type PartstatResult =
  | { status: "updated"; ics: string; previous: string | null; address: string }
  | { status: "unchanged"; ics: string; address: string }
  | { status: "no-attendee" }
  | { status: "no-occurrence" };

const mailto = (value: string): string => value.trim().replace(/^mailto:/i, "").toLowerCase();

/** Sets PARTSTAT on the first ATTENDEE of an event block that is one of `addresses`. */
function setOnBlock(doc: Doc, block: EventBlock, addresses: ReadonlySet<string>, partstat: PartstatWord): { outcome: "updated" | "unchanged"; address: string; previous: string | null } | null {
  const hit = block.props.find((x) => x.prop.name === "ATTENDEE" && addresses.has(mailto(x.prop.value)));
  if (!hit) return null;
  const item = doc.items[hit.index]!;
  const have = param(hit.prop.params, "PARTSTAT");
  const found = { address: mailto(hit.prop.value), previous: have };
  if (have?.toUpperCase() === partstat) return { outcome: "unchanged", ...found };
  const head = item.text.slice(0, item.text.length - hit.prop.value.length - 1);
  const nextHead = have === null ? `${head};PARTSTAT=${partstat}` : head.replace(/;PARTSTAT=[^;:]*/i, `;PARTSTAT=${partstat}`);
  item.text = `${nextHead}:${hit.prop.value}`;
  item.dirty = true;
  return { outcome: "updated", ...found };
}

/** Duration (ms) of the series master, from DTEND or DURATION; null when neither parses. */
function masterDuration(b: EventBlock, zone: string): number | null {
  const start = momentOf(first(b, "DTSTART"), zone);
  const end = momentOf(first(b, "DTEND"), zone);
  if (start && end) return end.epoch - start.epoch;
  const d = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(first(b, "DURATION")?.value.trim() ?? "");
  if (!d) return start?.dateOnly ? 86_400_000 : start ? 0 : null;
  return ((+(d[1] ?? 0) * 7 + +(d[2] ?? 0)) * 86_400 + +(d[3] ?? 0) * 3600 + +(d[4] ?? 0) * 60 + +(d[5] ?? 0)) * 1000;
}

/** Clones the series master as the override for one occurrence (RECURRENCE-ID), inserted after the master. */
function addOverride(doc: Doc, master: EventBlock, occurrence: number): EventBlock | null {
  const dtstart = first(master, "DTSTART");
  const startMoment = momentOf(dtstart);
  const duration = masterDuration(master, "UTC");
  if (!dtstart || !startMoment || duration === null) return null;
  const dtend = first(master, "DTEND");
  const skip = new Set(["RRULE", "EXDATE", "RDATE", "RECURRENCE-ID", "EXRULE", "DTSTART", "DTEND"]);
  const lines: Item[] = [];
  const keep = (text: string): void => { lines.push({ phys: [text], text, dirty: true }); };
  keep("BEGIN:VEVENT");
  for (let i = master.begin + 1; i < master.end; i++) {
    const item = doc.items[i]!;
    const p = propOf(item);
    if (!p || !skip.has(p.name)) lines.push({ phys: [...item.phys], text: item.text, dirty: false }); // a nested VALARM stays too
  }
  const at = lines.findIndex((l) => propOf(l)?.name === "UID");
  const extra = [`RECURRENCE-ID${dtstart.params}:${formatLike(occurrence, dtstart)}`, `DTSTART${dtstart.params}:${formatLike(occurrence, dtstart)}`];
  if (dtend) extra.push(`DTEND${dtend.params}:${formatLike(occurrence + duration, dtend)}`);
  lines.splice(at < 0 ? 1 : at + 1, 0, ...extra.map((text) => ({ phys: [text], text, dirty: true })));
  keep("END:VEVENT");
  doc.items.splice(master.end + 1, 0, ...lines);
  return events(doc).find((b) => b.begin === master.end + 1) ?? null;
}

/**
 * Sets the PARTSTAT of the user's ATTENDEE entry in one event of an .ics resource. `recurrenceId` is Flint's key (UTC
 * "20261027T150000Z", or a date for all-day); null answers the whole event or series. When one occurrence is asked for and
 * the resource holds only the series master, an override for that occurrence is added.
 */
export function setPartstat(ics: string, o: { recurrenceId: string | null; addresses: readonly string[]; partstat: PartstatWord }): PartstatResult {
  const doc = parseDoc(ics);
  const addresses = new Set(o.addresses.map((a) => a.toLowerCase()));
  const all = events(doc);
  let target: EventBlock | undefined;
  if (o.recurrenceId === null) target = all.find((b) => !first(b, "RECURRENCE-ID")) ?? (all.length === 1 ? all[0] : undefined);
  else {
    const key = recurrenceKeyEpoch(o.recurrenceId);
    target = all.find((b) => {
      const m = momentOf(first(b, "RECURRENCE-ID"));
      return m !== null && key !== null && m.epoch === key;
    });
    if (!target) {
      const master = all.find((b) => !first(b, "RECURRENCE-ID") && first(b, "RRULE"));
      if (master && key !== null) target = addOverride(doc, master, key) ?? undefined;
    }
  }
  if (!target) return { status: "no-occurrence" };
  // Answering a whole series: every VEVENT of the resource (master and moved instances) carries the user's ATTENDEE line.
  const targets = o.recurrenceId === null ? all.filter((b) => b === target || b.props.some((x) => x.prop.name === "ATTENDEE")) : [target];
  const results = targets.map((b) => setOnBlock(doc, b, addresses, o.partstat)).filter((r) => r !== null);
  const done = results.find((r) => r.outcome === "updated") ?? results[0];
  if (!done) return { status: "no-attendee" };
  const out = render(doc);
  return done.outcome === "unchanged" && out === ics ? { status: "unchanged", ics, address: done.address } : { status: "updated", ics: out, previous: done.previous, address: done.address };
}

/** Flint's recurrence key ("20261027T150000Z" or "20261027") as an epoch. */
export function recurrenceKeyEpoch(key: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(key.trim());
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : null;
}

/** Drops the iTIP METHOD line: a calendar resource must not carry one (RFC 4791 section 4.1). */
export function stripMethod(ics: string): string {
  const doc = parseDoc(ics);
  doc.items = doc.items.filter((i) => propOf(i)?.name !== "METHOD");
  return render(doc);
}

const UNSAFE_PROPS = /^(ATTACH|X-APPLE-[A-Z-]+|X-WR-ALARMUID|X-MOZ-[A-Z-]+|X-EVOLUTION-ALARM-UID)$/;

/**
 * A sender's invitation made safe to store in the user's calendar: no alarms (a VALARM can run AUDIO, PROCEDURE or EMAIL
 * actions and syncs to every device), no attachments, no vendor properties. Everything else stays as sent.
 */
export function sanitizeForImport(ics: string): string {
  const doc = parseDoc(ics);
  const kept: Item[] = [];
  let alarm = 0;
  for (const item of doc.items) {
    const p = propOf(item);
    if (p?.name === "BEGIN" && p.value.toUpperCase() === "VALARM") { alarm++; continue; }
    if (p?.name === "END" && p.value.toUpperCase() === "VALARM" && alarm > 0) { alarm--; continue; }
    if (alarm > 0 || (p && UNSAFE_PROPS.test(p.name))) continue;
    kept.push(item);
  }
  doc.items = kept;
  return render(doc);
}

/** True when the resource has a VEVENT with this UID (guards against a server returning the wrong file). */
export function hasUid(ics: string, uid: string): boolean {
  return events(parseDoc(ics)).some((b) => first(b, "UID")?.value.trim() === uid);
}

export type SimpleEvent = {
  uid: string; title: string; start: number; end: number; allDay: boolean; status: string; transparent: boolean;
  selfDeclined: boolean; recurring: boolean; recurrenceOverride: boolean;
};

const unescapeText = (s: string): string => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");

/** What a conflict check needs from each VEVENT of a resource (the server expands recurrences in the query). */
export function simpleEvents(ics: string, selfAddresses: readonly string[], floatingZone = "UTC"): SimpleEvent[] {
  const doc = parseDoc(ics);
  const own = new Set(selfAddresses.map((a) => a.toLowerCase()));
  const out: SimpleEvent[] = [];
  for (const b of events(doc)) {
    const start = momentOf(first(b, "DTSTART"), floatingZone);
    if (!start) continue;
    const end = momentOf(first(b, "DTEND"), floatingZone);
    const duration = end ? end.epoch - start.epoch : masterDuration(b, floatingZone) ?? 0;
    const self = b.props.find((x) => x.prop.name === "ATTENDEE" && own.has(mailto(x.prop.value)))?.prop;
    out.push({
      uid: first(b, "UID")?.value.trim() ?? "", title: unescapeText(first(b, "SUMMARY")?.value ?? "").trim() || "(No title)",
      start: start.epoch, end: start.epoch + Math.max(0, duration), allDay: start.dateOnly,
      status: (first(b, "STATUS")?.value ?? "").trim().toUpperCase(), transparent: (first(b, "TRANSP")?.value ?? "").trim().toUpperCase() === "TRANSPARENT",
      selfDeclined: (param(self?.params ?? "", "PARTSTAT") ?? "").toUpperCase() === "DECLINED",
      recurring: Boolean(first(b, "RRULE")), recurrenceOverride: Boolean(first(b, "RECURRENCE-ID")),
    });
  }
  return out;
}
