import { logger } from "@flint/core/log";
import type { Platform } from "@flint/core/platform";
import type { FlintService, ServiceOptions } from "@flint/core/service/index";
import { createMockService } from "./mock-service";

const log = logger("service");

export type BootstrapDeps = {
  platform: Platform;
  forceMock: boolean;
  create: (platform: Platform, opts: ServiceOptions) => Promise<FlintService>;
};

export type BootstrapResult =
  | { ok: true; service: FlintService; mock: boolean }
  | { ok: false; message: string };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function startReal(deps: BootstrapDeps): Promise<FlintService> {
  const service = await deps.create(deps.platform, { agentServer: true });
  await service.start();
  return service;
}

/**
 * Builds and starts the service. Only FLINT_MOCK=1 uses the in-memory mock; a failing real
 * service is a fatal error the caller shows in a dialog.
 */
export async function bootstrapService(deps: BootstrapDeps): Promise<BootstrapResult> {
  const useMock = async (): Promise<BootstrapResult> => {
    const service = createMockService(deps.platform.dataDir);
    await service.start();
    return { ok: true, service, mock: true };
  };
  if (deps.forceMock) return useMock();
  try {
    return { ok: true, service: await startReal(deps), mock: false };
  } catch (err) {
    log.error("service failed to start", { message: describe(err) });
    return { ok: false, message: describe(err) };
  }
}
