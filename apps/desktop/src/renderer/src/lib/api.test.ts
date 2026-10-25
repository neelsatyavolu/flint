import { describe, expect, it } from "vitest";
import { previewLatency } from "./api";

describe("previewLatency", () => {
  it("reads ?latency in milliseconds", () => {
    expect(previewLatency("?latency=300")).toBe(300);
  });
  it("ignores missing, invalid and negative values and caps large ones", () => {
    expect(previewLatency("")).toBe(0);
    expect(previewLatency("?latency=abc")).toBe(0);
    expect(previewLatency("?latency=-5")).toBe(0);
    expect(previewLatency("?latency=99999")).toBe(5000);
  });
});
