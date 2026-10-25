import { avatarKey, FlintError } from "@flint/core/types";
import type { FlintApi } from "@flint/core";
import type { MockState } from "./state";

type Emit = (e: Parameters<Parameters<FlintApi["subscribe"]>[0]>[0]) => void;

const svgUrl = (body: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`)}`;

/** A flat person silhouette on a colored ground. */
const person = (ground: string, ink: string): string =>
  svgUrl(`<rect width="128" height="128" fill="${ground}"/><circle cx="64" cy="50" r="22" fill="${ink}"/><path d="M20 128c0-26 20-42 44-42s44 16 44 42z" fill="${ink}"/>`);

/** Flat geometric marks for the demo accounts, so they read differently from people. */
const mark = (ground: string, ink: string, kind: "bars" | "ring" | "split"): string =>
  svgUrl(
    `<rect width="128" height="128" fill="${ground}"/>` +
      (kind === "bars" ? `<rect x="28" y="30" width="16" height="68" fill="${ink}"/><rect x="56" y="30" width="16" height="68" fill="${ink}"/><rect x="84" y="30" width="16" height="68" fill="${ink}"/>`
        : kind === "ring" ? `<circle cx="64" cy="64" r="34" fill="none" stroke="${ink}" stroke-width="16"/>`
        : `<path d="M0 128L128 0v128z" fill="${ink}"/>`),
  );

const ALEX = person("#2f3a4d", "#9db8e8");

/**
 * Mock profile pictures, generated locally (no network), keyed by avatarKey(): the three demo accounts, the user's own
 * addresses and a few demo senders. Custom account photos set through setAccountAvatar are kept in memory.
 */
export const DEMO_PHOTOS: Record<string, string> = {
  "account:acc_northwind": mark("#26324a", "#6f9cf0", "bars"),
  "account:acc_orbit": mark("#3d2f4a", "#c39be0", "ring"),
  "account:acc_gmail": ALEX,
  "sender:carla@brightfield.studio": person("#5a3b2e", "#f0c7a8"),
  "sender:priya.raman@northwind.dev": person("#2e5148", "#a8e0cf"),
  "sender:meiling@halcyon-type.co": person("#4a3a22", "#e8cf8f"),
  "sender:daniel@lumen-labs.io": person("#3a2f55", "#bdb0ee"),
  "sender:elena@harborline.co": person("#553040", "#eeb0c8"),
  "sender:amara@quillworks.com": mark("#22443f", "#8fdcc9", "split"),
};

export function mockAvatarApi(state: MockState, emit: Emit): Pick<FlintApi, "getAvatars" | "setAccountAvatar"> {
  const custom = new Map<string, string>();
  return {
    async getAvatars(refs) {
      const own = new Map(state.accounts.flatMap((a) => [a.email, ...a.aliases].map((x) => [x.toLowerCase(), a.id] as const)));
      return Object.fromEntries(refs.map((r) => {
        const k = avatarKey(r);
        const mine = r.kind === "sender" ? own.get(r.address.trim().toLowerCase()) : undefined;
        const accountKey = mine ? `account:${mine}` : null;
        return [k, (accountKey && (custom.get(accountKey) ?? DEMO_PHOTOS[accountKey])) || custom.get(k) || DEMO_PHOTOS[k] || null];
      }));
    },
    async setAccountAvatar(id, image) {
      const current = state.accounts.find((a) => a.id === id);
      if (!current) throw new FlintError("not_found", "That account no longer exists.");
      const key = `account:${id}`;
      if (image) custom.set(key, image); else custom.delete(key);
      const next = { ...current, avatarSource: image ? ("custom" as const) : null, avatarUpdatedAt: image ? Date.now() : null };
      state.accounts = state.accounts.map((a) => (a.id === id ? next : a));
      emit({ type: "mail_changed", accountId: id, threadIds: [] });
      return next;
    },
  };
}
