import type { Folder, MailboxRole } from "../types";

/** Roles that duplicate another view: All Mail is the archive, Important and Starred are flags on mail already in the inbox. */
const HIDDEN_ROLES: ReadonlySet<MailboxRole> = new Set(["all", "important", "flagged"]);
/** Names the sidebar and system folders already use, so a user folder with the same name needs a suffix. */
const SYSTEM_NAMES = new Set(["inbox", "sent", "drafts", "trash", "spam", "junk", "archive", "important", "starred", "all mail", "bin"]);

/**
 * Folders for the sidebar: drops the all/important/flagged duplicates, and renames user folders and labels whose
 * name collides with another folder or a system name, so one account never shows two folders with the same name.
 */
export function sidebarFolders(folders: Folder[]): Folder[] {
  const visible = folders.filter((f) => !f.role || !HIDDEN_ROLES.has(f.role));
  const key = (name: string) => name.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const f of visible) counts.set(key(f.name), (counts.get(key(f.name)) ?? 0) + 1);
  const taken = new Set<string>();
  const ordered = [...visible].sort((a, b) => Number(Boolean(b.role)) - Number(Boolean(a.role)));
  const renamed = new Map<number, string>();
  for (const f of ordered) {
    let name = f.name;
    const clash = f.role === null && ((counts.get(key(name)) ?? 0) > 1 || SYSTEM_NAMES.has(key(name)) || taken.has(key(name)));
    if (clash) {
      name = `${f.name} (label)`;
      if (taken.has(key(name))) name = f.path.replace(/[\/.]/g, " / ");
      let n = 2;
      while (taken.has(key(name))) name = `${f.name} (label ${n++})`;
    }
    taken.add(key(name));
    renamed.set(f.id, name);
  }
  return visible.map((f) => (renamed.get(f.id) === f.name ? f : { ...f, name: renamed.get(f.id)! }));
}
