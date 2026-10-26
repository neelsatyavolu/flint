import { readFile } from "node:fs/promises";
import { connectAgent } from "@flint/core/agent/client";
import type { Deps } from "./program";
import { launchedByBrowser, runNativeHost } from "./nativeHost";
import { run } from "./run";

const deps: Deps = {
  connect: (agent) => connectAgent({ agent }),
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
  isTTY: process.stdout.isTTY === true,
  columns: process.stdout.columns ?? 100,
  now: () => new Date(),
  env: process.env,
  readFile: (p) => readFile(p, "utf8"),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const argv = process.argv.slice(2);
// Browsers launch the native messaging host as `flint native-host <origin>`; it owns stdout, so it skips the command parser.
const exit = argv[0] === "native-host"
  ? !launchedByBrowser(argv.slice(1))
    ? (process.stderr.write("flint native-host is started by the browser extension, not run by hand.\n"), Promise.resolve(2))
    : runNativeHost({ stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env })
  : run(argv, deps);
exit.then((code) => { process.exitCode = code; });
