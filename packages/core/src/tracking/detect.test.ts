import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectTracking, type Tracked, type TrackingInput } from "./detect";

/**
 * Real shipping and flight mail from the user's accounts, run through htmlToText and then redacted (people, addresses,
 * phones, emails, booking codes; every run of 7+ digits remapped digit by digit). Each file is "Subject:", "From:", a
 * blank line, then the body text the parser sees.
 */
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const raw = (name: string): string => readFileSync(join(dir, `${name}.txt`), "utf8");

function mail(name: string): TrackingInput {
  const text = raw(name);
  const [head, ...body] = text.split("\n\n");
  const subject = /^Subject: (.*)$/m.exec(head!)![1]!;
  const [, fromName, fromAddress] = /^From: (.*) <(.*)>$/m.exec(head!)!;
  return { subject, fromName: fromName!, fromAddress: fromAddress!, text: body.join("\n\n"), html: null };
}

const pkg = (carrier: [string, string] | null, tracking: [string, string] | null): Tracked => ({
  kind: "package",
  carrier: carrier && { value: carrier[0], line: carrier[1] },
  tracking: tracking && { value: tracking[0], line: tracking[1] },
});
const flight = (airline: [string, string], number: [string, string]): Tracked => ({
  kind: "flight",
  airline: { value: airline[0], line: airline[1] },
  flight: { value: number[0], line: number[1] },
});

const FEDEX_SENDER: [string, string] = ["FedEx", "From: FedEx Delivery Manager <TrackingUpdates@fedex.com>"];
const UNIUNI_SENDER: [string, string] = ["UniUni", "From: Uniexpress Admin <noreply@uniuni.com>"];
const UNITED_SUBJECT = (code: string): [string, string] => ["United Airlines", `Subject: Fwd: Your United Airlines booking confirmation –  ${code}`];
const ALASKA_LINE: [string, string] = ["Alaska Airlines", "From: Alaska Airlines Reservation - reservation at email.alaskaair.com <someone@example.com>"];

const CASES: Record<string, Tracked[]> = {
  "fedex-on-the-way": [pkg(FEDEX_SENDER, ["493546509118", "Tracking ID   493546509118"])],
  "fedex-on-the-way-international": [pkg(FEDEX_SENDER, ["466613877842", "Tracking ID   466613877842"])],
  "fedex-released-by-customs": [pkg(FEDEX_SENDER, ["466613877842", "Tracking ID   466613877842"])],
  "fedex-out-for-delivery": [pkg(FEDEX_SENDER, ["466613877842", "Tracking ID   466613877842"])],
  "fedex-delivered": [pkg(FEDEX_SENDER, ["466613877842", "Tracking ID   466613877842"])],
  "uniuni-out-for-delivery": [pkg(UNIUNI_SENDER, ["UUS63X3223187313818", "Package tracking number: UUS63X3223187313818"])],
  "uniuni-delivered": [pkg(UNIUNI_SENDER, ["UUS63X3223187313818", "Package tracking number: UUS63X3223187313818"])],
  "flolab-uniuni-shipped": [pkg(["UniUni", "UNIUNI tracking number: UUS63X3223187313818"], ["UUS63X3223187313818", "UNIUNI tracking number: UUS63X3223187313818"])],
  "flolab-uniuni-shipped-2": [pkg(["UniUni", "UNIUNI tracking number: UUS63S3223136693752"], ["UUS63S3223136693752", "UNIUNI tracking number: UUS63S3223136693752"])],
  // Etsy names the carrier but keeps the number behind a "Track package" link.
  "etsy-usps-has-your-order": [pkg(["USPS", "Subject: And it’s off! USPS has your order 🚚"], null)],
  "etsy-shipped": [],
  "etsy-out-for-delivery": [],
  "etsy-delivered": [],
  // Amazon shows neither carrier nor number in the mail.
  "amazon-delivered": [],
  "amazon-delivered-2": [],
  "amazon-locker-pickup": [],
  "united-booking-forwarded": [flight(UNITED_SUBJECT("HB3W9N"), ["UA 2090", "> UA 2090"]), flight(UNITED_SUBJECT("HB3W9N"), ["UA 2482", "> UA 2482"])],
  "united-booking-forwarded-twice": [flight(UNITED_SUBJECT("QK7R2T"), ["UA 1896", "> > UA 1896"]), flight(UNITED_SUBJECT("QK7R2T"), ["UA 1195", "> > UA 1195"])],
  "alaska-booking-forwarded": [flight(ALASKA_LINE, ["AS 1326", "> AS 1326"]), flight(ALASKA_LINE, ["AS 1450", "> AS 1450"])],
  // Mail that names a carrier or a flight without being a shipment or a booking.
  "wifi-onboard-receipt": [],
  "fedex-marketing": [],
  "pirateship-usps-price-change": [],
};

describe("detectTracking on real mail", () => {
  it("covers every fixture", () => {
    const files = readdirSync(dir).map((f) => f.replace(/\.txt$/, "")).sort();
    expect(Object.keys(CASES).sort()).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(CASES))("%s", (name, expected) => {
    expect(detectTracking(mail(name))).toEqual(expected);
  });

  it("quotes lines that exist verbatim in the mail", () => {
    for (const name of Object.keys(CASES)) {
      const lines = new Set(raw(name).split("\n").map((l) => l.trim()));
      for (const hit of detectTracking(mail(name))) {
        const quotes = hit.kind === "package" ? [hit.carrier, hit.tracking] : [hit.airline, hit.flight];
        for (const q of quotes) if (q) expect(lines, `${name}: ${q.line}`).toContain(q.line);
      }
    }
  });
});

describe("detectTracking input forms", () => {
  it("reads HTML-only mail", () => {
    const html = "<html><body><table><tr><td>Tracking ID</td><td><a href='https://www.fedex.com/track'>493546509118</a></td></tr></table></body></html>";
    const hits = detectTracking({ subject: "Your shipment is on the way", fromName: "FedEx", fromAddress: "TrackingUpdates@fedex.com", text: null, html });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "package", carrier: { value: "FedEx" }, tracking: { value: "493546509118" } });
  });
});
