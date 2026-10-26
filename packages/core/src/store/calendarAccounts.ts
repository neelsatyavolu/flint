import { nanoid } from "nanoid";
import type { CalDavPreset } from "../types";
import { parseJson, type Sql } from "./sql";

/** What Flint remembers about one discovered CalDAV calendar. */
export type CalDavCalendarRef = { url: string; name: string };

/** A calendar_accounts row. The public shape (types.CalendarAccount) is derived from it; secrets are not here. */
export type StoredCalendarAccount = {
  id: string;
  kind: "google" | "caldav";
  name: string;
  email: string;
  extraAddresses: string[];
  /** Addresses the CalDAV server reported for the user (calendar-user-address-set). */
  discoveredAddresses: string[];
  preset: CalDavPreset | "custom" | null;
  serverUrl: string | null;
  username: string | null;
  principalUrl: string | null;
  homeUrl: string | null;
  outboxUrl: string | null;
  defaultCalendarUrl: string | null;
  defaultCalendarName: string | null;
  calendars: CalDavCalendarRef[];
  scheduling: boolean;
  status: "ok" | "needs-signin" | "error";
  statusMessage: string | null;
  sortOrder: number;
  createdAt: number;
};

type Row = {
  id: string; kind: string; name: string; email: string; extra_addresses: string; discovered_addresses: string; preset: string | null;
  server_url: string | null; username: string | null; principal_url: string | null; home_url: string | null; outbox_url: string | null;
  default_calendar_url: string | null; default_calendar_name: string | null; calendars_json: string; scheduling: number;
  status: string; status_message: string | null; sort_order: number; created_at: number;
};

const toAccount = (r: Row): StoredCalendarAccount => ({
  id: r.id, kind: r.kind as StoredCalendarAccount["kind"], name: r.name, email: r.email,
  extraAddresses: parseJson<string[]>(r.extra_addresses, []), discoveredAddresses: parseJson<string[]>(r.discovered_addresses, []),
  preset: r.preset as StoredCalendarAccount["preset"], serverUrl: r.server_url, username: r.username, principalUrl: r.principal_url,
  homeUrl: r.home_url, outboxUrl: r.outbox_url, defaultCalendarUrl: r.default_calendar_url, defaultCalendarName: r.default_calendar_name,
  calendars: parseJson<CalDavCalendarRef[]>(r.calendars_json, []), scheduling: r.scheduling === 1,
  status: r.status as StoredCalendarAccount["status"], statusMessage: r.status_message, sortOrder: r.sort_order, createdAt: r.created_at,
});

export type NewCalendarAccount = Omit<StoredCalendarAccount, "id" | "sortOrder" | "createdAt" | "status" | "statusMessage"> &
  Partial<Pick<StoredCalendarAccount, "id" | "createdAt" | "status" | "statusMessage">>;

export type CalendarAccountPatch = Partial<Omit<StoredCalendarAccount, "id" | "createdAt" | "kind">>;

const COLUMNS: Record<keyof CalendarAccountPatch, string> = {
  name: "name", email: "email", extraAddresses: "extra_addresses", discoveredAddresses: "discovered_addresses", preset: "preset",
  serverUrl: "server_url", username: "username", principalUrl: "principal_url", homeUrl: "home_url", outboxUrl: "outbox_url",
  defaultCalendarUrl: "default_calendar_url", defaultCalendarName: "default_calendar_name", calendars: "calendars_json",
  scheduling: "scheduling", status: "status", statusMessage: "status_message", sortOrder: "sort_order",
};

const lower = (list: readonly string[]): string[] => [...new Set(list.map((a) => a.trim().toLowerCase()).filter(Boolean))];

/** Calendar accounts added in Settings > Calendars (Google or CalDAV). Mail accounts with the calendar scope are not rows here. */
export class CalendarAccountsRepo {
  constructor(protected q: Sql) {}

  listCalendarAccountRows(): StoredCalendarAccount[] {
    return this.q.all<Row>("SELECT * FROM calendar_accounts ORDER BY sort_order, created_at").map(toAccount);
  }

  getCalendarAccountRow(id: string): StoredCalendarAccount | null {
    const r = this.q.get<Row>("SELECT * FROM calendar_accounts WHERE id = ?", id);
    return r ? toAccount(r) : null;
  }

  createCalendarAccountRow(input: NewCalendarAccount): StoredCalendarAccount {
    const id = input.id ?? `cal_${nanoid(10)}`;
    const sortOrder = this.q.get<{ n: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM calendar_accounts")?.n ?? 0;
    this.q.run(
      `INSERT INTO calendar_accounts (id, kind, name, email, extra_addresses, discovered_addresses, preset, server_url, username, principal_url, home_url,
         outbox_url, default_calendar_url, default_calendar_name, calendars_json, scheduling, status, status_message, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.kind, input.name, input.email.trim().toLowerCase(), JSON.stringify(lower(input.extraAddresses)), JSON.stringify(lower(input.discoveredAddresses)),
      input.preset, input.serverUrl, input.username, input.principalUrl, input.homeUrl, input.outboxUrl, input.defaultCalendarUrl,
      input.defaultCalendarName, JSON.stringify(input.calendars), input.scheduling ? 1 : 0, input.status ?? "ok", input.statusMessage ?? null,
      sortOrder, input.createdAt ?? Date.now(),
    );
    return this.getCalendarAccountRow(id)!;
  }

  updateCalendarAccountRow(id: string, patch: CalendarAccountPatch): StoredCalendarAccount | null {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof CalendarAccountPatch, unknown][]) {
      if (value === undefined) continue;
      sets.push(`${COLUMNS[key]} = ?`);
      if (key === "extraAddresses" || key === "discoveredAddresses") params.push(JSON.stringify(lower(value as string[])));
      else if (key === "calendars") params.push(JSON.stringify(value));
      else if (key === "scheduling") params.push(value ? 1 : 0);
      else if (key === "email") params.push((value as string).trim().toLowerCase());
      else params.push(value as string | number | null);
    }
    if (sets.length) this.q.run(`UPDATE calendar_accounts SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
    return this.getCalendarAccountRow(id);
  }

  deleteCalendarAccountRow(id: string): void {
    this.q.run("DELETE FROM calendar_accounts WHERE id = ?", id);
  }
}
