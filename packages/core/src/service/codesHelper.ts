import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FlintApi } from "../api";
import { CODES_EXTENSION_ID, CODES_FIREFOX_ID, CODES_HOST_NAME, codesPaths } from "../codes/contract";
import { browserStatuses, installManifests, removeManifests, type BrowserEnv } from "../codes/helper/browsers";
import { nativeHostWrapperScript, writeFileAtomic } from "../codes/helper/files";
import { logger } from "../log";
import { FlintError, type BrowserHelperStatus } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.codesHelper");

/** Installs/removes the host wrapper and the per-browser host manifests. Home and data dir are injectable via ServiceOptions.browserHome and platform.dataDir. */
export type CodesHelperApi = Pick<FlintApi, "browserHelperStatus" | "installBrowserHelper" | "removeBrowserHelper">;

export function codesHelperApi(ctx: ServiceContext): CodesHelperApi {
  const wrapperPath = codesPaths(ctx.platform.dataDir).wrapperPath;
  const home = ctx.options.browserHome ?? homedir();
  const env: BrowserEnv = {
    home, wrapperPath,
    applicationsDirs: ctx.options.browserHome ? [join(home, "Applications")] : ["/Applications", join(home, "Applications")],
  };
  const cliPath = (): string | null => (ctx.options.cliPath && existsSync(ctx.options.cliPath) ? ctx.options.cliPath : null);
  const wrapperInstalled = (): boolean => lstatSync(wrapperPath, { throwIfNoEntry: false })?.isFile() ?? false;
  const extensionDir = (): string | null => (ctx.options.extensionDir && existsSync(ctx.options.extensionDir) ? ctx.options.extensionDir : null);

  const status = (): BrowserHelperStatus => ({
    hostName: CODES_HOST_NAME, extensionId: CODES_EXTENSION_ID, firefoxId: CODES_FIREFOX_ID,
    wrapperPath, wrapperInstalled: wrapperInstalled(), cliAvailable: cliPath() !== null, extensionDir: extensionDir(),
    browsers: browserStatuses(env),
  });
  const fail = (what: string, error: unknown): never => {
    log.warn(what, { reason: (error as Error).message });
    throw new FlintError("permission", `${what}. ${(error as Error).message}`);
  };

  return {
    async browserHelperStatus() {
      return status();
    },

    async installBrowserHelper() {
      const script = cliPath();
      if (!script) throw new FlintError("not_found", "This build of Flint doesn't include the flint command, which the browser helper needs.");
      try {
        writeFileAtomic(wrapperPath, nativeHostWrapperScript(process.execPath, script, Boolean(process.versions.electron)), 0o755);
        installManifests(env);
      } catch (error) {
        return fail("Flint couldn't set up the browser helper", error);
      }
      log.info("installed the browser helper", { wrapperPath });
      return status();
    },

    async removeBrowserHelper() {
      try {
        removeManifests(env);
        if (lstatSync(wrapperPath, { throwIfNoEntry: false })?.isFile()) unlinkSync(wrapperPath);
      } catch (error) {
        return fail("Flint couldn't remove the browser helper", error);
      }
      return status();
    },
  };
}
