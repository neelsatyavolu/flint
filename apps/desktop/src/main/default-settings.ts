import type { Settings } from "@flint/core/types";

export const MOCK_DEFAULT_SETTINGS: Settings = {
  appearance: { layout: "split", theme: "system", avatars: "everywhere", senderLogos: false, senderPhotos: false, emailAppearance: "match", previewLines: 1, density: "comfortable", accountColors: true },
  inbox: { focused: true, sort: "newest", markReadOnOpen: "instant", afterArchive: "next", blockTrackers: true, remoteImages: "known_senders" },
  compose: { undoSendSeconds: 10, defaultSignatureByAccount: {}, defaultReplySignatureByAccount: {}, plainTextOnly: false },
  receipts: { enabled: true, defaultOn: false, endpoint: "", notifyOnOpen: true },
  notifications: { enabled: true, scope: "people", sound: true, soundName: "default", preview: "sender_subject", badge: "unified_unread", disabledAccounts: [] },
  ai: { enabled: true, provider: null, model: null, autoSummarize: true, smartReplies: true, autoCategorize: false, writingStyle: "", replyLanguage: "" },
  agents: { enabled: true, modify: "allow", send: "ask" },
  sync: { initialDays: 90, bodiesForRecentDays: 14 },
  google: { clientId: "", clientSecret: "" },
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(out[k]) && isPlain(v) ? mergeDeep(out[k], v) : v;
  }
  return out as T;
}
