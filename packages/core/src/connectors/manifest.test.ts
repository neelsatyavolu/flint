import { describe, expect, it, vi } from "vitest";
import type { ConnectorManifest, RuleCondition } from "../types";
import { fetchManifest, manifestHash, manifestUrlFor, needsApproval, validateManifest } from "./manifest";

const url = "https://app.example/.well-known/flint-connector.json";
const manifest = (): ConnectorManifest => ({
  flintConnector: 1, id: "example.app", name: "Example app", description: "Organizes confirmations.",
  homepage: "https://app.example", pairPage: "https://app.example/connect",
  pairEndpoint: "https://app.example/pair", deliverEndpoint: "https://app.example/deliver", revokeEndpoint: "https://app.example/revoke",
  match: { any: [{ field: "from", op: "ends_with", value: "@airline.example" }], schemaTypes: ["FlightReservation"] },
  fields: ["messageId", "subject", "html"], historyDays: 365,
});

describe("connector manifests", () => {
  it("accepts v1 and resolves origins or explicit manifest paths", () => {
    expect(validateManifest(manifest(), url)).toEqual(manifest());
    expect(manifestUrlFor("https://app.example")).toBe(url);
    expect(manifestUrlFor(url)).toBe(url);
    expect(manifestUrlFor("https://app.example/connector.json")).toBe("https://app.example/connector.json");
  });

  it("requires HTTPS on the manifest and every manifest URL, on the same host", () => {
    expect(() => manifestUrlFor("http://app.example")).toThrow();
    expect(() => validateManifest(manifest(), "http://app.example/manifest.json")).toThrow();
    for (const key of ["homepage", "pairPage", "pairEndpoint", "deliverEndpoint", "revokeEndpoint"] as const) {
      expect(() => validateManifest({ ...manifest(), [key]: "http://app.example/path" }, url)).toThrow();
      expect(() => validateManifest({ ...manifest(), [key]: "https://other.example/path" }, url)).toThrow();
      expect(() => validateManifest({ ...manifest(), [key]: "https://app.example:8443/path" }, url)).toThrow();
      expect(() => validateManifest({ ...manifest(), [key]: "https://user:password@app.example/path" }, url)).toThrow();
    }
  });

  it("rejects empty conditions, wildcard regexes and unsupported payload fields", () => {
    for (const value of ["", " ", ".*", "^.*$", "(?:.*)", "[\\s\\S]*", "a|", "^", ".+", "[\\s\\S]+", "["]) {
      const condition: RuleCondition = { field: "subject", op: "matches", value };
      expect(() => validateManifest({ ...manifest(), match: { any: [condition], schemaTypes: [] } }, url), value).toThrow();
    }
    expect(() => validateManifest({ ...manifest(), match: { any: [{ field: "from", op: "contains", value: "" }], schemaTypes: [] } }, url)).toThrow();
    expect(() => validateManifest({ ...manifest(), fields: ["attachments"] }, url)).toThrow();
    expect(() => validateManifest({ ...manifest(), historyDays: -1 }, url)).toThrow();
  });

  it("permits specific regex and attachment conditions", () => {
    for (const condition of [
      { field: "subject", op: "matches", value: "booking|reservation" },
      { field: "has_attachment", op: "is_true", value: "" },
    ]) expect(validateManifest({ ...manifest(), match: { any: [condition], schemaTypes: [] } }, url)).toBeTruthy();
  });

  it("rejects remote patterns that can trigger pathological backtracking", () => {
    for (const value of ["(a+)+$", "(?:ab)*$", "(a)\\1", "(?=booking)booking", "(?<=x)booking", "a*a*a*b", "a{1000000}", "a{1,5}a{1,5}b"]) {
      expect(() => validateManifest({ ...manifest(), match: { any: [{ field: "body", op: "matches", value }], schemaTypes: [] } }, url), value).toThrow();
    }
    for (const value of ["(booking|reservation)", "^booking[ :].*confirmed$", "confirmation [0-9]{6}"]) {
      expect(validateManifest({ ...manifest(), match: { any: [{ field: "subject", op: "matches", value }], schemaTypes: [] } }, url)).toBeTruthy();
    }
  });

  it("fetches without redirects and validates the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(manifest())));
    expect(await fetchManifest(url, fetcher, async () => undefined)).toEqual(manifest());
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error" }));
    fetcher.mockResolvedValue(new Response("no", { status: 500 }));
    await expect(fetchManifest(url, fetcher, async () => undefined)).rejects.toThrow("HTTP 500");
  });

  it("hashes a stable canonical snapshot regardless of object key ordering", () => {
    const before = manifest();
    const reversed = Object.fromEntries(Object.entries(before).reverse()) as ConnectorManifest;
    expect(manifestHash(before)).toMatch(/^[0-9a-f]{64}$/);
    expect(manifestHash(reversed)).toBe(manifestHash(before));
    expect(manifestHash({ ...before, fields: ["messageId"] })).not.toBe(manifestHash(before));
  });
});

describe("manifest approval boundary", () => {
  it("silently applies removal of alternatives or fields and reduced history", () => {
    const before = manifest();
    expect(needsApproval(before, before)).toBe(false);
    expect(needsApproval(before, { ...before, fields: ["messageId"], historyDays: 30,
      match: { any: [], schemaTypes: ["FlightReservation"] } })).toBe(false);
    expect(needsApproval(before, { ...before, match: { any: before.match.any, schemaTypes: [] } })).toBe(false);
  });

  it("recognizes a provably narrower contains or suffix condition", () => {
    const before = manifest();
    before.match.any = [{ field: "subject", op: "contains", value: "reservation" }];
    const after = structuredClone(before);
    after.match.any[0]!.value = "flight reservation";
    expect(needsApproval(before, after)).toBe(false);
    expect(needsApproval(after, before)).toBe(true);
    before.match.any = [{ field: "from", op: "ends_with", value: "airline.example" }];
    after.match.any = [{ field: "from", op: "ends_with", value: "@airline.example" }];
    expect(needsApproval(before, after)).toBe(false);
  });

  it("requires approval for new conditions, schema types, fields, history or destinations", () => {
    const before = manifest();
    for (const after of [
      { ...before, fields: [...before.fields, "text" as const] },
      { ...before, historyDays: 366 },
      { ...before, deliverEndpoint: "https://app.example/new-deliver" },
      { ...before, id: "another.app" },
      { ...before, match: { ...before.match, schemaTypes: ["FlightReservation", "LodgingReservation"] } },
      { ...before, match: { ...before.match, any: [...before.match.any, { field: "subject" as const, op: "contains" as const, value: "booking" }] } },
    ]) expect(needsApproval(before, after)).toBe(true);
  });
});
