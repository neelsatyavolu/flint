import { z } from "zod";
import type { FlintApi, SparkSignatureOffer } from "../api";
import { locateSparkSettings, readSparkSignatures } from "../importers/spark";
import { FlintError, type Account, type Signature } from "../types";
import type { ServiceContext } from "./context";

const PERMISSION_MESSAGE = "macOS blocked Flint from reading Spark's settings. Allow Flint under System Settings → Privacy & Security → App Management or Full Disk Access, then try again.";
const kvKey = (sparkId: string) => `spark-signature:${sparkId}`;

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
      for (const item of input.items) {
        const source = bySparkId.get(item.sparkId)!;
        const prior = existing(source.sparkId, source.html);
        // Spark signatures aren't per account, so these stay shared; the per-account default lives in settings.
        const sig = store.saveSignature({
          ...(prior ? { id: prior.id } : {}),
          name: item.name?.trim() || source.name,
          html: source.html,
          accountId: null,
          defaultNew: prior?.defaultNew ?? false,
          defaultReply: prior?.defaultReply ?? false,
        }, ctx.now());
        store.kvSet(kvKey(source.sparkId), String(sig.id));
        for (const accountId of item.setDefaultFor) defaults[accountId] = sig.id;
        saved.push(sig);
      }
      if (Object.keys(defaults).length > 0) ctx.updateSettings({ compose: { defaultSignatureByAccount: defaults } });
      return saved;
    },
  };
}
