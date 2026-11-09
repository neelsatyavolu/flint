import { describe, expect, it } from "vitest";
import { isSafeImageUrl } from "./safeImage";

const me = ["reader@example.com"];

describe("isSafeImageUrl", () => {
  it.each([
    "https://cdn.brand.example/img/hero.jpg",
    "https://images.ctfassets.net/abc123/9b1f2e7a3c4d5e6f9b1f2e7a3c4d5e6f/banner.png?w=1200&fm=webp&q=80",
    "https://cdn.shopify.com/s/files/1/0012/files/hero_1200x.jpg?v=1699999999",
    "https://substackcdn.com/image/fetch/w_1456,c_limit,f_auto/logo.png",
  ])("loads %s", (url) => expect(isSafeImageUrl(url, me)).toBe(true));

  it.each([
    ["the reader's address", "https://img.example/x.png?to=reader@example.com"],
    ["an encoded address", "https://img.example/x.png?to=reader%40example.com"],
    ["any address", "https://img.example/list/other@example.org/x.png"],
    ["a url-safe base64 address", `https://img.example/${btoa("reader@example.com").replace(/=+$/, "")}.png`],
    ["a token directory", "https://e.example.com/o/eyJ1aWQiOiI4ZjNhOTEifQ/header.png"],
    ["an identity parameter", "https://img.example/logo.png?uid=42"],
    ["a long numeric id", "https://img.example/logo.png?ref=8812734019283"],
    ["a token without a file name", "https://img.example/open/8f3a91b2c4d5e6f7a8b9"],
    ["a hex token without a file name", "https://img.example/i/8f3a91b2c4d5e6f7a8b9c0d1"],
    ["a base64 directory before a file name", "https://img.example/aGVsbG8gd29ybGQ1MjM0NQ/logo.png"],
    ["plain http", "http://cdn.brand.example/hero.jpg"],
    ["credentials", "https://user:pw@cdn.brand.example/hero.jpg"],
    ["a non-url", "not a url"],
  ])("holds back %s", (_why, url) => expect(isSafeImageUrl(url, me)).toBe(false));

  it("tolerates a non-ascii recipient", () => {
    expect(isSafeImageUrl("https://cdn.brand.example/a.png", ["jörg@example.de"])).toBe(true);
  });
});
