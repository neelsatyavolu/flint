import type { AccountId, ImportSparkSignaturesInput, SparkSignatureOffer } from "@flint/core";

/** One Spark signature in the import sheet, with what the user has chosen so far. */
export type SparkRow = SparkSignatureOffer & {
  checked: boolean;
  /** The editable name; starts as the name Flint made from the signature. */
  label: string;
  /** Flint accounts that will use it by default. */
  defaults: AccountId[];
};

/** Everything starts selected, with Spark's own bindings. An account is the default of one signature only. */
export function toRows(offers: SparkSignatureOffer[]): SparkRow[] {
  const taken = new Set<AccountId>();
  return offers.map((o) => {
    const defaults = o.matches.map((m) => m.accountId).filter((id) => !taken.has(id));
    defaults.forEach((id) => taken.add(id));
    return { ...o, checked: true, label: o.name, defaults };
  });
}

export const patchRow = (rows: SparkRow[], sparkId: string, patch: Partial<Pick<SparkRow, "checked" | "label">>): SparkRow[] =>
  rows.map((r) => (r.sparkId === sparkId ? { ...r, ...patch } : r));

/** Turns an account's default on for one signature (taking it from any other) or off. */
export function toggleDefault(rows: SparkRow[], sparkId: string, accountId: AccountId): SparkRow[] {
  const turningOn = !rows.find((r) => r.sparkId === sparkId)?.defaults.includes(accountId);
  return rows.map((r) => {
    const others = r.defaults.filter((id) => id !== accountId);
    return { ...r, defaults: r.sparkId === sparkId && turningOn ? [...others, accountId] : others };
  });
}

export const selectedCount = (rows: SparkRow[]): number => rows.filter((r) => r.checked).length;

export function toImportInput(path: string, rows: SparkRow[]): ImportSparkSignaturesInput {
  return {
    path,
    items: rows.filter((r) => r.checked).map((r) => ({ sparkId: r.sparkId, name: r.label.trim() || r.name, setDefaultFor: r.defaults })),
  };
}

/** Emails of the accounts the import will make a default, in the order the sheet lists them. */
export function defaultEmails(rows: SparkRow[]): string[] {
  const emails = new Map<AccountId, string>();
  for (const r of rows.filter((x) => x.checked)) for (const m of r.matches) if (r.defaults.includes(m.accountId)) emails.set(m.accountId, m.email);
  return [...emails.values()];
}

/** The toast after an import: what was saved and which accounts got a default. */
export function importMessage(count: number, rows: SparkRow[]): string {
  const base = `Imported ${count} signature${count === 1 ? "" : "s"} from Spark`;
  const emails = defaultEmails(rows);
  if (emails.length === 0) return base;
  const list = emails.length === 1 ? emails[0]! : `${emails.slice(0, -1).join(", ")} and ${emails[emails.length - 1]}`;
  return `${base}. Set as the default for new mail and replies on ${list}.`;
}
