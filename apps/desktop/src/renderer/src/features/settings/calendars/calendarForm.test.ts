import { describe, expect, it } from "vitest";
import { buildCalDavInput, parseAddresses } from "./calendarForm";

describe("parseAddresses", () => {
  it("splits, lower-cases, drops repeats and excluded addresses", () => {
    expect(parseAddresses("A@x.com, b@x.com; a@x.com me@x.com", ["ME@x.com"])).toEqual({ ok: true, values: ["a@x.com", "b@x.com"] });
  });
  it("names the first bad address", () => {
    expect(parseAddresses("ok@x.com nope")).toEqual({ ok: false, message: '"nope" is not a full email address.' });
  });
});

describe("buildCalDavInput", () => {
  const base = { kind: "icloud" as const, url: "", username: " me@icloud.com ", password: "abcd", addresses: "neel@xanom.co" };
  it("uses the preset for iCloud and trims the username", () => {
    expect(buildCalDavInput(base).input).toEqual({ preset: "icloud", username: "me@icloud.com", password: "abcd", extraAddresses: ["neel@xanom.co"] });
  });
  it("needs an https address for other servers", () => {
    expect(buildCalDavInput({ ...base, kind: "other", url: "http://x.com" }).errors?.url).toMatch(/https/);
    expect(buildCalDavInput({ ...base, kind: "other", url: "https://dav.example.com" }).input).toMatchObject({ url: "https://dav.example.com" });
  });
  it("reports missing fields", () => {
    const { errors } = buildCalDavInput({ ...base, username: "", password: "" });
    expect(errors).toMatchObject({ username: "Enter your Apple ID.", password: "Enter an app-specific password." });
  });
});
