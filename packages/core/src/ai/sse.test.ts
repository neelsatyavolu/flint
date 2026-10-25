import { describe, expect, it } from "vitest";
import { createSseSplitter, responsesEvent } from "./sse";

describe("createSseSplitter", () => {
  it("reassembles payloads split across chunks and ignores other fields", () => {
    const out: string[] = [];
    const s = createSseSplitter((d) => out.push(d));
    s.push('event: x\ndata: {"a"');
    s.push(":1}\r\n\ndata: two\n");
    s.push("data: tail");
    s.flush();
    expect(out).toEqual(['{"a":1}', "two", "tail"]);
  });

  it("flush with nothing pending emits nothing", () => {
    const out: string[] = [];
    const s = createSseSplitter((d) => out.push(d));
    s.push("event: ping\n");
    s.flush();
    expect(out).toEqual([]);
  });
});

describe("responsesEvent", () => {
  it("emits text deltas, completion and errors", () => {
    expect(responsesEvent('{"type":"response.output_text.delta","delta":"Hi"}')).toEqual({ text: "Hi" });
    expect(responsesEvent('{"type":"response.completed","response":{}}')).toEqual({ done: true });
    expect(responsesEvent('{"type":"response.failed","response":{"error":{"message":"quota"}}}')).toEqual({ error: "quota" });
    expect(responsesEvent('{"type":"error","message":"bad model"}')).toEqual({ error: "bad model" });
    expect(responsesEvent('{"type":"response.failed"}')).toEqual({ error: "The model request failed." });
    expect(responsesEvent("[DONE]")).toEqual({ done: true });
  });

  it("reports incomplete responses as errors", () => {
    expect(responsesEvent('{"type":"response.incomplete"}')?.error).toMatch(/cut off/);
  });

  it("ignores unrelated events and junk", () => {
    expect(responsesEvent('{"type":"response.created"}')).toBeNull();
    expect(responsesEvent('{"type":"response.output_item.added","item":{"type":"reasoning"}}')).toBeNull();
    expect(responsesEvent("not json")).toBeNull();
    expect(responsesEvent("null")).toBeNull();
    expect(responsesEvent("")).toBeNull();
  });
});
