import type { ListResponse } from "imapflow";
import type { MailboxRole } from "../../types";

const SPECIAL_USE: Record<string, MailboxRole> = {
  "\\inbox": "inbox", "\\sent": "sent", "\\drafts": "drafts", "\\trash": "trash", "\\junk": "spam",
  "\\archive": "archive", "\\all": "all", "\\flagged": "flagged", "\\important": "important",
};

const NAME_ROLES: [RegExp, MailboxRole][] = [
  [/^(?:sent|sent items|sent mail|sent messages|gesendet|envoy[eé]s)$/i, "sent"],
  [/^(?:trash|deleted items|deleted messages|bin|corbeille|papierkorb)$/i, "trash"],
  [/^(?:junk|junk e-?mail|spam|bulk mail|junk mail)$/i, "spam"],
  [/^(?:drafts?|brouillons|entw[uü]rfe)$/i, "drafts"],
  [/^(?:archives?|all mail)$/i, "archive"],
];

/** Gmail's system namespace names the label even when LIST carries no (or a localized-only) special-use flag. */
const GMAIL_NAMESPACE_ROLES: [RegExp, MailboxRole][] = [
  [/^\[(?:gmail|google mail)\]\/(?:important|wichtig|importante|importants|importanti|belangrijk|wa[zż]ne)$/i, "important"],
  [/^\[(?:gmail|google mail)\]\/(?:starred|markiert mit stern|destacados|suivis|speciali|met ster|oznaczone gwiazdk[aą])$/i, "flagged"],
];

export type MailboxEntry = { path: string; name: string; delimiter: string; role: MailboxRole | null; specialUse: string | null };

/** Maps LIST output to folder entries with roles. Special-use flags win; name heuristics fill gaps. One folder per role. */
export function classifyMailboxes(list: ListResponse[]): MailboxEntry[] {
  const selectable = list.filter((m) => !m.flags.has("\\Noselect") && !m.flags.has("\\NonExistent"));
  const taken = new Set<MailboxRole>();
  const entries: MailboxEntry[] = selectable.map((m) => {
    const use = m.specialUse ?? null;
    let role: MailboxRole | null = use ? (SPECIAL_USE[use.toLowerCase()] ?? null) : null;
    if (m.path.toUpperCase() === "INBOX") role = "inbox";
    if (!role) role = GMAIL_NAMESPACE_ROLES.find(([re]) => re.test(m.path))?.[1] ?? null;
    if (role && role !== "inbox") taken.add(role);
    return { path: m.path, name: m.name, delimiter: m.delimiter, role, specialUse: use };
  });
  return entries.map((e) => {
    if (e.role) return e;
    const hit = NAME_ROLES.find(([re]) => re.test(e.name));
    if (hit && !taken.has(hit[1])) {
      taken.add(hit[1]);
      return { ...e, role: hit[1] };
    }
    return e;
  });
}

/** Gmail system labels that stand for a real folder. Starred and Important carry no folder membership. */
const GMAIL_SYSTEM: Record<string, MailboxRole | "skip"> = {
  "\\inbox": "inbox", "\\sent": "sent", "\\draft": "drafts", "\\drafts": "drafts", "\\spam": "spam", "\\trash": "trash",
  "\\starred": "skip", "\\important": "skip",
};

/** X-GM-LABELS to folder paths. System labels resolve through the account's role folders; user labels are their own path. */
export function gmailLabelPaths(labels: Iterable<string>, pathForRole: (role: MailboxRole) => string | null): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    if (label.startsWith("\\")) {
      const role = GMAIL_SYSTEM[label.toLowerCase()];
      if (!role || role === "skip") continue;
      const path = pathForRole(role);
      if (path) out.push(path);
      continue;
    }
    out.push(label);
  }
  return [...new Set(out)];
}
