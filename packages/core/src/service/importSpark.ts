import { z } from "zod";
import type { FlintApi, SparkSignatureOffer } from "../api";
import { locateSparkSettings, readSparkSignatures } from "../importers/spark";
import { FlintError, type Account, type Signature } from "../types";
import type { ServiceContext } from "./context";

const PERMISSION_MESSAGE = "macOS blocked Flint from reading Spark's settings. Allow Flint under System Settings → Privacy & Security → App Management or Full Disk Access, then try again.";
const kvKey = (sparkId: string) => `spark-signature:${sparkId}`;
/** Spark's address-to-signature bindings from the last import, as {address: sparkId}, so accounts added later get theirs. */
const BINDINGS_KEY = "spark-bindings";

function readBindings(ctx: ServiceContext): Record<string, string> {
  try {
    const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(ctx.store.kvGet(BINDINGS_KEY) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Gives a freshly added account the Spark default remembered for its address (or an alias), for new mail and replies.
 * Does nothing when the account already has a choice or the signature is gone.
 */
export function applyRememberedSparkDefaults(ctx: ServiceContext, account: Account): void {
  const settings = ctx.getSettings().compose;
  if (account.id in settings.defaultSignatureByAccount || account.id in settings.defaultReplySignatureByAccount) return;
  const bindings = readBindings(ctx);
  const sparkId = [account.email, ...account.aliases].map((a) => bindings[a.toLowerCase()]).find((id) => id !== undefined);
  if (!sparkId) return;
  const id = Number(ctx.store.kvGet(kvKey(sparkId)));
  if (!Number.isInteger(id) || id <= 0 || !ctx.store.getSignature(id)) return;
  ctx.updateSettings({ compose: { defaultSignatureByAccount: { [account.id]: id }, defaultReplySignatureByAccount: { [account.id]: id } } });
}

const inputSchema = z.object({
  path: z.string().min(1).max(4096).optional(),
  items: z.array(z.object({
    sparkId: z.string().min(1).max(100),
    name: z.string().max(120).optional(),
    setDefaultFor: z.array(z.string().min(1).max(100)).max(100),
  })).min(1).max(200),
});

type Methods = "findSparkSignatures" | "importSparkSignatures";

export function importSparkApi(ctx: ServiceContext): Pick<FlintApi, Methods> {
  const { store } = ctx;

  /** The settings file to read: the one asked for, else Spark's own. Null when Spark isn't installed. */
  function resolvePath(path: string | undefined): string | null {
    if (path) return path;
    const found = locateSparkSettings(ctx.options.sparkHome);
    if (found === "blocked") throw new FlintError("permission", PERMISSION_MESSAGE);
    return found;
  }

  /** Accounts that use an address, by primary address or alias. */
  function accountsFor(addresses: string[], accounts: Account[]): { accountId: string; email: string }[] {
    return accounts
      .filter((a) => addresses.some((e) => e === a.email.toLowerCase() || a.aliases.some((alias) => alias.toLowerCase() === e)))
      .map((a) => ({ accountId: a.id, email: a.email }));
  }

  /** The Flint signature this Spark signature was imported as: remembered by id, else one with identical content. */
  function existing(sparkId: string, html: string): Signature | null {
    const remembered = Number(store.kvGet(kvKey(sparkId)));
    const byId = Number.isInteger(remembered) && remembered > 0 ? store.getSignature(remembered) : null;
    return byId ?? store.listSignatures().find((s) => s.html === html) ?? null;
  }

  return {
    async findSparkSignatures(path) {
      const file = resolvePath(path);
      if (!file) return null;
      const accounts = store.listAccounts();
      const signatures: SparkSignatureOffer[] = readSparkSignatures(file).map((s) => ({ ...s, matches: accountsFor(s.accounts, accounts) }));
      return { path: file, signatures };
    },

    async importSparkSignatures(raw) {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) throw new FlintError("invalid", "Choose at least one Spark signature to import.");
      const input = parsed.data;
      const file = resolvePath(input.path);
      if (!file) throw new FlintError("not_found", "Spark isn't installed on this Mac.");

      const bySparkId = new Map(readSparkSignatures(file).map((s) => [s.sparkId, s]));
      for (const item of input.items) {
        if (!bySparkId.has(item.sparkId)) throw new FlintError("not_found", "Spark no longer has one of those signatures. Reopen the import and try again.");
        for (const id of item.setDefaultFor) store.requireAccount(id);
      }

      const saved: Signature[] = [];
      const defaults: Record<string, number> = {};
      const bindings = readBindings(ctx);
      const accounts = store.listAccounts();
      for (const item of input.items) {
        const source = bySparkId.get(item.sparkId)!;
        const prior = existing(source.sparkId, source.html);
        // One Spark signature used by several of the owner's accounts becomes one signature shared by exactly those accounts.
        // A re-import adds to the accounts it already had; a shared (all accounts) signature stays shared.
        const matched = accountsFor(source.accounts, accounts).map((m) => m.accountId);
        const accountIds = prior && prior.accountIds.length === 0 ? [] : [...new Set([...(prior?.accountIds ?? []), ...matched, ...(matched.length > 0 || prior ? item.setDefaultFor : [])])];
        const sig = store.saveSignature({
          ...(prior ? { id: prior.id } : {}),
          name: item.name?.trim() || source.name,
          html: source.html,
          accountIds,
          defaultNew: prior?.defaultNew ?? false,
          defaultReply: prior?.defaultReply ?? false,
        }, ctx.now());
        store.kvSet(kvKey(source.sparkId), String(sig.id));
        for (const accountId of item.setDefaultFor) defaults[accountId] = sig.id;
        for (const address of source.accounts) bindings[address] = source.sparkId;
        saved.push(sig);
      }
      store.kvSet(BINDINGS_KEY, JSON.stringify(bindings));
      // Spark has one default per address, so it becomes the default for new mail and for replies.
      if (Object.keys(defaults).length > 0) ctx.updateSettings({ compose: { defaultSignatureByAccount: defaults, defaultReplySignatureByAccount: defaults } });
      return saved;
    },
  };
}
