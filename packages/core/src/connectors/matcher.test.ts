import { describe, expect, it } from "vitest";
import type { RuleMessage } from "../rules";
import type { ConnectorManifest } from "../types";
import { matchesConnector } from "./matcher";

const manifest: ConnectorManifest = {
  flintConnector: 1, id: "example.app", name: "Example", description: "",
  homepage: "https://app.example", pairPage: "https://app.example/connect", pairEndpoint: "https://app.example/pair",
  deliverEndpoint: "https://app.example/deliver", revokeEndpoint: "https://app.example/revoke",
  match: { any: [{ field: "from", op: "ends_with", value: "@airline.example" }, { field: "body", op: "contains", value: "confirmation number" }], schemaTypes: ["FlightReservation"] },
  fields: ["messageId"], historyDays: 365,
};
const message: RuleMessage = {
  accountId: "account", from: [{ name: "Airline", address: "bookings@airline.example" }], to: [], cc: [],
  subject: "Your trip", body: "", headers: {}, hasAttachments: false,
};
const unrelated = { ...message, from: [{ name: "Friend", address: "friend@example.test" }] };
const script = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("connector matching", () => {
  it("reuses rule conditions with OR semantics", () => {
    expect(matchesConnector(manifest, message, null)).toBe(true);
    expect(matchesConnector(manifest, unrelated, null)).toBe(false);
    expect(matchesConnector(manifest, { ...unrelated, body: "Confirmation number: 12345" }, null)).toBe(true);
  });

  it("matches JSON-LD even when no rule condition matches", () => {
    for (const value of [
      { "@type": "FlightReservation" },
      [{ "@type": "Organization" }, { "@type": "FlightReservation" }],
      { "@context": "https://schema.org", "@graph": [{ "@type": ["Reservation", "FlightReservation"] }] },
      { "@graph": [{ item: { "@type": "https://schema.org/FlightReservation" } }] },
    ]) expect(matchesConnector(manifest, unrelated, script(value))).toBe(true);
  });

  it("ignores non-JSON-LD, wrong types and malformed blocks but continues scanning", () => {
    expect(matchesConnector(manifest, unrelated, script({ "@type": "LodgingReservation" }))).toBe(false);
    expect(matchesConnector(manifest, unrelated, '<script type="text/javascript">{"@type":"FlightReservation"}</script>')).toBe(false);
    expect(matchesConnector(manifest, unrelated, '<script type="application/ld+json">broken</script>')).toBe(false);
    expect(matchesConnector(manifest, unrelated, '<script type="application/ld+json">broken</script>' + script({ "@type": "FlightReservation" }))).toBe(true);
    expect(matchesConnector(manifest, unrelated, "<SCRIPT TYPE='application/ld+json'>{\"@type\":\"FlightReservation\"}</SCRIPT>")).toBe(true);
  });

  it("does not treat commented scripts or text inside other attributes as JSON-LD", () => {
    expect(matchesConnector(manifest, unrelated, `<!--${script({ "@type": "FlightReservation" })}-->`)).toBe(false);
    expect(matchesConnector(manifest, unrelated, `<script data-info=" type='application/ld+json'">{"@type":"FlightReservation"}</script>`)).toBe(false);
    expect(matchesConnector(manifest, unrelated, `<script data-info="a>b" type="application/ld+json">{"@type":"FlightReservation"}</script>`)).toBe(true);
  });
});
