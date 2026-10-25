import { z } from "zod";
import type { FlintApi } from "../api";
import { FlintError } from "../types";
import type { ServiceContext } from "./context";
import { receiptsHostOf } from "./messageView";
import { wireReceiptWatcher } from "./scheduler-wiring";

export type ReceiptsApi = Pick<FlintApi,
  "listTracked" | "getReceipt" | "refreshReceipts" | "stopTracking">;

const id = z.number().int().positive();
const listOpts = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  status: z.enum(["opened", "unopened"]).optional(),
}).strict().nullish();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FlintError("invalid", result.error.issues[0]?.message ?? "That input is not valid.");
  return result.data;
}

export function receiptsApi(ctx: ServiceContext): ReceiptsApi {
  const { store } = ctx;
  wireReceiptWatcher(ctx);

  return {
    async listTracked(opts) {
      const o = parse(listOpts, opts) ?? {};
      return store.listTracked({ ...(o.limit ? { limit: o.limit } : {}), ...(o.status ? { status: o.status } : {}) });
    },

    async getReceipt(trackedId) {
      return store.getReceiptDetail(parse(id, trackedId));
    },

    async refreshReceipts() {
      if (!ctx.receipts.isConfigured()) return;
      try {
        await ctx.receipts.pollEvents();
      } catch (error) {
        const host = receiptsHostOf(ctx.getSettings().receipts.endpoint) ?? "the configured address";
        if (error instanceof FlintError && error.code === "invalid") throw error;
        throw new FlintError("network", `Couldn't reach the receipts service at ${host}.`);
      }
    },

    async stopTracking(trackedId) {
      await ctx.receipts.stopTracking(parse(id, trackedId));
    },
  };
}
