/** Porchlight's carrier ids (docs/API.md in the Porchlight repo, `@porchlight/carriers`). */
export type PorchlightCarrierId =
  | "usps" | "ups" | "fedex" | "dhl" | "dhl_ecommerce" | "amazon" | "ontrac" | "lasership" | "uniuni" | "jitsu" | "other";

/** Flint's detection names → Porchlight ids. LaserShip merged into OnTrac, and Porchlight files its numbers as ontrac. */
const IDS: Record<string, PorchlightCarrierId> = {
  FedEx: "fedex", USPS: "usps", UPS: "ups", DHL: "dhl", "DHL eCommerce": "dhl_ecommerce", Amazon: "amazon",
  OnTrac: "ontrac", LaserShip: "ontrac", UniUni: "uniuni", Jitsu: "jitsu",
};

/** The Porchlight id for a carrier name from detectTracking, or undefined to let Porchlight detect it from the number. */
export function porchlightCarrier(name: string | null): PorchlightCarrierId | undefined {
  return name === null ? undefined : IDS[name];
}
