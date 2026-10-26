import { beforeEach, describe, expect, it } from "vitest";
import { findCodeTarget } from "./fields";

function page(html: string): void {
  document.body.innerHTML = html;
}
const find = (sel: string) => findCodeTarget(document.querySelector(sel));

beforeEach(() => page(""));

describe("single fields", () => {
  it.each([
    ['<input id="x" autocomplete="one-time-code">'],
    ['<input id="x" inputmode="numeric" maxlength="6">'],
    ['<input id="x" name="otp">'],
    ['<input id="x" name="verificationCode">'],
    ['<input id="x" placeholder="Enter 2FA code">'],
    ['<input id="x" aria-label="Security code">'],
    ['<label for="x">Enter the passcode</label><input id="x">'],
    ['<input id="x" name="token" type="tel" maxlength="8">'],
  ])("detects %s", (html) => {
    page(html);
    expect(find("#x")?.kind).toBe("single");
  });

  it.each([
    ['<input id="x" name="email">'],
    ['<input id="x" name="zip" inputmode="numeric" maxlength="5">'],
    ['<input id="x" name="postal_code">'],
    ['<input id="x" name="promo-code">'],
    ['<input id="x" autocomplete="cc-csc" name="security code">'],
    ['<input id="x" name="cvv" inputmode="numeric" maxlength="4">'],
    ['<input id="x" autocomplete="postal-code" inputmode="numeric" maxlength="5">'],
    ['<input id="x" name="code" maxlength="40">'],
    ['<input id="x" type="password" name="otp">'],
    ['<input id="x" name="otp" disabled>'],
    ['<input id="x" name="otp" style="display:none">'],
    ['<input id="x" type="hidden" name="otp">'],
  ])("ignores %s", (html) => {
    page(html);
    expect(find("#x")).toBeNull();
  });

  it("ignores a card security code field but keeps a login security code field", () => {
    page('<form><input name="cardNumber" autocomplete="cc-number"><input id="x" name="securityCode" maxlength="4"></form>');
    expect(find("#x")).toBeNull();
    page('<form><input id="x" name="securityCode" maxlength="6"></form>');
    expect(find("#x")?.kind).toBe("single");
  });

  it("ignores invisible fields", () => {
    for (const style of ["opacity:0", "width:1px;height:1px", "width:0;height:0"]) {
      page(`<input id="x" autocomplete="one-time-code" style="${style}">`);
      expect(find("#x"), style).toBeNull();
    }
  });

  it("reports maxlength", () => {
    page('<input id="x" autocomplete="one-time-code" maxlength="6">');
    expect(find("#x")?.maxLength).toBe(6);
  });

  it("returns null for non-inputs", () => {
    page("<div id=x></div>");
    expect(find("#x")).toBeNull();
    expect(findCodeTarget(null)).toBeNull();
  });
});

describe("split fields", () => {
  const row = (n: number, wrap = "") => `<form>${wrap}<div class="otp-row">${Array.from({ length: n }, (_, i) => `<input id="b${i}" maxlength="1" inputmode="numeric">`).join("")}</div></form>`;

  it("finds the row of six boxes from any box", () => {
    page(row(6));
    const t = find("#b3");
    expect(t?.kind).toBe("split");
    expect(t?.inputs.map((i) => i.id)).toEqual(["b0", "b1", "b2", "b3", "b4", "b5"]);
  });

  it("finds a row whose boxes sit in separate wrappers", () => {
    page(`<div class="otp">${Array.from({ length: 4 }, (_, i) => `<span><input id="b${i}" maxlength="1"></span>`).join("")}</div>`);
    expect(find("#b0")?.inputs).toHaveLength(4);
  });

  it("ignores other inputs in the same form", () => {
    page(row(6, '<input name="email"><input maxlength="30" name="name">'));
    expect(find("#b0")?.inputs).toHaveLength(6);
  });

  it("ignores single-character rows with no sign of being a code, such as a PIN setup", () => {
    page(`<div class="pin"><p>Create your PIN</p>${Array.from({ length: 4 }, (_, i) => `<input id="b${i}" maxlength="1">`).join("")}</div>`);
    expect(find("#b0")).toBeNull();
  });

  it("accepts a bare row when the boxes say one-time-code", () => {
    page(Array.from({ length: 6 }, (_, i) => `<input id="b${i}" maxlength="1" autocomplete="one-time-code">`).join(""));
    expect(find("#b0")?.kind).toBe("split");
  });

  it("ignores rows that are too short or too long", () => {
    page(row(3));
    expect(find("#b0")).toBeNull();
    page(row(12));
    expect(find("#b0")).toBeNull();
  });
});
