import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeLine, HELPER_MAX_LINE_BYTES, HELPER_PROTOCOL_FIXTURES, HELPER_PROTOCOL_VERSION, helperCommandSchema, helperEventSchema, parseHelperEvent,
} from "./contract";
import { DEFAULT_SETTINGS, settingsPatchSchema, settingsSchema } from "../store/settings";

describe("helper protocol", () => {
  it("every golden command and event validates and round-trips through a line", () => {
    for (const c of HELPER_PROTOCOL_FIXTURES.commands) expect(helperCommandSchema.parse(JSON.parse(encodeLine(c)))).toEqual(c);
    for (const e of HELPER_PROTOCOL_FIXTURES.events) expect(parseHelperEvent(encodeLine(e).trim())).toEqual(e);
  });

  it("encodes one line ending in a newline", () => {
    for (const m of [...HELPER_PROTOCOL_FIXTURES.commands, ...HELPER_PROTOCOL_FIXTURES.events]) {
      const line = encodeLine(m);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
    }
  });

  it("rejects unknown events, bad shapes, junk and oversized lines", () => {
    expect(parseHelperEvent('{"event":"nope"}')).toBeNull();
    expect(parseHelperEvent('{"event":"used","codeId":"c","via":"magic","method":"typed"}')).toBeNull();
    expect(parseHelperEvent("not json")).toBeNull();
    expect(parseHelperEvent(JSON.stringify({ event: "error", message: "x".repeat(HELPER_MAX_LINE_BYTES) }))).toBeNull();
    expect(helperEventSchema.safeParse({ event: "permission" }).success).toBe(false);
    expect(helperCommandSchema.safeParse({ op: "codes", codes: [{ id: "", code: "1", service: "", senderDomain: "", receivedAt: 0, expiresAt: 0 }] }).success).toBe(false);
  });

  it("the ready fixture carries the current protocol version", () => {
    const ready = HELPER_PROTOCOL_FIXTURES.events.find((e) => e.event === "ready");
    expect(ready && "protocol" in ready ? ready.protocol : null).toBe(HELPER_PROTOCOL_VERSION);
  });

  it("matches the golden file the Swift tests decode", () => {
    const golden = JSON.parse(readFileSync(new URL("../../../../apps/autofill-helper/Tests/FlintAutofillCoreTests/Fixtures/protocol.json", import.meta.url), "utf8"));
    expect(golden).toEqual(HELPER_PROTOCOL_FIXTURES);
  });
});

describe("codes autofill settings", () => {
  it("defaults to autofill on with Control+Option+V", () => {
    expect(DEFAULT_SETTINGS.codes).toMatchObject({ autofill: true, shortcut: "Control+Option+V" });
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
  it("accepts patches, including an empty shortcut, and rejects wrong types", () => {
    expect(settingsPatchSchema.safeParse({ codes: { shortcut: "" } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ codes: { autofill: false } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ codes: { autofill: "yes" } }).success).toBe(false);
  });
});
