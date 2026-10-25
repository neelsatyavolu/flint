import { CommanderError } from "commander";
import { AppNotRunningError } from "@flint/core/agent/client";
import { FlintError } from "@flint/core/types";
import { buildProgram, type Deps } from "./program";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_RUNNING = 2;

export async function run(argv: string[], deps: Deps): Promise<number> {
  const program = buildProgram(deps);
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT_OK;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 || e.code === "commander.help" || e.code === "commander.helpDisplayed" ? EXIT_OK : EXIT_ERROR;
    const json = argv.includes("--json");
    const message = e instanceof FlintError ? e.message : "Something went wrong. Try again.";
    const code = e instanceof FlintError ? e.code : "internal";
    deps.stderr(json ? `${JSON.stringify({ ok: false, error: { code, message } })}\n` : `${message}\n`);
    return e instanceof AppNotRunningError ? EXIT_NOT_RUNNING : EXIT_ERROR;
  }
}
