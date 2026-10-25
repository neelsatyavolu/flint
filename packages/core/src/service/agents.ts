import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FlintApi } from "../api";
import { agentPaths } from "../agent/paths";
import { logger } from "../log";
import { FlintError, type AgentActivity } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.agents");

export type AgentsApi = Pick<FlintApi, "listAgentActivity" | "agentInfo" | "installCli">;

const MAX_SCAN = 500;

function installDirs(ctx: ServiceContext): string[] {
  return ctx.options.cliInstallDirs ?? [join(homedir(), ".local", "bin"), "/usr/local/bin"];
}

function installedAt(ctx: ServiceContext): string | null {
  for (const dir of installDirs(ctx)) {
    const path = join(dir, "flint");
    try {
      lstatSync(path);
      return path;
    } catch { /* not there */ }
  }
  return null;
}

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The command line wrapper. The desktop app is Electron, so it runs the bundled CLI script with the
 * app's own binary in node mode (ELECTRON_RUN_AS_NODE=1) and needs no system Node. Outside Electron
 * (dev, tests) process.execPath is a plain node binary and runs the script directly.
 */
export function wrapperScript(executable: string, cliPath: string, electron: boolean): string {
  const prefix = electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
  return `#!/bin/sh\n# Installed by Flint. Run "Install flint command" in Settings to refresh it.\n${prefix}exec ${shellQuote(executable)} ${shellQuote(cliPath)} "$@"\n`;
}

/**
 * Called by approveSend (service/compose.ts) so the Agent Activity row follows the decision.
 * Finds the newest awaiting_approval row for this scheduled send and sets its status.
 */
export function markApproval(ctx: ServiceContext, scheduledId: number, status: "approved" | "denied"): AgentActivity | null {
  const row = ctx.store.listActivity({ limit: MAX_SCAN })
    .find((a) => a.status === "awaiting_approval" && a.detail.scheduledId === scheduledId);
  if (!row) return null;
  const updated = ctx.store.updateActivity(row.id, { status, detail: { decidedAt: ctx.now() } });
  ctx.emit({ type: "agent_activity", activity: updated });
  return updated;
}

export function agentsApi(ctx: ServiceContext): AgentsApi {
  return {
    async listAgentActivity(opts) {
      return ctx.store.listActivity(opts ?? {});
    },

    async agentInfo() {
      const cliPath = installedAt(ctx);
      return { ...agentPaths(ctx.platform.dataDir), cliInstalled: cliPath !== null, cliPath };
    },

    async installCli() {
      const script = ctx.options.cliPath;
      if (!script || !existsSync(script)) {
        throw new FlintError("not_found", "This build of Flint doesn't include the flint command.");
      }
      const body = wrapperScript(process.execPath, script, Boolean(process.versions.electron));
      let lastError = "";
      for (const dir of installDirs(ctx)) {
        const path = join(dir, "flint");
        try {
          mkdirSync(dir, { recursive: true });
          writeFileSync(path, body, { mode: 0o755 });
          chmodSync(path, 0o755);
          log.info("installed the flint command", { path });
          return { path };
        } catch (error) {
          lastError = (error as Error).message;
          log.warn("could not install the flint command here", { dir, reason: lastError });
        }
      }
      throw new FlintError("permission", "Flint couldn't write the flint command. Check that ~/.local/bin is writable.");
    },
  };
}
