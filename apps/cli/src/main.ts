import { readFile } from "node:fs/promises";
import { connectAgent } from "@flint/core/agent/client";
import type { Deps } from "./program";
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
};

run(process.argv.slice(2), deps).then((code) => { process.exitCode = code; });
