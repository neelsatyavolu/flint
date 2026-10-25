import type { Address, Settings } from "@flint/core";

type Input = {
  settings: Pick<Settings, "receipts" | "compose"> | undefined;
  recipients: Address[];
  selfAddresses: string[];
};

/**
 * Why this message cannot carry a read receipt, or null when it can. Shown inline in the
 * composer so the eye toggle never promises tracking that will not happen.
 */
export function receiptBlocker({ settings, recipients, selfAddresses }: Input): string | null {
  if (!settings) return null;
  if (!settings.receipts.enabled) return "Read receipts are off in Settings, so this message won't be tracked.";
  if (settings.receipts.endpoint.trim() === "") return "Read receipts need a receipts address in Settings. This message won't be tracked.";
  if (settings.compose.plainTextOnly) return "Plain text mode can't carry a read receipt, so this message won't be tracked.";
  if (recipients.length > 0) {
    const self = new Set(selfAddresses.map((a) => a.toLowerCase()));
    if (recipients.every((r) => self.has(r.address.toLowerCase()))) return "Every recipient is you, so there is nothing to track.";
  }
  return null;
}
