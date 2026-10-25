export { autoconfig, parseIspdb, KNOWN_PROVIDERS, domainOf, type Autoconfig, type AutoconfigDeps, type AutoconfigSource } from "./autoconfig";
export {
  resolveAuth, testConnection, imapOptions, smtpOptions, createImapClient, readSecret, secretKey, secretSchema, describeConnectError,
  type MailAuth, type AccountSecret, type AuthDeps, type GoogleClient, type TestConnectionResult,
} from "./connect";
export {
  startGoogleAuth, refreshGoogleToken, buildAuthUrl, createPkce, parseIdToken, GOOGLE_SCOPES, REFRESH_MARGIN_MS,
  type GoogleAuthOptions, type GoogleSignIn, type GoogleTokens, type FetchLike, type RefreshOptions,
} from "./google-oauth";
export { buildMime, buildReplyDraft, prefixedSubject, extractDataImages, newMessageId, type MimeInput, type ReplySource, type ReplyDraft, type ReplyOptions } from "./compose";
export {
  createSmtp, sendMessage, sendTracked, sendUntracked, fileSentCopy, appendDraft, deleteDraftByUid, replaceDraft, allRecipients,
  type Smtp, type Envelope, type SentFolders, type SendInput, type SendTrackedInput, type SendOutcome, type TrackedRecipient,
} from "./send";
export { ServerActions, type ActionError, type ActionReport } from "./actions";
export { oneShotRunner, withMailbox, type ImapRunner } from "./runner";
export { AccountSync, type AccountSyncOptions } from "./sync/accountSync";
export { walkStructure } from "./sync/bodystructure";
export { classifyMailboxes, gmailLabelPaths } from "./sync/folders";
export { safeFilename } from "./sync/attachments";
