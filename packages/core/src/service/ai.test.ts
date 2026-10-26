import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../store/settings";
import { FlintError, type AiTask, type Settings } from "../types";
import { aiApi, AI_OFF_MESSAGE } from "./ai";
import type { ServiceContext } from "./context";

function setup(enabled: boolean) {
  const settings: Settings = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, enabled } };
  const runToText = vi.fn(async (_task: AiTask) => ({ text: "[]" }));
  const run = vi.fn(async (_task: AiTask) => ({ runId: "r1" }));
  const ctx = { getSettings: () => settings, emit: () => undefined, ai: { runToText, run } } as unknown as ServiceContext;
  return { api: aiApi(ctx), runToText, run };
}

describe("aiApi with +AI turned off", () => {
  it("still runs the local needs-reply list", async () => {
    const { api, runToText, run } = setup(false);
    await expect(api.aiRunToText({ kind: "needsReply" })).resolves.toEqual({ text: "[]" });
    await expect(api.aiRun({ kind: "needsReply" })).resolves.toEqual({ runId: "r1" });
    expect(runToText).toHaveBeenCalledWith({ kind: "needsReply" });
    expect(run).toHaveBeenCalledWith({ kind: "needsReply" }, expect.any(Function));
  });

  it("refuses tasks that call a model", async () => {
    const { api, runToText, run } = setup(false);
    const err = await api.aiRunToText({ kind: "digest" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlintError);
    expect(err).toMatchObject({ code: "ai_not_connected", message: AI_OFF_MESSAGE });
    await expect(api.aiRun({ kind: "digest" })).rejects.toMatchObject({ code: "ai_not_connected" });
    expect(runToText).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs model tasks when +AI is on", async () => {
    const { api, runToText } = setup(true);
    await api.aiRunToText({ kind: "digest" });
    expect(runToText).toHaveBeenCalledWith({ kind: "digest" });
  });
});
