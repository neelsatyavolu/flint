import { FlintError } from "@flint/core/types";
import { emit, parseId, parseIds, plural, type CliClient, type Ctx } from "../ctx";
import { formatFull, parseFuture } from "../time";

type Verb = { past: string; run(c: CliClient, ids: number[]): Promise<{ undoToken: string }> };

export const VERBS: Record<string, Verb> = {
  archive: { past: "Archived", run: (c, ids) => c.archive(ids) },
  trash: { past: "Moved to trash:", run: (c, ids) => c.trash(ids) },
  pin: { past: "Pinned", run: (c, ids) => c.setPinned(ids, true) },
  unpin: { past: "Unpinned", run: (c, ids) => c.setPinned(ids, false) },
  "mark-read": { past: "Marked read:", run: (c, ids) => c.markRead(ids, true) },
  unread: { past: "Marked unread:", run: (c, ids) => c.markRead(ids, false) },
  spam: { past: "Marked as spam:", run: (c, ids) => c.markSpam(ids, true) },
};

export async function act(ctx: Ctx, verb: string, idsRaw: string[]): Promise<void> {
  const v = VERBS[verb];
  if (!v) throw new FlintError("internal", `Unknown action ${verb}.`);
  const ids = parseIds(idsRaw);
  const r = await v.run(ctx.client, ids);
  emit(ctx, { ...r, threadIds: ids }, () => `${v.past} ${plural(ids.length, "thread")}.`);
}

export async function snooze(ctx: Ctx, idRaw: string, when: string): Promise<void> {
  const id = parseId(idRaw);
  const until = parseFuture(when, ctx.now);
  const r = await ctx.client.snooze([id], until);
  emit(ctx, { ...r, threadIds: [id], until }, () => `Snoozed thread ${id} until ${formatFull(until)}.`);
}

export async function move(ctx: Ctx, idRaw: string, folder: string): Promise<void> {
  const id = parseId(idRaw);
  const thread = await ctx.client.getThread(id);
  const want = folder.toLowerCase();
  if (want === "inbox") {
    const r = await ctx.client.moveToInbox([id]);
    return emit(ctx, { ...r, threadIds: [id] }, () => `Moved thread ${id} to the inbox.`);
  }
  const folders = await ctx.client.listFolders(thread.accountId);
  const hit = folders.find((f) => f.name.toLowerCase() === want || f.path.toLowerCase() === want || f.role === want);
  if (!hit) {
    throw new FlintError("not_found", `No folder "${folder}" in this account. Folders: ${folders.map((f) => f.name).join(", ") || "none"}.`);
  }
  const r = await ctx.client.moveToFolder([id], hit.id);
  emit(ctx, { ...r, threadIds: [id], folder: hit.name }, () => `Moved thread ${id} to ${hit.name}.`);
}
