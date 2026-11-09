import type { FlintApi } from "@flint/core/api";
import { FlintError, type PorchlightPackage, type PorchlightStatus } from "@flint/core/types";
import type { MockState } from "./state";

/** Browser demo only: pairs with any 8-character code and "imports" mock threads whose subject reads like shipping mail. */
export function mockPorchlightApi(state: MockState, now: () => number): Pick<FlintApi,
  "porchlightStatus" | "pairPorchlight" | "disconnectPorchlight" | "listPorchlightPackages"> {
  let connection: PorchlightStatus["connection"] = null;
  const packages = (): PorchlightPackage[] => connection ? state.threads
    .filter((t) => /\b(?:shipped|out for delivery|arriving|tracking)\b/i.test(t.subject))
    .map((t, i) => {
      const packageId = `00000000-0000-4000-8000-${String(t.id).padStart(12, "0")}`;
      return { packageId, url: `https://porchlight.xanom.co/app/p/${packageId}`, threadId: t.id, carrier: "UPS", trackingNumber: `1Z999AA1012345678${i % 10}`, importedAt: connection!.pairedAt };
    }) : [];
  const status = (): PorchlightStatus => ({ connection, imported: packages().length, pending: 0, lastImportAt: packages().length ? connection!.pairedAt : null });
  return {
    async porchlightStatus() { return status(); },
    async pairPorchlight(code) {
      if (code.replace(/[^a-z0-9]/gi, "").length !== 8) throw new FlintError("invalid", "Enter the 8-character code from Porchlight Settings.");
      connection = { label: "Flint on this Mac", pairedAt: now(), signedOut: false };
      return status();
    },
    async disconnectPorchlight() { connection = null; return { revoked: false }; },
    async listPorchlightPackages(opts = {}) {
      return packages().filter((p) => opts.threadId === undefined || p.threadId === opts.threadId).slice(0, opts.limit ?? 50);
    },
  };
}
