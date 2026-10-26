import { describe, expect, it } from "vitest";
import type { WireCode } from "./protocol";
import { rankCodes, registrableDomain } from "./rank";

const code = (id: string, senderDomain: string, receivedAt: number): WireCode => ({ id, code: "123456", service: id, senderDomain, receivedAt });

describe("registrableDomain", () => {
  it.each([
    ["www.kayak.com", "kayak.com"],
    ["kayak.com", "kayak.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["mail.tesla.com.", "tesla.com"],
    ["localhost", "localhost"],
    ["192.168.0.1", "192.168.0.1"],
  ])("%s", (host, expected) => expect(registrableDomain(host)).toBe(expected));
});

describe("rankCodes", () => {
  it("puts codes from the page's domain first, then newest first", () => {
    const ranked = rankCodes(
      [code("slack", "slack.com", 3000), code("kayak-old", "email.kayak.com", 1000), code("tesla", "tesla.com", 2000), code("kayak-new", "kayak.com", 1500)],
      ["www.kayak.com"],
    );
    expect(ranked.map((c) => c.id)).toEqual(["kayak-new", "kayak-old", "slack", "tesla"]);
    expect(ranked.map((c) => c.matchesSite)).toEqual([true, true, false, false]);
  });

  it("matches any of several hosts (framed pages)", () => {
    const ranked = rankCodes([code("a", "auth0.com", 1), code("b", "shop.com", 2)], ["login.auth0.com", "shop.com"]);
    expect(ranked.every((c) => c.matchesSite)).toBe(true);
  });
});
