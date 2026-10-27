// Which local addresses the pairing listener may be reached on: private IPv4 only.

import { networkInterfaces } from "node:os";
import { MAX_ADDRS } from "./qr";

export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([1, 2, 3, 4].some((i) => Number(m[i]) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

type Interfaces = ReturnType<typeof networkInterfaces>;

/** Up to three private IPv4 addresses, Wi-Fi style names first. */
export function privateAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const found: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal && isPrivateIPv4(i.address)) found.push({ name, address: i.address });
    }
  }
  found.sort((x, y) => Number(y.name.startsWith("en")) - Number(x.name.startsWith("en")));
  return found.map((f) => f.address).slice(0, MAX_ADDRS);
}
