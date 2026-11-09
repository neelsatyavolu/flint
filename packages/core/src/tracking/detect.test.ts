import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectTracking, type Tracked, type TrackingInput } from "./detect";

/**
 * Real shipping and flight mail from the user's accounts, run through htmlToText and then redacted (people, addresses,
 * phones, emails, booking codes; every run of 7+ digits remapped digit by digit). Each file is "Subject:", "From:", a
 * blank line, then the body text the parser sees. Files with a "Note: synthetic" header line (UPS, DHL, OnTrac,
 * LaserShip, Jitsu and the Amazon mail with a number) were written from public examples because no real mail was
 * available; replace them with redacted real mail when some arrives.
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
const AMAZON_TBA: [string, string] = ["TBA312345678901", "Tracking ID: TBA312345678901"];
const AMAZON_UPS: [string, string] = ["1Z5R89390357567127", "Tracking ID: 1Z5R89390357567127"];
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
  // Synthetic mail for the carriers without real samples yet (see the note at the top).
  "ups-scheduled-delivery": [pkg(["UPS", "1Z999AA10123456784"], ["1Z999AA10123456784", "1Z999AA10123456784"])],
  "amazon-shipped-tba": [pkg(["Amazon", AMAZON_TBA[1]], AMAZON_TBA)],
  "amazon-out-for-delivery-ups": [pkg(["UPS", AMAZON_UPS[1]], AMAZON_UPS)],
  "amazon-arriving-today": [],
  "dhl-express-on-the-way": [pkg(["DHL", "From: DHL Express <noreply@dhl.com>"], ["3318810025", "Waybill Number: 3318810025"])],
  "dhl-ecommerce-shipped": [pkg(["DHL eCommerce", "Tracking number: GM2951173225174494"], ["GM2951173225174494", "Tracking number: GM2951173225174494"])],
  "ontrac-out-for-delivery": [pkg(["OnTrac", "Tracking Number: D10011354453707"], ["D10011354453707", "Tracking Number: D10011354453707"])],
  "lasership-shipped": [pkg(["LaserShip", "Tracking #: 1LS717793482164"], ["1LS717793482164", "Tracking #: 1LS717793482164"])],
  // Jitsu has no known number format, so only the sender or a link names it.
  "jitsu-out-for-delivery": [pkg(["Jitsu", "From: Jitsu <no-reply@gojitsu.com>"], ["JT68284018587518", "Tracking ID: JT68284018587518"])],
  "axlehire-shipped": [pkg(["Jitsu", "Track your delivery with AxleHire"], ["SCD0000F00410922107", "Tracking number: SCD0000F00410922107"])],
  "ups-my-choice-promo": [],
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

const plain = (subject: string, text: string, fromAddress = "orders@shop.example", fromName = "Shop"): TrackingInput =>
  ({ subject, text, html: null, fromName, fromAddress });

describe("detectTracking number rules", () => {
  it("names the carrier from a number format that is unambiguous", () => {
    const hit = (n: string) => detectTracking(plain("Your order has shipped", `Tracking number: ${n}`))[0];
    expect(hit("1Z999AA10123456784")).toMatchObject({ carrier: { value: "UPS" } });
    expect(hit("TBA000000000000")).toMatchObject({ carrier: { value: "Amazon" } });
    expect(hit("C11031500001879")).toMatchObject({ carrier: { value: "OnTrac" } });
    expect(hit("1LS7119013618127")).toMatchObject({ carrier: { value: "LaserShip" } });
    expect(hit("GM295117494011169042")).toMatchObject({ carrier: { value: "DHL eCommerce" } });
  });

  it("doesn't trust a format whose check digit fails", () => {
    const hit = (n: string) => detectTracking(plain("Your order has shipped", `Tracking number: ${n}`))[0];
    // Still a number behind a cue, but the carrier is left for the server to work out.
    expect(hit("1Z999AA10123456785")).toMatchObject({ carrier: null, tracking: { value: "1Z999AA10123456785" } });
    expect(hit("C10000000000001")).toMatchObject({ carrier: null });
  });

  it("finds a strong-format number with no cue only in shipping mail", () => {
    const text = "Your package is on its way.\n1Z5R89390357567127";
    expect(detectTracking(plain("Your order has shipped", text))).toEqual([pkg(["UPS", "1Z5R89390357567127"], ["1Z5R89390357567127", "1Z5R89390357567127"])]);
    expect(detectTracking(plain("Lunch on Friday?", text))).toEqual([]);
  });

  it("never reads a bare 10-digit number or a Jitsu-looking code without a cue", () => {
    expect(detectTracking(plain("Your order has shipped", "Call us at 3318810025\nJT68284018587518"))).toEqual([]);
  });

  it("takes the number from the line under a cue that stands alone", () => {
    expect(detectTracking(plain("Shipped", "Tracking ID\n493546509118"))[0]).toMatchObject({ tracking: { value: "493546509118", line: "493546509118" } });
    expect(detectTracking(plain("Shipped", "Tracking ID\nsee below"))).toEqual([]);
  });

  it("does not call Amazon the carrier just because Amazon sent the mail", () => {
    const hits = detectTracking(plain("Shipped: \"Socks\"", "Tracking ID: 493546509118", "shipment-tracking@amazon.com", "Amazon.com"));
    expect(hits[0]).toMatchObject({ carrier: null, tracking: { value: "493546509118" } });
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
