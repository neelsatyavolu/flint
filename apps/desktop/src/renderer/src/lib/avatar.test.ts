import { describe, expect, it } from "vitest";
import { AVATAR_HUES, avatarColor, avatarHue, hashString, initials } from "./avatar";

describe("avatar hue hashing", () => {
  it("is stable for the same address", () => expect(avatarHue("carla@brightfield.studio")).toBe(avatarHue("carla@brightfield.studio")));
  it("ignores case and surrounding space", () => expect(avatarHue("  Carla@Brightfield.Studio ")).toBe(avatarHue("carla@brightfield.studio")));
  it("always lands on one of the eight design hues", () => {
    for (let i = 0; i < 200; i++) expect(AVATAR_HUES).toContain(avatarHue(`user${i}@example.com`));
  });
  it("spreads addresses across all hues", () => {
    const seen = new Set(Array.from({ length: 300 }, (_, i) => avatarHue(`user${i}@example.com`)));
    expect(seen.size).toBe(AVATAR_HUES.length);
  });
  it("uses the theme lightness and chroma tokens", () => expect(avatarColor("a@b.c")).toMatch(/^oklch\(var\(--avatar-l\) var\(--avatar-c\) \d+\)$/));
  it("hashes deterministically (FNV-1a)", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(0xe40c292c);
  });
});

describe("initials", () => {
  it("uses first and last word", () => expect(initials("Carla Mendes", "c@x.io")).toBe("CM"));
  it("uses one letter for single names", () => expect(initials("Gitforge", "n@g.dev")).toBe("G"));
  it("falls back to the address", () => expect(initials("", "sam.lee@x.io")).toBe("SL"));
  it("ignores punctuation", () => {
    expect(initials("Neel (Nenu)", "n@x.io")).toBe("NN");
    expect(initials("\"Doe, Jane\"", "j@x.io")).toBe("DJ");
    expect(initials("()", "sam.lee@x.io")).toBe("SL");
  });
  it("handles hyphenated names", () => expect(initials("Mei-Ling Zhou", "m@x.io")).toBe("MZ"));
});
