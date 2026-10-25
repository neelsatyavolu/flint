import { describe, expect, it } from "vitest";
import { countRecipients, isValidEmail, mergeAddresses, parseAddress, parseAddressList, removeAddress } from "./recipients";

describe("parseAddress", () => {
  it("parses bare, angle and named forms", () => {
    expect(parseAddress("a@b.co")).toEqual({ name: "", address: "a@b.co" });
    expect(parseAddress("<a@b.co>")).toEqual({ name: "", address: "a@b.co" });
    expect(parseAddress("Cindy Wu <cindy@wu.dev>")).toEqual({ name: "Cindy Wu", address: "cindy@wu.dev" });
    expect(parseAddress('"Wu, Cindy" <cindy@wu.dev>')).toEqual({ name: "Wu, Cindy", address: "cindy@wu.dev" });
  });
  it("rejects junk", () => {
    expect(parseAddress("nope")).toBeNull();
    expect(parseAddress("Name <nope>")).toBeNull();
    expect(isValidEmail("a b@c.co")).toBe(false);
  });
});

describe("parseAddressList", () => {
  it("parses a pasted list with names, commas inside quotes and semicolons", () => {
    const { addresses, invalid } = parseAddressList('Cindy Wu <cindy@wu.dev>, "Doe, John" <john@doe.io>; plain@x.org\nlast@y.net');
    expect(addresses.map((a) => a.address)).toEqual(["cindy@wu.dev", "john@doe.io", "plain@x.org", "last@y.net"]);
    expect(addresses[1]!.name).toBe("Doe, John");
    expect(invalid).toEqual([]);
  });
  it("reports tokens that are not addresses", () => {
    const { addresses, invalid } = parseAddressList("a@b.co, hello, ,c@d.co");
    expect(addresses).toHaveLength(2);
    expect(invalid).toEqual(["hello"]);
  });
  it("handles empty input", () => {
    expect(parseAddressList("  ")).toEqual({ addresses: [], invalid: [] });
  });
});

describe("list helpers", () => {
  const a = { name: "A", address: "a@x.co" };
  it("merges without duplicates and without mutating", () => {
    const list = [a];
    const next = mergeAddresses(list, [{ name: "", address: "A@X.co" }, { name: "B", address: "b@x.co" }]);
    expect(next.map((x) => x.address)).toEqual(["a@x.co", "b@x.co"]);
    expect(list).toHaveLength(1);
  });
  it("removes case-insensitively and counts", () => {
    expect(removeAddress([a], "A@x.co")).toEqual([]);
    expect(countRecipients({ to: [a], cc: [a], bcc: [] })).toBe(2);
  });
});
