import { afterEach, describe, expect, it, vi } from "vitest";
import { readStored, readStoredNumber, writeStored } from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("storage", () => {
  it("round-trips values", () => {
    writeStored("k", "42");
    expect(readStored("k")).toBe("42");
    expect(readStoredNumber("k", 1)).toBe(42);
  });
  it("falls back for missing and non-numeric values", () => {
    expect(readStored("missing")).toBeNull();
    expect(readStoredNumber("missing", 7)).toBe(7);
    writeStored("bad", "abc");
    expect(readStoredNumber("bad", 7)).toBe(7);
  });
  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "1")).not.toThrow();
  });
});
