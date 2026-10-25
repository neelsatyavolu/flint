import type { Address } from "../types";

/** First name when there is a display name, else the address. */
export function addressLabel(a: Address): string {
  const name = a.name.trim();
  return name ? name.split(/\s+/)[0]! : a.address;
}
