import { describe, expect, it } from "vitest";
import { isUncertain, uncertainSignals, type UncertainInput } from "./uncertain";

const base: UncertainInput = {
  from: { name: "Priya Shah", address: "priya@gmail.com" }, subject: "dinner on friday", text: "Are you around? Let's get dinner.",
  headers: {}, isReply: false, html: false,
};

describe("uncertainSignals", () => {
  it("leaves ordinary personal mail alone", () => {
    expect(isUncertain(base)).toBe(false);
  });
  it("flags college outreach", () => {
    const m = { ...base, from: { name: "Office of Admissions", address: "admissions@uni.edu" }, subject: "Application deadline", text: "Apply now. To unsubscribe click here. © 2026 University" };
    expect(uncertainSignals(m)).toEqual(expect.arrayContaining(["role address", "bulk footer", "promotional subject"]));
  });
  it("flags sending subdomains and list headers", () => {
    expect(isUncertain({ ...base, from: { name: "Scoir", address: "hello@mail.scoir.com" } })).toBe(true);
    expect(isUncertain({ ...base, headers: { "list-id": "<x.y>" } })).toBe(true);
  });
  it("trusts replies", () => {
    expect(isUncertain({ ...base, isReply: true, text: "unsubscribe" })).toBe(false);
    expect(isUncertain({ ...base, subject: "Re: sale", from: { name: "Info", address: "info@x.com" } })).toBe(false);
  });
});
