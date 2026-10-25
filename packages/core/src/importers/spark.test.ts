import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { cleanSignatureHtml, findSparkSettings, readSparkSignatures } from "./spark";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function sparkDb(rows: { group: string; key: string; value: unknown }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "spark-fixture-"));
  const path = join(dir, "settings.sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE settings ( pk INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, itemGroup TEXT NOT NULL, itemKey TEXT NOT NULL, itemValue BLOB, syncDate INTEGER NOT NULL, syncStatus INTEGER )");
  const insert = db.prepare("INSERT INTO settings (itemGroup, itemKey, itemValue, syncDate) VALUES (?, ?, ?, 0)");
  for (const r of rows) insert.run(r.group, r.key, Buffer.from(JSON.stringify(r.value)));
  db.close();
  return path;
}

const sig = (id: string, html: string, extra: Record<string, unknown> = {}) => ({
  group: "SignaturesSettingsItemsGroup", key: id,
  value: { identifier: id, htmlContent: html, deleted: false, type: 1, matchMessageFont: false, creationDate: 811396246.1, modificationDate: 812066067.4, ...extra },
});

describe("readSparkSignatures", () => {
  it("reads live signatures with their default accounts, newest first", () => {
    const path = sparkDb([
      sig("A", `<div>--</div><div>Neel Satyavolu</div><div>Executive Producer, Northwind Radio</div><div><img src="${PNG}"></div>`, { modificationDate: 814470348.2 }),
      sig("B", "<div>Thanks,</div><div>&nbsp;</div><div>Neel</div>", { modificationDate: 811396474.0 }),
      sig("C", "<div>Old one</div>", { deleted: true }),
      { group: "MetaSettingsItemsGroup", key: "MetaBindingSettingsKey", value: { "Neel@Xanom.co": "A", "neel@nenu.co": "B", "sam.rivera@gmail.com": "B" } },
    ]);
    const out = readSparkSignatures(path);
    expect(out.map((s) => s.sparkId)).toEqual(["A", "B"]);
    expect(out[0]!.accounts).toEqual(["neel@xanom.co"]);
    expect(out[1]!.accounts).toEqual(["neel@nenu.co", "sam.rivera@gmail.com"]);
    expect(out[0]!.name).toBe("Neel Satyavolu");
    expect(out[1]!.name).toBe("Thanks,");
    expect(out[0]!.html.startsWith("<div>Neel Satyavolu</div>")).toBe(true);
    expect(out[0]!.html).toContain(PNG);
    expect(out[0]!.modifiedAt).toBe(Math.round((814470348.2 + 978307200) * 1000));
  });

  it("names signatures apart when their first line is the same", () => {
    const path = sparkDb([
      sig("A", "<div>--</div><div>Neel Satyavolu</div><div>Executive Producer, Northwind Radio</div>"),
      sig("B", "<div>--</div><div>Neel Satyavolu</div><div>Software Engineer, Orbit Labs</div>"),
    ]);
    const names = readSparkSignatures(path).map((s) => s.name).sort();
    expect(names).toEqual(["Neel Satyavolu · Executive Producer, Northwind Radio", "Neel Satyavolu · Software Engineer, Orbit Labs"]);
  });

  it("treats non-breaking spaces as spaces and dates a signature contained in another", () => {
    const path = sparkDb([
      sig("short", "<div>--</div><div>Neel Satyavolu</div><div>Executive Producer,&nbsp;Northwind Radio</div>", { modificationDate: 811396246.1 }),
      sig("long", "<div>--</div><div>Neel Satyavolu</div><div>Executive Producer, Northwind Radio</div><div>Author, The Lighthouse series</div>", { modificationDate: 814470348.2 }),
    ]);
    const byId = Object.fromEntries(readSparkSignatures(path).map((s) => [s.sparkId, s.name]));
    expect(byId.long).toBe("Neel Satyavolu · Author, The Lighthouse series");
    expect(byId.short).toMatch(/^Neel Satyavolu · edited [A-Z][a-z]{2} \d{1,2}, 2026$/);
  });

  it("works without bindings and skips malformed rows", () => {
    const path = sparkDb([sig("A", "<p>Hi</p>"), { group: "SignaturesSettingsItemsGroup", key: "bad", value: { nope: true } }]);
    const out = readSparkSignatures(path);
    expect(out).toHaveLength(1);
    expect(out[0]!.accounts).toEqual([]);
  });

  it("reports a missing or unreadable file clearly", () => {
    expect(() => readSparkSignatures("/nope/settings.sqlite")).toThrow(/Couldn't find Spark/);
    const dir = mkdtempSync(join(tmpdir(), "spark-bad-"));
    writeFileSync(join(dir, "settings.sqlite"), "not a database");
    expect(() => readSparkSignatures(join(dir, "settings.sqlite"))).toThrow(/isn't a Spark settings database/);
  });
});

describe("cleanSignatureHtml", () => {
  it("drops the leading -- divider (Flint adds its own) and anything unsafe", () => {
    const out = cleanSignatureHtml(`<div>--</div><div onclick="x()">Name <script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://northwind.example">Northwind</a></div><img src="http://tracker.example/p.gif"><img src="${PNG}">`);
    expect(out).not.toMatch(/--|script|onclick|javascript|tracker\.example/);
    expect(out).toContain('<a href="https://northwind.example" target="_blank" rel="noopener">Northwind</a>');
    expect(out).toContain(PNG);
  });

  it("keeps mailto and tel links", () => {
    expect(cleanSignatureHtml('<a href="mailto:a@b.co">a</a> <a href="tel:+16505550100">call</a>')).toMatch(/mailto:a@b\.co.*tel:\+16505550100/);
  });
});

describe("findSparkSettings", () => {
  it("finds the App Store build first, then the direct download", () => {
    const home = mkdtempSync(join(tmpdir(), "spark-home-"));
    expect(findSparkSettings(home)).toBeNull();
    const direct = join(home, "Library", "Application Support", "Spark Desktop", "core-data");
    mkdirSync(direct, { recursive: true });
    writeFileSync(join(direct, "settings.sqlite"), "");
    expect(findSparkSettings(home)).toBe(join(direct, "settings.sqlite"));
    const store = join(home, "Library", "Containers", "com.readdle.SparkDesktop.appstore", "Data", "Library", "Application Support", "Spark Desktop", "core-data");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "settings.sqlite"), "");
    expect(findSparkSettings(home)).toBe(join(store, "settings.sqlite"));
  });
});
