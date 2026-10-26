import { beforeEach, describe, expect, it } from "vitest";
import { adaptMailForDarkCached, clearMailDarkCache, hashHtml } from "./index";

const html = (n: number) => `<div style="background:#ffffff;color:#111111">Message ${n}</div>`;

beforeEach(() => clearMailDarkCache());

describe("adaptMailForDarkCached", () => {
  it("returns the same result for the same message and HTML", () => {
    const a = adaptMailForDarkCached(1, html(1));
    expect(adaptMailForDarkCached(1, html(1))).toBe(a);
  });

  it("adapts again when the HTML changes, e.g. after remote images load", () => {
    const a = adaptMailForDarkCached(1, html(1));
    const b = adaptMailForDarkCached(1, `${html(1)}<img src="https://x.test/a.png">`);
    expect(b).not.toBe(a);
  });

  it("keys by message id as well as HTML", () => {
    expect(adaptMailForDarkCached(2, html(1))).not.toBe(adaptMailForDarkCached(3, html(1)));
  });

  it("keeps the 100 most recently used entries", () => {
    const first = adaptMailForDarkCached(0, html(0));
    const second = adaptMailForDarkCached(1, html(1));
    for (let i = 2; i < 100; i++) adaptMailForDarkCached(i, html(i));
    // Touch the first entry so the second becomes the oldest, then push one more in.
    expect(adaptMailForDarkCached(0, html(0))).toBe(first);
    adaptMailForDarkCached(100, html(100));
    expect(adaptMailForDarkCached(0, html(0))).toBe(first);
    expect(adaptMailForDarkCached(1, html(1))).not.toBe(second);
  });
});

describe("hashHtml", () => {
  it("is stable and tells different bodies apart", () => {
    expect(hashHtml("<p>a</p>")).toBe(hashHtml("<p>a</p>"));
    expect(hashHtml("<p>a</p>")).not.toBe(hashHtml("<p>b</p>"));
  });
});
