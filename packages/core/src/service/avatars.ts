import { join } from "node:path";
import type { FlintApi } from "../api";
import { AvatarStore } from "../avatars/store";
import { parseImageDataUrl } from "../avatars/images";
import { logger } from "../log";
import { avatarKey, FlintError, type Account, type AvatarRef } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.avatars");

export type AvatarsApi = Pick<FlintApi, "setAccountAvatar" | "getAvatars">;

/** Most refs one getAvatars call will look at; the rest come back null. */
const MAX_REFS = 200;

const stores = new WeakMap<ServiceContext, AvatarStore>();

/** The one AvatarStore of a service context, under <dataDir>/avatars. */
export function avatarStoreFor(ctx: ServiceContext): AvatarStore {
  let store = stores.get(ctx);
  if (!store) {
    store = new AvatarStore({ dir: join(ctx.platform.dataDir, "avatars"), now: ctx.now, fetch: ctx.fetch });
    stores.set(ctx, store);
  }
  return store;
}

/** Google serves profile pictures from *.googleusercontent.com only. Anything else in the token is ignored. */
export function isGooglePictureUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "googleusercontent.com" || u.hostname.endsWith(".googleusercontent.com"));
  } catch {
    return false;
  }
}

/** Asks Google for the 256px version of a picture URL (`=s96-c` style suffix). */
const largerGoogleUrl = (url: string): string => url.replace(/=s\d+(-c)?$/, "=s256-c");

/**
 * Stores the Google profile picture for an account and marks the account's source. A custom photo keeps priority.
 * Best effort: a failure only means the account shows initials.
 */
export async function fetchGoogleAccountPhoto(ctx: ServiceContext, account: Account, pictureUrl: string | undefined): Promise<Account> {
  if (!pictureUrl || !isGooglePictureUrl(pictureUrl)) return account;
  const avatars = avatarStoreFor(ctx);
  const got = await avatars.download(largerGoogleUrl(pictureUrl));
  if (!got.bytes) {
    log.info("could not download the Google profile picture", { accountId: account.id });
    return account;
  }
  await avatars.saveAccountPhoto(account.id, "google", got.bytes);
  if (account.avatarSource === "custom") return account;
  return ctx.store.updateAccount(account.id, { avatarSource: "google", avatarUpdatedAt: ctx.now() });
}

export function avatarsApi(ctx: ServiceContext): AvatarsApi {
  const avatars = avatarStoreFor(ctx);

  async function accountPhoto(account: Account): Promise<string | null> {
    if (account.avatarSource === "custom") return (await avatars.accountPhoto(account.id, "custom")) ?? (await avatars.accountPhoto(account.id, "google"));
    if (account.avatarSource === "google") return avatars.accountPhoto(account.id, "google");
    return null;
  }

  return {
    async setAccountAvatar(id, image) {
      ctx.store.requireAccount(id);
      let next: Account;
      if (image === null) {
        await avatars.removeAccountPhoto(id, "custom");
        const hasGoogle = await avatars.hasAccountPhoto(id, "google");
        next = ctx.store.updateAccount(id, hasGoogle ? { avatarSource: "google", avatarUpdatedAt: ctx.now() } : { avatarSource: null, avatarUpdatedAt: null });
      } else {
        const bytes = parseImageDataUrl(image);
        if (!bytes) throw new FlintError("invalid", "Choose a PNG or JPEG image under 1 MB.");
        await avatars.saveAccountPhoto(id, "custom", bytes);
        next = ctx.store.updateAccount(id, { avatarSource: "custom", avatarUpdatedAt: ctx.now() });
      }
      ctx.emit({ type: "mail_changed", accountId: id, threadIds: [] });
      return next;
    },

    async getAvatars(refs) {
      const accounts = ctx.store.listAccounts();
      const own = new Map<string, Account>();
      for (const a of accounts) for (const addr of [a.email, ...a.aliases]) own.set(addr.toLowerCase(), a);
      const senderPhotos = ctx.getSettings().appearance.senderPhotos;

      async function resolve(ref: AvatarRef): Promise<string | null> {
        if (ref.kind === "account") {
          const a = accounts.find((x) => x.id === ref.accountId);
          return a ? accountPhoto(a) : null;
        }
        const address = ref.address.trim().toLowerCase();
        const mine = own.get(address);
        if (mine) {
          const photo = await accountPhoto(mine);
          if (photo) return photo;
        }
        // Sender logos (settings.appearance.senderLogos) have no fetch path in Flint yet, so only Gravatar is looked up.
        if (!senderPhotos || address.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(address)) return null;
        return avatars.senderPhoto(address);
      }

      const entries = await Promise.all(refs.map(async (ref, i): Promise<[string, string | null]> => [avatarKey(ref), i < MAX_REFS ? await resolve(ref).catch(() => null) : null]));
      return Object.fromEntries(entries);
    },
  };
}
