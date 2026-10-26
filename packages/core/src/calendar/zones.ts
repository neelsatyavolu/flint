// Time zone helpers for the invite parser: Windows (Outlook/Exchange) zone names to IANA, and wall-clock time in a zone
// to an instant, using the platform's Intl data. Pure and synchronous.

/** Windows zone name (CLDR windowsZones, primary territory) to IANA. Names are matched case-insensitively. */
const WINDOWS_TO_IANA: Record<string, string> = {
  "dateline standard time": "Etc/GMT+12", "utc-11": "Etc/GMT+11", "hawaiian standard time": "Pacific/Honolulu",
  "alaskan standard time": "America/Anchorage", "pacific standard time": "America/Los_Angeles",
  "pacific standard time (mexico)": "America/Tijuana", "us mountain standard time": "America/Phoenix",
  "mountain standard time": "America/Denver", "mountain standard time (mexico)": "America/Mazatlan",
  "central standard time": "America/Chicago", "central standard time (mexico)": "America/Mexico_City",
  "canada central standard time": "America/Regina", "central america standard time": "America/Guatemala",
  "eastern standard time": "America/New_York", "us eastern standard time": "America/Indianapolis",
  "sa pacific standard time": "America/Bogota", "venezuela standard time": "America/Caracas",
  "atlantic standard time": "America/Halifax", "paraguay standard time": "America/Asuncion",
  "sa western standard time": "America/La_Paz", "newfoundland standard time": "America/St_Johns",
  "e. south america standard time": "America/Sao_Paulo", "argentina standard time": "America/Argentina/Buenos_Aires",
  "sa eastern standard time": "America/Cayenne", "greenland standard time": "America/Godthab",
  "montevideo standard time": "America/Montevideo", "pacific sa standard time": "America/Santiago",
  "mid-atlantic standard time": "Etc/GMT+2", "azores standard time": "Atlantic/Azores", "cape verde standard time": "Atlantic/Cape_Verde",
  "utc": "UTC", "gmt standard time": "Europe/London", "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin", "central europe standard time": "Europe/Budapest",
  "romance standard time": "Europe/Paris", "central european standard time": "Europe/Warsaw",
  "w. central africa standard time": "Africa/Lagos", "namibia standard time": "Africa/Windhoek",
  "jordan standard time": "Asia/Amman", "gtb standard time": "Europe/Bucharest", "middle east standard time": "Asia/Beirut",
  "egypt standard time": "Africa/Cairo", "e. europe standard time": "Europe/Chisinau", "syria standard time": "Asia/Damascus",
  "south africa standard time": "Africa/Johannesburg", "fle standard time": "Europe/Kiev", "israel standard time": "Asia/Jerusalem",
  "turkey standard time": "Europe/Istanbul", "arabic standard time": "Asia/Baghdad", "arab standard time": "Asia/Riyadh",
  "russian standard time": "Europe/Moscow", "e. africa standard time": "Africa/Nairobi", "iran standard time": "Asia/Tehran",
  "arabian standard time": "Asia/Dubai", "azerbaijan standard time": "Asia/Baku", "mauritius standard time": "Indian/Mauritius",
  "georgian standard time": "Asia/Tbilisi", "caucasus standard time": "Asia/Yerevan", "afghanistan standard time": "Asia/Kabul",
  "west asia standard time": "Asia/Tashkent", "pakistan standard time": "Asia/Karachi", "india standard time": "Asia/Calcutta",
  "sri lanka standard time": "Asia/Colombo", "nepal standard time": "Asia/Katmandu", "central asia standard time": "Asia/Almaty",
  "bangladesh standard time": "Asia/Dhaka", "myanmar standard time": "Asia/Rangoon", "se asia standard time": "Asia/Bangkok",
  "n. central asia standard time": "Asia/Novosibirsk", "china standard time": "Asia/Shanghai", "singapore standard time": "Asia/Singapore",
  "w. australia standard time": "Australia/Perth", "taipei standard time": "Asia/Taipei", "ulaanbaatar standard time": "Asia/Ulaanbaatar",
  "north asia east standard time": "Asia/Irkutsk", "tokyo standard time": "Asia/Tokyo", "korea standard time": "Asia/Seoul",
  "yakutsk standard time": "Asia/Yakutsk", "cen. australia standard time": "Australia/Adelaide", "aus central standard time": "Australia/Darwin",
  "e. australia standard time": "Australia/Brisbane", "aus eastern standard time": "Australia/Sydney",
  "west pacific standard time": "Pacific/Port_Moresby", "tasmania standard time": "Australia/Hobart",
  "vladivostok standard time": "Asia/Vladivostok", "central pacific standard time": "Pacific/Guadalcanal",
  "new zealand standard time": "Pacific/Auckland", "fiji standard time": "Pacific/Fiji", "tonga standard time": "Pacific/Tongatapu",
  "samoa standard time": "Pacific/Apia", "morocco standard time": "Africa/Casablanca", "haiti standard time": "America/Port-au-Prince",
  "cuba standard time": "America/Havana", "turks and caicos standard time": "America/Grand_Turk", "yukon standard time": "America/Whitehorse",
  "kaliningrad standard time": "Europe/Kaliningrad", "belarus standard time": "Europe/Minsk", "libya standard time": "Africa/Tripoli",
  "sudan standard time": "Africa/Khartoum", "line islands standard time": "Pacific/Kiritimati", "chatham islands standard time": "Pacific/Chatham",
};

const isValidZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

const zoneCache = new Map<string, string | null>();

/**
 * Maps a TZID to an IANA zone name, or null when it is not one we can resolve (a custom VTIMEZONE name such as
 * "Customized Time Zone", or floating). Handles IANA names, Windows names, a "/vendor/20050126_1/America/New_York" prefix
 * and Outlook's "(UTC-08:00) Pacific Time (US & Canada)" display names.
 */
export function resolveZone(tzid: string | null | undefined): string | null {
  const raw = (tzid ?? "").trim().replace(/^"|"$/g, "");
  if (!raw) return null;
  if (zoneCache.has(raw)) return zoneCache.get(raw)!;
  const found = lookup(raw);
  zoneCache.set(raw, found);
  return found;
}

function lookup(raw: string): string | null {
  if (/^(utc|gmt|z)$/i.test(raw)) return "UTC";
  const windows = WINDOWS_TO_IANA[raw.toLowerCase()];
  if (windows) return windows;
  if (raw.includes("/") && isValidZone(raw)) return raw;
  if (raw.includes("/")) {
    const segs = raw.split("/").filter(Boolean);
    for (const n of [3, 2]) {
      const candidate = segs.slice(-n).join("/");
      if (segs.length >= n && isValidZone(candidate)) return candidate;
    }
  }
  // "(UTC-08:00) Pacific Time (US & Canada)" or "Pacific Standard Time (US)": try the part after the offset as a Windows name.
  const display = /^\(UTC[+-]\d\d:\d\d\)\s*(.+)$/i.exec(raw)?.[1];
  if (display) {
    const lower = display.toLowerCase();
    if (/pacific time \(us/.test(lower)) return "America/Los_Angeles";
    if (/mountain time \(us/.test(lower)) return "America/Denver";
    if (/central time \(us/.test(lower)) return "America/Chicago";
    if (/eastern time \(us/.test(lower)) return "America/New_York";
    if (/london|dublin|lisbon/.test(lower)) return "Europe/London";
    if (/amsterdam|berlin|rome|stockholm|vienna/.test(lower)) return "Europe/Berlin";
    if (/paris|madrid|brussels|copenhagen/.test(lower)) return "Europe/Paris";
    if (/chennai|kolkata|mumbai|new delhi/.test(lower)) return "Asia/Calcutta";
    if (/tokyo|osaka|sapporo/.test(lower)) return "Asia/Tokyo";
    if (/sydney|canberra|melbourne/.test(lower)) return "Australia/Sydney";
  }
  return null;
}

/** The local zone of this machine, or UTC when it cannot be told. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = partsFormat.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    partsFormat.set(zone, f);
  }
  return f;
}

export type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The wall clock reading of an instant in a zone. */
export function wallIn(epoch: number, zone: string): Wall {
  const out: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(new Date(epoch))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { year: out["year"]!, month: out["month"]!, day: out["day"]!, hour: out["hour"]! % 24, minute: out["minute"]!, second: out["second"]! };
}

const asUtc = (w: Wall): number => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** Offset (ms, east positive) of a zone at an instant. */
export function offsetAt(epoch: number, zone: string): number {
  return asUtc(wallIn(epoch, zone)) - Math.floor(epoch / 1000) * 1000;
}

/**
 * The instant at which a zone's wall clock reads `wall`. In a spring-forward gap the time moves forward by the gap (what
 * calendars do); in a fall-back overlap the earlier of the two instants is used.
 */
export function wallToEpoch(wall: Wall, zone: string): number {
  if (zone === "UTC") return asUtc(wall);
  const guess = asUtc(wall);
  const first = guess - offsetAt(guess, zone);
  const second = guess - offsetAt(first, zone);
  if (second === first) {
    // Overlap check: an earlier instant may show the same wall time (fall back).
    const earlier = guess - offsetAt(first - 3_600_000, zone);
    return earlier < first && asUtc(wallIn(earlier, zone)) === guess ? earlier : first;
  }
  // Gap or offset change: pick the instant that maps back to the wall time when one exists.
  return asUtc(wallIn(second, zone)) === guess ? second : Math.max(first, second);
}
