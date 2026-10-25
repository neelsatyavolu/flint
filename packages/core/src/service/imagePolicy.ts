import { z } from "zod";
import type { Store } from "../store";
import type { Address, MessageRowId, Settings } from "../types";

const SENDERS_KEY = "images:senders";
const messageKey = (id: MessageRowId): string => `images:message:${id}`;
const list = z.array(z.string());

/** What the message itself says about whether its From address can be believed. */
export type SenderTrust = {
  isFromMe: boolean;
  /** The message sits in a Sent folder, which only mail that left this account can. */
  inSent: boolean;
  /** Selected headers, lowercase names. Authentication-Results is used when the sync fetched it. */
  headers?: Record<string, string>;
};

/** "fail" when the receiving server recorded a DKIM/SPF/DMARC failure, "pass" when it recorded a pass, else "unknown". */
export function authOutcome(headers: Record<string, string> | undefined): "pass" | "fail" | "unknown" {
  const value = headers?.["authentication-results"]?.toLowerCase();
  if (!value) return "unknown";
  if (/\b(dkim|spf|dmarc)=(fail|softfail|permerror|temperror)\b/.test(value)) return "fail";
  return /\b(dkim|dmarc)=pass\b/.test(value) || /\bspf=pass\b/.test(value) ? "pass" : "unknown";
}

/** Per-message and per-sender remote image permissions, kept in kv. */
export type ImagePolicy = {
  /** True when remote images should load for this message under the user's setting and allowances. */
  allowed(messageId: MessageRowId, from: Address[], trust: SenderTrust): boolean;
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
    allowed(messageId, from, trust) {
      if (store.kvGet(messageKey(messageId)) !== null) return true;
      if (mode === "always") return true;
      if (mode === "never") return false;
      const address = from[0]?.address.toLowerCase();
      if (!address) return false;
      // A From header alone proves nothing: phishing forges the reader's own address and their contacts'.
      const auth = authOutcome(trust.headers);
      if (auth === "fail") return false;
      if (trust.isFromMe && !trust.inSent && auth !== "pass") return false;
      return trust.isFromMe || senders.has(address) || store.hasSentTo(address);
    },
  };
}

/** Allows remote images for this message, and for the sender in future when `always`. */
export function allowImages(store: Store, messageId: MessageRowId, from: Address[], always: boolean): void {
  store.kvSet(messageKey(messageId), "1");
  const address = from[0]?.address.toLowerCase();
  if (always && address) store.kvSet(SENDERS_KEY, JSON.stringify([...new Set([...readSenders(store), address])]));
}
