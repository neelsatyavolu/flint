import type { FlintApi } from "../api";
import { FlintError, type AiStatus, type AiTask } from "../types";
import type { ServiceContext } from "./context";

export type AiApi = Pick<FlintApi,
  "aiStatus" | "aiStartConnect" | "aiFinishConnect" | "aiDisconnect" | "aiSetModel" | "aiRun" | "aiRunToText" | "aiCancel">;

export const AI_OFF_MESSAGE = "Turn on +AI in Settings to use this.";

/**
 * Keeps settings.ai.provider and model equal to what the engine reports, so Settings stays the
 * single source the UI reads. Also catches a Codex sign-in that finished on the loopback listener.
 */
function mirror(ctx: ServiceContext, status: AiStatus): AiStatus {
  const ai = ctx.getSettings().ai;
  if (ai.provider !== status.provider || ai.model !== status.model) {
    ctx.updateSettings({ ai: { provider: status.provider, model: status.model } });
  }
  return status;
}

/** Needs reply is a local heuristic with no model call, so it works with +AI off (as the engine skips the connection check). */
function requireEnabled(ctx: ServiceContext, task: AiTask): void {
  if (task.kind === "needsReply") return;
  if (!ctx.getSettings().ai.enabled) throw new FlintError("ai_not_connected", AI_OFF_MESSAGE);
}

export function aiApi(ctx: ServiceContext): AiApi {
  return {
    async aiStatus() {
      return mirror(ctx, await ctx.ai.status());
    },

    async aiStartConnect(provider) {
      const result = await ctx.ai.startConnect(provider);
      await ctx.platform.openExternal(result.url).catch(() => undefined); // the UI also shows the link
      return result;
    },

    async aiFinishConnect(provider, pasted) {
      return mirror(ctx, await ctx.ai.finishConnect(provider, pasted));
    },

    async aiDisconnect() {
      return mirror(ctx, await ctx.ai.disconnect());
    },

    async aiSetModel(model) {
      return mirror(ctx, await ctx.ai.setModel(model));
    },

    async aiRun(task) {
      requireEnabled(ctx, task);
      return ctx.ai.run(task, (chunk) => ctx.emit({ type: "ai", chunk }));
    },

    async aiRunToText(task) {
      requireEnabled(ctx, task);
      return ctx.ai.runToText(task);
    },

    async aiCancel(runId) {
      ctx.ai.cancel(runId);
    },
  };
}
