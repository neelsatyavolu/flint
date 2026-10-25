import { z } from "zod";
import type { Store } from "../store";
import type { Address, MessageRowId, Settings } from "../types";

const SENDERS_KEY = "images:senders";
const messageKey = (id: MessageRowId): string => `images:message:${id}`;
const list = z.array(z.string());

/** Per-message and per-sender remote image permissions, kept in kv. */
export type ImagePolicy = {
  /** True when remote images should load for this message under the user's setting and allowances. */
  allowed(messageId: MessageRowId, from: Address[], isFromMe: boolean): boolean;
};

function readSenders(store: Store): string[] {
  const raw = store.kvGet(SENDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = list.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function imagePolicy(store: Store, settings: Settings): ImagePolicy {
  const mode = settings.inbox.remoteImages;
  const senders = new Set(readSenders(store));
  return {
    allowed(messageId, from, isFromMe) {
      if (store.kvGet(messageKey(messageId)) !== null) return true;
      if (mode === "always") return true;
      if (mode === "never") return false;
      const address = from[0]?.address.toLowerCase();
      if (!address) return false;
      return isFromMe || senders.has(address) || store.hasSentTo(address);
    },
  };
}

/** Allows remote images for this message, and for the sender in future when `always`. */
export function allowImages(store: Store, messageId: MessageRowId, from: Address[], always: boolean): void {
  store.kvSet(messageKey(messageId), "1");
  const address = from[0]?.address.toLowerCase();
  if (always && address) store.kvSet(SENDERS_KEY, JSON.stringify([...new Set([...readSenders(store), address])]));
}
