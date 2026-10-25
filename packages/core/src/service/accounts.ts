import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { FlintApi } from "../api";
import { logger } from "../log";
import { autoconfig as detectServers, KNOWN_PROVIDERS } from "../mail/autoconfig";
import { secretKey } from "../mail/connect";
import { startGoogleAuth } from "../mail/google-oauth";
import { safeFilename } from "../mail/sync/attachments";
import { FlintError, type Account, type AddAccountInput, type AutoconfigResult, type Provider, type ServerConfig } from "../types";
import { checkConnection, checkGoogleMailbox } from "./connectionCheck";
import type { ServiceContext } from "./context";
import { applyRememberedSparkDefaults } from "./importSpark";
import { avatarStoreFor, fetchGoogleAccountPhoto } from "./avatars";

const log = logger("service.accounts");

export type AccountsApi = Pick<FlintApi,
  "listAccounts" | "autoconfig" | "testConnection" | "addAccount" | "addGoogleAccount" | "updateAccount" | "removeAccount">;

const serverSchema = z.object({
  imapHost: z.string().trim().min(1), imapPort: z.number().int().min(1).max(65535), imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(1), smtpPort: z.number().int().min(1).max(65535), smtpSecure: z.boolean(),
  username: z.string().trim().min(1),
});
const emailSchema = z.string().trim().toLowerCase().email("Enter a full email address.");
const addInput = z.object({
  email: emailSchema,
  name: z.string().trim().max(200),
  password: z.string().min(1, "Enter the password."),
  provider: z.enum(["gmail", "imap"]).optional(),
  server: serverSchema.optional(),
});
const patchSchema = z.object({
  name: z.string().trim().max(200),
  color: z.string().max(40).nullable(),
  sortOrder: z.number().int(),
  enabled: z.boolean(),
  showInUnified: z.boolean(),
  aliases: z.array(emailSchema).max(50),
}).partial().strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FlintError("invalid", result.error.issues[0]?.message ?? "That input is not valid.");
  return result.data;
}

const serverOf = (s: ServerConfig): ServerConfig => ({
  imapHost: s.imapHost, imapPort: s.imapPort, imapSecure: s.imapSecure,
  smtpHost: s.smtpHost, smtpPort: s.smtpPort, smtpSecure: s.smtpSecure, username: s.username,
});

type Resolved = { server: ServerConfig; provider: Provider };

async function resolveServer(input: z.infer<typeof addInput>): Promise<Resolved> {
  if (input.server) return { server: input.server, provider: input.provider ?? "imap" };
  const found = await detectServers(input.email);
  return { server: serverOf(found), provider: input.provider ?? found.provider };
}

export function accountsApi(ctx: ServiceContext): AccountsApi {
  const { store, platform } = ctx;
  const changed = (accountId: string) => ctx.emit({ type: "mail_changed", accountId, threadIds: [] });

  async function saveCredentials(accountId: string, secret: object): Promise<void> {
    await platform.secrets.set(secretKey(accountId), JSON.stringify(secret));
  }

  return {
    async listAccounts() {
      return store.listAccounts();
    },

    async autoconfig(email) {
      try {
        const found = await detectServers(parse(emailSchema, email));
        const result: AutoconfigResult = { ...serverOf(found), hint: found.hint ?? null };
        return result;
      } catch (error) {
        log.info("autoconfig found nothing", { reason: (error as Error).message });
        return null;
      }
    },

    async testConnection(raw) {
      const input = parse(addInput, raw);
      const { server } = await resolveServer(input);
      return checkConnection(server, { user: server.username, pass: input.password });
    },

    async addAccount(raw) {
      const input = parse(addInput, raw);
      const { server, provider } = await resolveServer(input);
      const password = provider === "gmail" ? input.password.replace(/\s+/g, "") : input.password;
      const result = await checkConnection(server, { user: server.username, pass: password });
      if (result.imap !== "ok") throw new FlintError("auth", result.imap);
      if (result.smtp !== "ok") throw new FlintError("auth", result.smtp);

      // Bridge: the SMTP mode that worked (STARTTLS instead of implicit SSL) is what gets saved.
      const working = result.smtpSecure === undefined ? server : { ...server, smtpSecure: result.smtpSecure };
      const existing = store.getAccountByEmail(input.email);
      let account: Account;
      if (existing) {
        // Signing in again: keep the mail, replace the credentials and server settings, reconnect.
        account = store.updateAccount(existing.id, { ...working, provider, authKind: "password", enabled: true });
        await saveCredentials(account.id, { password });
      } else {
        account = store.createAccount({ email: input.email, name: input.name, provider, authKind: "password", ...working });
        applyRememberedSparkDefaults(ctx, account);
        await saveCredentials(account.id, { password });
      }
      await ctx.syncs.restart(account.id);
      changed(account.id);
      return account;
    },

    async addGoogleAccount() {
      const client = ctx.googleClient();
      if (!client) throw new FlintError("invalid", "Add a Google client ID and secret in Settings, then try again.");
      const signIn = await (ctx.options.googleAuth ?? startGoogleAuth)({ ...client, openExternal: platform.openExternal, now: ctx.now });
      const secret = { accessToken: signIn.accessToken, refreshToken: signIn.refreshToken, expiresAt: signIn.expiresAt };
      const email = signIn.email.toLowerCase();
      // A Google account can exist without Gmail (mail hosted elsewhere). Find out before saving anything.
      await (ctx.options.googleMailboxCheck ?? checkGoogleMailbox)({ ...serverOf({ ...KNOWN_PROVIDERS["gmail.com"]!, username: email }) }, email, signIn.accessToken, ctx.options.resolveMx);
      const existing = store.getAccountByEmail(email);
      let account: Account;
      if (existing) {
        account = store.updateAccount(existing.id, { authKind: "oauth_google", enabled: true });
        await saveCredentials(account.id, secret);
      } else {
        const gmail = KNOWN_PROVIDERS["gmail.com"]!;
        account = store.createAccount({
          email, name: signIn.name, provider: "gmail", authKind: "oauth_google", username: email,
          imapHost: gmail.imapHost, imapPort: gmail.imapPort, imapSecure: gmail.imapSecure,
          smtpHost: gmail.smtpHost, smtpPort: gmail.smtpPort, smtpSecure: gmail.smtpSecure,
        });
        applyRememberedSparkDefaults(ctx, account);
        await saveCredentials(account.id, secret);
      }
      // Best effort: the picture is nice to have and must never fail a sign-in.
      account = await fetchGoogleAccountPhoto(ctx, account, signIn.picture).catch((e: Error) => { log.warn("profile picture failed", { reason: e.message }); return account; });
      await ctx.syncs.restart(account.id);
      changed(account.id);
      return account;
    },

    async updateAccount(id, rawPatch) {
      const patch = parse(patchSchema, rawPatch);
      const before = store.requireAccount(id);
      const account = store.updateAccount(id, patch);
      if (patch.enabled !== undefined && patch.enabled !== before.enabled) await ctx.syncs.restart(id);
      changed(id);
      return account;
    },

    async removeAccount(id) {
      store.requireAccount(id);
      await ctx.syncs.forget(id);
      await platform.secrets.delete(secretKey(id));
      store.deleteAccount(id);
      await avatarStoreFor(ctx).removeAccount(id).catch(() => undefined);
      await rm(join(platform.dataDir, "attachments", safeFilename(id, "account")), { recursive: true, force: true });
      ctx.scheduler.poke();
      changed(id);
    },
  };
}
