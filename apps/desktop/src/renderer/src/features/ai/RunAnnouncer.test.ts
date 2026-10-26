import { describe, expect, it } from "vitest";
import { idleRun, type RunState } from "./aiRun";
import { runAnnouncement } from "./RunAnnouncer";

const labels = { busy: "Summarizing", done: "Summary ready", error: "Couldn't summarize" };
const at = (patch: Partial<RunState>): RunState => ({ ...idleRun, ...patch });

describe("runAnnouncement", () => {
  it("says nothing before a run", () => expect(runAnnouncement(idleRun, labels)).toBe(""));

  it("keeps one line for the whole stream, so tokens aren't read out", () => {
    expect(runAnnouncement(at({ status: "starting" }), labels)).toBe("Summarizing");
    expect(runAnnouncement(at({ status: "running", text: "Half a sen" }), labels)).toBe("Summarizing");
    expect(runAnnouncement(at({ status: "running", text: "Half a sentence." }), labels)).toBe("Summarizing");
  });

  it("announces the finish and failures", () => {
    expect(runAnnouncement(at({ status: "done", text: "x" }), labels)).toBe("Summary ready");
    expect(runAnnouncement(at({ status: "error", error: "boom" }), labels)).toBe("Couldn't summarize");
  });

  it("leaves errors to the view when it has no error label, and skips the connect prompt", () => {
    expect(runAnnouncement(at({ status: "error", error: "boom" }), { busy: "a", done: "b" })).toBe("");
    expect(runAnnouncement(at({ status: "error", notConnected: true }), labels)).toBe("");
  });
});
