import type { FlintApi } from "../api";
import type { Platform } from "../platform";

export type FlintService = FlintApi & {
  /** Opens the database, starts sync, the scheduler and (when enabled) the agent API server. */
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type ServiceOptions = {
  /** Start the agent API socket server (desktop: true; tests: false). */
  agentServer?: boolean;
  /** Override the database path (tests use ':memory:'). */
  dbPath?: string;
};

/** Builds the real service. Implemented by the integration step; until then it throws. */
export async function createFlintService(_platform: Platform, _opts: ServiceOptions = {}): Promise<FlintService> {
  throw new Error("FlintService is not implemented yet");
}
