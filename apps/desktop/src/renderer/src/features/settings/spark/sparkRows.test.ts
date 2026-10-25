import { describe, expect, it } from "vitest";
import type { SparkSignatureOffer } from "@flint/core";
import { patchRow, selectedCount, toImportInput, toRows, toggleDefault } from "./sparkRows";

const offer = (sparkId: string, accounts: string[]): SparkSignatureOffer => ({
  sparkId, name: `Sig ${sparkId}`, html: "<div>x</div>", accounts: [], modifiedAt: 0, matches: accounts.map((a) => ({ accountId: a, email: `${a}@x.co` })),
});

describe("spark import rows", () => {
  it("selects everything and keeps an account as the default of one signature only", () => {
    const rows = toRows([offer("A", ["a1", "a2"]), offer("B", ["a2", "a3"])]);
    expect(rows.every((r) => r.checked)).toBe(true);
    expect(rows.map((r) => r.defaults)).toEqual([["a1", "a2"], ["a3"]]);
  });

  it("toggling a default moves it between signatures and can clear it", () => {
    let rows = toRows([offer("A", ["a1"]), offer("B", ["a2"])]);
    rows = toggleDefault(rows, "B", "a1");
    expect(rows.map((r) => r.defaults)).toEqual([[], ["a2", "a1"]]);
    rows = toggleDefault(rows, "B", "a1");
    expect(rows.map((r) => r.defaults)).toEqual([[], ["a2"]]);
  });

  it("builds the import from checked rows with trimmed names", () => {
    let rows = toRows([offer("A", ["a1"]), offer("B", ["a2"])]);
    rows = patchRow(patchRow(rows, "A", { label: "  Work  " }), "B", { checked: false });
    expect(selectedCount(rows)).toBe(1);
    expect(toImportInput("/p", rows)).toEqual({ path: "/p", items: [{ sparkId: "A", name: "Work", setDefaultFor: ["a1"] }] });
    expect(toImportInput("/p", patchRow(rows, "A", { label: " " })).items[0]!.name).toBe("Sig A");
  });
});
