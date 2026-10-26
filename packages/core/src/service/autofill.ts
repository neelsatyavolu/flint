import type { FlintApi } from "../api";
import { UNSUPPORTED_AUTOFILL_STATUS } from "../autofill/contract";
import { FlintError } from "../types";
import type { ServiceContext } from "./context";

/** OWNER: electron builder. Thin delegation to ServiceOptions.autofill (the desktop AutofillManager); all three methods are "admin" tier. */
export type AutofillApi = Pick<FlintApi, "autofillStatus" | "requestAutofillPermission" | "tryAutofillDemo">;

export function autofillApi(ctx: ServiceContext): AutofillApi {
  const host = ctx.options.autofill;
  return {
    async autofillStatus() {
      return host ? host.status() : UNSUPPORTED_AUTOFILL_STATUS;
    },
    async requestAutofillPermission() {
      if (!host) throw new FlintError("invalid", "System-wide autofill is not available in this build of Flint.");
      return host.requestPermission();
    },
    async tryAutofillDemo() {
      if (!host) throw new FlintError("invalid", "System-wide autofill is not available in this build of Flint.");
      await host.tryDemo();
    },
  };
}
