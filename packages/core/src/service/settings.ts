import type { FlintApi } from "../api";
import type { ServiceContext } from "./context";

export type SettingsApi = Pick<FlintApi, "getSettings" | "updateSettings">;

export function settingsApi(ctx: ServiceContext): SettingsApi {
  return {
    async getSettings() {
      return ctx.getSettings();
    },

    async updateSettings(patch) {
      const before = ctx.getSettings();
      const settings = ctx.updateSettings(patch);
      // A corrected Google client lets accounts that stopped on a sign-in error try again.
      if (before.google.clientId !== settings.google.clientId || before.google.clientSecret !== settings.google.clientSecret) {
        await ctx.syncs.restartAuthErrors();
      }
      if (before.receipts.enabled !== settings.receipts.enabled || before.receipts.endpoint !== settings.receipts.endpoint) {
        ctx.scheduler.poke();
      }
      return settings;
    },
  };
}
