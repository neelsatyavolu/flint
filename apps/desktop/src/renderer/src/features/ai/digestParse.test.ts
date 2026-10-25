import { describe, expect, it } from "vitest";
import { parseDigest } from "./digestParse";

const threads = [1, 2, 3].map((n) => ({ threadId: n * 10, subject: `Subject ${n}` }));

describe("parseDigest", () => {
  it("groups bullets under their titles and links each to its thread", () => {
    const out = parseDigest("Needs a reply\n- Rodney asks you to confirm Monday. [1]\n- Ana wants the file. [3]\nWorth knowing\n- The invoice was approved. [2]", threads);
    expect(out.groups.map((g) => g.title)).toEqual(["Needs a reply", "Worth knowing"]);
    expect(out.groups[0]!.items).toEqual([
      { text: "Rodney asks you to confirm Monday.", threadId: 10, subject: "Subject 1" },
      { text: "Ana wants the file.", threadId: 30, subject: "Subject 3" },
    ]);
    expect(out.groups[1]!.items[0]!.threadId).toBe(20);
  });

  it("handles bullets without titles and a closing note", () => {
    const out = parseDigest("- Payment due on the 30th. [2]\n- Shipping delayed. [1]\nThe rest is routine.", threads);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.title).toBeNull();
    expect(out.notes).toEqual(["The rest is routine."]);
  });

  it("leaves a bullet unlinked for a missing or invented number", () => {
    const out = parseDigest("- No marker here.\n- Bad marker. [9]", threads);
    expect(out.groups[0]!.items.map((i) => i.threadId)).toEqual([null, null]);
  });

  it("hides a half-streamed marker and shows a title that has no bullets yet", () => {
    expect(parseDigest("- Rodney wrote back. [", threads).groups[0]!.items[0]!.text).toBe("Rodney wrote back.");
    expect(parseDigest("- Rodney wrote back. [1", threads).groups[0]!.items[0]!.text).toBe("Rodney wrote back.");
    expect(parseDigest("Needs a rep", threads).groups).toEqual([{ title: "Needs a rep", items: [] }]);
  });

  it("handles empty text", () => {
    expect(parseDigest("", threads)).toEqual({ groups: [], notes: [] });
  });
});
