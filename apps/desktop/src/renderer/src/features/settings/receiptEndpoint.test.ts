import { describe, expect, it } from "vitest";
import { checkEndpoint } from "./receiptEndpoint";

describe("checkEndpoint", () => {
  it("accepts empty as not configured", () => {
    expect(checkEndpoint("  ")).toEqual({ ok: true, value: "" });
  });
  it("accepts https and trims trailing slashes", () => {
    expect(checkEndpoint("https://receipts.example.com//")).toEqual({ ok: true, value: "https://receipts.example.com" });
  });
  it("accepts http for localhost only", () => {
    expect(checkEndpoint("http://localhost:8787").ok).toBe(true);
    expect(checkEndpoint("http://receipts.example.com").ok).toBe(false);
  });
  it("rejects things that are not URLs", () => {
    expect(checkEndpoint("receipts").ok).toBe(false);
    expect(checkEndpoint("ftp://x.example.com").ok).toBe(false);
  });
});
