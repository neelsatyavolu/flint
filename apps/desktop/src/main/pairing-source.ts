import type { FlintApi } from "@flint/core/api";
import { secretKey } from "@flint/core/mail/connect";
import type { BundleSource } from "@flint/core/pairing/bundle";
import type { SecretStore } from "@flint/core/platform";
import type { AccountId } from "@flint/core/types";

type Api = Pick<FlintApi, "listAccounts" | "listSignatures" | "listTemplates" | "listRules" | "listBlocked" | "getSettings" | "getAvatars">;

/** "Neel's MacBook Pro.local" -> "Neel's MacBook Pro". */
export const macName = (hostname: string): string => hostname.replace(/\.local$/i, "").trim() || "Mac";

/** Reads what the pairing bundle may hold from the running service and the secret store. Passwords are read one at a time, only when asked. */
export function serviceBundleSource(api: Api, secrets: SecretStore, hostname: () => string, now: () => number = Date.now): BundleSource {
  return {
    deviceName: () => macName(hostname()),
    listAccounts: () => api.listAccounts(),
    async password(id: AccountId) {
      const raw = await secrets.get(secretKey(id));
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as { password?: unknown };
        return typeof v.password === "string" && v.password ? v.password : null;
      } catch {
        return null;
      }
    },
    async avatar(id: AccountId) {
      const found = await api.getAvatars([{ kind: "account", accountId: id }]);
      return found[`account:${id}`] ?? null;
    },
    listSignatures: () => api.listSignatures(),
    listTemplates: () => api.listTemplates(),
    listRules: () => api.listRules(),
    listBlocked: () => api.listBlocked(),
    getSettings: () => api.getSettings(),
    now,
  };
}
