import { describe, expect, it } from "vitest";
import { checkSend } from "./validate";

const who = { name: "", address: "a@b.co" };
describe("checkSend", () => {
  it("blocks without recipients before checking the subject", () => {
    expect(checkSend({ to: [], cc: [], bcc: [], subject: "" })).toBe("no_recipients");
  });
  it("asks about an empty subject", () => {
    expect(checkSend({ to: [who], cc: [], bcc: [], subject: "   " })).toBe("no_subject");
  });
  it("accepts bcc-only recipients", () => {
    expect(checkSend({ to: [], cc: [], bcc: [who], subject: "Hi" })).toBe("ok");
  });
});
