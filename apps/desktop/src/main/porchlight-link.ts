import type { PorchlightStatus } from "@flint/core/types";

/** Flint's own URL scheme (electron-builder registers it in Info.plist). */
export const FLINT_SCHEME = "flint";

export function isFlintLink(arg: string): boolean {
  return arg.toLowerCase().startsWith(`${FLINT_SCHEME}:`);
}

/**
 * The code from flint://porchlight/pair?code=<CODE>&host=<HOST>, or null unless the link is exactly that shape
 * and names `allowedHost` (once). Any website can open a flint:// link, so this is only a first filter: the
 * user still confirms the account before anything is claimed.
 */
export function parsePorchlightLink(raw: string, allowedHost: string): { code: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${FLINT_SCHEME}:` || url.hostname !== "porchlight" || url.pathname !== "/pair") return null;
  const hosts = url.searchParams.getAll("host");
  const codes = url.searchParams.getAll("code");
  if (hosts.length !== 1 || hosts[0] !== allowedHost || codes.length !== 1) return null;
  const code = codes[0]!.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{8}$/.test(code) ? { code } : null;
}

export type PorchlightLinkDeps = {
  allowedHost: string;
  /** Masked email of the account that made the code; doesn't use the code up. Throws FlintError with a message for the user. */
  peek(code: string): Promise<{ account: string }>;
  pair(code: string, opts: { account: string }): Promise<PorchlightStatus>;
  /** Asks the user. True only for Connect. */
  confirm(account: string): Promise<boolean>;
  /** Brings the Flint window forward. */
  focus(): void;
  notify(level: "info" | "error", message: string): void;
};

export type LinkOutcome = "paired" | "cancelled" | "rejected" | "failed" | "ignored" | "busy";

const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

/** Handles flint:// links, one at a time: check the code, ask, then claim. Never pairs without the user's Connect. */
export function createPorchlightLinkHandler(deps: PorchlightLinkDeps): (url: string) => Promise<LinkOutcome> {
  let busy = false;
  return async (url) => {
    if (!/^flint:\/\/porchlight\/pair(?:[/?#]|$)/i.test(url)) return "ignored";
    deps.focus();
    const link = parsePorchlightLink(url, deps.allowedHost);
    if (!link) {
      deps.notify("error", "Flint ignored a Porchlight link that didn't come from Porchlight.");
      return "rejected";
    }
    if (busy) return "busy";
    busy = true;
    try {
      let account: string;
      try {
        ({ account } = await deps.peek(link.code));
      } catch (err) {
        deps.notify("error", message(err, "Couldn't check this Porchlight link. Try again."));
        return "failed";
      }
      deps.focus();
      if (!(await deps.confirm(account))) return "cancelled";
      try {
        await deps.pair(link.code, { account });
      } catch (err) {
        deps.notify("error", message(err, "Couldn't connect to Porchlight. Try again."));
        return "failed";
      }
      deps.notify("info", `Connected to Porchlight (${account}).`);
      return "paired";
    } finally {
      busy = false;
    }
  };
}
