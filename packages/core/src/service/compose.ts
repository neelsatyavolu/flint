import type { FlintApi } from "../api";
import { draftsApi } from "./compose-drafts";
import { libraryApi } from "./compose-library";
import { queueApi } from "./compose-queue";
import { createServerDrafts } from "./compose-server-drafts";
import type { ServiceContext } from "./context";
import { createSendJob, createSendRaw, wireSendLifecycle } from "./send";

export type ComposeApi = Pick<FlintApi,
  "createDraft" | "getDraft" | "updateDraft" | "deleteDraft" | "listDrafts" | "addAttachment" | "removeAttachment" | "sendDraft" | "cancelSend" | "listScheduled" | "approveSend" | "listSignatures" | "saveSignature" | "deleteSignature" | "listTemplates" | "saveTemplate" | "deleteTemplate" | "listRules" | "saveRule" | "deleteRule" | "applyRules">;

/**
 * Drafts, sending, signatures, templates and rules. Also fills the context's compose hooks: the scheduler's
 * send job and the plain-message sender the unsubscribe-by-mailto path uses.
 */
export function composeApi(ctx: ServiceContext): ComposeApi {
  const serverDrafts = createServerDrafts(ctx);
  ctx.compose.sendJob = createSendJob(ctx);
  ctx.compose.sendRaw = createSendRaw(ctx);
  wireSendLifecycle(ctx, serverDrafts);
  return { ...draftsApi(ctx, serverDrafts), ...queueApi(ctx), ...libraryApi(ctx) };
}
