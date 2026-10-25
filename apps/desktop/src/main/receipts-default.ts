import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlintApi } from "@flint/core/api";
import { logger } from "@flint/core/log";

/** The receipts service Xanom runs for everyone. Users can point Flint at their own. */
export const DEFAULT_RECEIPTS_ENDPOINT = "https://flintr.xanom.co";
const MARKER = ".receipts-default-applied";
const log = logger("receipts-default");

/**
 * On the first run, fill in the hosted receipts endpoint when none is set. Runs once per data
 * dir, so clearing the field in Settings later sticks.
 */
export async function applyDefaultReceiptsEndpoint(api: Pick<FlintApi, "getSettings" | "updateSettings">, dataDir: string): Promise<void> {
  const marker = join(dataDir, MARKER);
  if (existsSync(marker)) return;
  try {
    const settings = await api.getSettings();
    if (!settings.receipts.endpoint) await api.updateSettings({ receipts: { endpoint: DEFAULT_RECEIPTS_ENDPOINT } });
    writeFileSync(marker, new Date().toISOString());
  } catch (error) {
    log.warn("could not apply the default receipts endpoint", { reason: (error as Error).message });
  }
}
