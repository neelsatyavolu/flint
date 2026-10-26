import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENES } from "./scenes";

const DIR = join(import.meta.dirname, "../../assets/scenes");
const MAX_TOTAL = 8 * 1024 * 1024;
const MAX_FILE = 600 * 1024;

const files = readdirSync(DIR).filter((f) => f.endsWith(".avif"));
const licenses = readFileSync(join(DIR, "LICENSES.md"), "utf8");

describe("scene photos", () => {
  it("bundles three photos for every slot", () => {
    for (const slot of ["dawn", "day", "dusk", "night"]) expect(SCENES.filter((s) => s.slot === slot)).toHaveLength(3);
  });

  it.each(files)("%s has a manifest entry, a URL and a license line", (file) => {
    const scene = SCENES.find((s) => s.file === file);
    expect(scene, `${file} has no entry in scenes.ts`).toBeDefined();
    expect(scene!.url).not.toBe("");
    expect(scene!.license).toMatch(/^(Public domain|CC0 1\.0)$/);
    expect(scene!.credit.trim()).not.toBe("");
    expect(scene!.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    const row = licenses.split("\n").find((l) => l.includes(`\`${file}\``));
    expect(row, `${file} is missing from LICENSES.md`).toBeDefined();
    expect(row).toMatch(/Public domain|CC0/);
    expect(row).toContain(scene!.sourceUrl);
  });

  it("has a file for every manifest entry", () => {
    for (const s of SCENES) expect(files).toContain(s.file);
  });

  it("keeps each photo under 600 KB and the folder under 8 MB", () => {
    const sizes = files.map((f) => statSync(join(DIR, f)).size);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_FILE);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it("keeps scrims within a flat fill's range", () => {
    for (const s of SCENES) {
      expect(s.scrim).toBeGreaterThanOrEqual(0);
      expect(s.scrim).toBeLessThanOrEqual(0.7);
    }
  });
});
