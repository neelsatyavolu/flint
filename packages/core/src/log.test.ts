import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flushLog, initLog, logger } from "./log";

const fresh = () => mkdtempSync(join(tmpdir(), "flint-log-"));
const logs = (dir: string) => readdirSync(join(dir, "logs")).sort();

describe("log", () => {
  it("buffers lines and writes them on flush", async () => {
    const dir = fresh();
    initLog(dir, { flushMs: 10_000, debug: true });
    const log = logger("test");
    log.info("hello", { a: 1 });
    log.debug("detail");
    expect(existsSync(join(dir, "logs", "flint.log"))).toBe(false);
    await flushLog();
    const text = readFileSync(join(dir, "logs", "flint.log"), "utf8");
    expect(text).toMatch(/INFO \[test\] hello \{"a":1\}/);
    expect(text).toMatch(/DEBUG \[test\] detail/);
  });

  it("drops debug lines when debug is off", async () => {
    const dir = fresh();
    initLog(dir, { debug: false });
    logger("t").debug("secret detail");
    logger("t").info("kept");
    await flushLog();
    const text = readFileSync(join(dir, "logs", "flint.log"), "utf8");
    expect(text).not.toContain("secret detail");
    expect(text).toContain("kept");
  });

  it("writes errors without waiting for the timer", async () => {
    const dir = fresh();
    initLog(dir, { flushMs: 60_000 });
    logger("t").error("boom");
    await flushLog();
    expect(readFileSync(join(dir, "logs", "flint.log"), "utf8")).toContain("boom");
  });

  it("rotates at the size limit and keeps three files", async () => {
    const dir = fresh();
    initLog(dir, { maxBytes: 400, keep: 3, flushMs: 10_000, debug: true });
    const log = logger("rot");
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < 4; i++) log.info(`round ${round} line ${i} ${"x".repeat(40)}`);
      await flushLog();
    }
    expect(logs(dir)).toEqual(["flint.log", "flint.log.1", "flint.log.2"]);
    for (const f of logs(dir)) expect(statSync(join(dir, "logs", f)).size).toBeLessThanOrEqual(1000);
    expect(readFileSync(join(dir, "logs", "flint.log"), "utf8")).toContain("round 7");
  });

  it("creates the logs directory private to the user", () => {
    const dir = fresh();
    initLog(dir);
    expect(statSync(join(dir, "logs")).mode & 0o077).toBe(0);
  });
});
