import { describe, expect, it } from "vitest";
import { receiptBlocker } from "./receiptNote";

const settings = (r: Partial<{ enabled: boolean; endpoint: string }> = {}, plain = false) =>
  ({ receipts: { enabled: true, endpoint: "https://r.test", ...r }, compose: { plainTextOnly: plain } }) as never;
const to = (...a: string[]) => a.map((address) => ({ address, name: "" }));

describe("receiptBlocker", () => {
  it("is null when tracking can work", () => {
    expect(receiptBlocker({ settings: settings(), recipients: to("a@x.io"), selfAddresses: ["me@x.io"] })).toBeNull();
    expect(receiptBlocker({ settings: undefined, recipients: [], selfAddresses: [] })).toBeNull();
  });
  it("explains each reason", () => {
    expect(receiptBlocker({ settings: settings({ enabled: false }), recipients: [], selfAddresses: [] })).toMatch(/off in Settings/);
    expect(receiptBlocker({ settings: settings({ endpoint: " " }), recipients: [], selfAddresses: [] })).toMatch(/receipts address/);
    expect(receiptBlocker({ settings: settings({}, true), recipients: [], selfAddresses: [] })).toMatch(/Plain text/);
    expect(receiptBlocker({ settings: settings(), recipients: to("ME@x.io"), selfAddresses: ["me@x.io"] })).toMatch(/is you/);
  });
});
