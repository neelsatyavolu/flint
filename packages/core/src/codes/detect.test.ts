import { describe, expect, it } from "vitest";
import { detectCode, registrableDomain, senderDomainOf, type DetectInput } from "./detect";

const mail = (over: Partial<DetectInput>): DetectInput => ({ subject: "Hello", text: null, html: null, fromName: null, fromAddress: "no-reply@mail.example.com", ...over });
const html = (inner: string): string => `<html><head><style>p{color:red}</style></head><body><table><tr><td>${inner}</td></tr></table></body></html>`;

describe("detectCode positives", () => {
  it("subject: code first", () => {
    expect(detectCode(mail({ subject: "530331 is your KAYAK verification code", fromAddress: "x@kayak.com" }))).toEqual({ code: "530331", service: "KAYAK" });
    expect(detectCode(mail({ subject: "018859 is your verification code", fromName: "Acme Security", fromAddress: "no-reply@acme.io" }))).toEqual({ code: "018859", service: "Acme" });
  });
  it("subject: label then code", () => {
    expect(detectCode(mail({ subject: "Tesla Verification Code: 132419" }))).toEqual({ code: "132419", service: "Tesla" });
    expect(detectCode(mail({ subject: "Your Link verification code: 016 770" }))).toEqual({ code: "016770", service: "Link" });
    expect(detectCode(mail({ subject: "Slack confirmation code: X67-UJK" }))).toEqual({ code: "X67-UJK", service: "Slack" });
  });
  it("inline in HTML-only body", () => {
    const r = detectCode(mail({ subject: "Account update", html: html("<p>Your verification code is 262495 . This code will expire in 15 minutes.</p>"), fromName: "Foo Team", fromAddress: "a@foo.com" }));
    expect(r).toEqual({ code: "262495", service: "Foo" });
    expect(detectCode(mail({ subject: "Verify", html: html("<p>Your DMV Account Verification Code is: 448930</p>") }))?.code).toBe("448930");
  });
  it("code on its own line after a cue line", () => {
    const cues = [
      "Enter this code in Fooapp to finish authenticating:",
      "Verification Code",
      "Here is your verification code:",
      "Your verification code is:",
      "Enter the following verification code when prompted:",
      "To verify your email address, please use the following One Time Password (OTP):",
      "Here's your confirmation code. You can copy it into the open window.",
    ];
    for (const cue of cues) {
      expect(detectCode(mail({ text: `Hi there\n\n${cue}\n\n177 284\n\nThanks` }))?.code, cue).toBe("177284");
      expect(detectCode(mail({ html: html(`<p>${cue}</p><p><b>913042</b></p>`) }))?.code, cue).toBe("913042");
    }
  });
  it("split with dash and 8 digits", () => {
    expect(detectCode(mail({ text: "Your security code: 1234-5678" }))?.code).toBe("12345678");
    expect(detectCode(mail({ text: "Your login code is 123-456" }))?.code).toBe("123456");
  });
  it("spaced digits and year-like codes behind a verification cue", () => {
    expect(detectCode(mail({ text: "Your verification code: 12 34 56" }))?.code).toBe("123456");
    expect(detectCode(mail({ html: html("<p>Your verification code is 4 8 2 9 1 0</p>") }))?.code).toBe("482910");
    expect(detectCode(mail({ text: "Your verification code is 2024" }))?.code).toBe("2024");
    expect(detectCode(mail({ subject: "2026 is your verification code" }))?.code).toBe("2026");
  });
  it("alphanumeric code on a cue line", () => {
    expect(detectCode(mail({ text: "Your verification code:\nAB12CD" }))?.code).toBe("AB12CD");
  });
  it("service falls back to the sender domain", () => {
    expect(detectCode(mail({ text: "Your code is 884211", fromName: "no-reply", fromAddress: "x@auth.bigshop.co.uk" }))).toEqual({ code: "884211", service: "Bigshop" });
  });
});

describe("detectCode negatives", () => {
  const none = (m: Partial<DetectInput>): void => expect(detectCode(mail(m))).toBeNull();
  it("marketing and receipts", () => {
    none({ subject: "Lock in your one time Labor Day bonus", text: "Save 20% on 2026 plans. Call 1-877-563-5213." });
    none({ subject: "Your Dot Calendar. One-Time License. receipt", text: "Order #123456 total $1234.50 on 2026-09-01 at 10:30" });
  });
  it("settings notices and buttons", () => {
    none({ subject: "Your security code settings have been updated", text: "Your security code settings were changed on 10/12/2026." });
    none({ subject: "Security code logon enabled", text: "Security code logon enabled for your account." });
    none({ subject: "Verify your email address", html: html("<a href='https://x.test/v'>Verify email address</a>") });
  });
  it("alerts and bare numbers", () => {
    none({ subject: "New login to Foo from Chrome on Mac", text: "Security code needed? IP 192.168.100.200. Zip 94301." });
    none({ subject: "Hi", text: "Your security code is 2026" });
    none({ text: "Security code settings\n\n1234" });
    none({ text: "If you did not request this, your passcode 1234 may be compromised" });
    none({ text: "Your verification code: 12 34" });
    none({ subject: "Booking", text: "Your confirmation code is AB12CD for flight 12" });
    none({ subject: "Sale", text: "Use promo code SAVE20 at checkout" });
    none({ text: "Verification code\n\nOrder 123456 shipped" });
  });
  it("long newsletters", () => {
    none({ text: `${"x ".repeat(4000)}\nYour verification code is 123456` });
  });
});

describe("domains", () => {
  it("registrable domain", () => {
    expect(registrableDomain("accounts.mail.kayak.com")).toBe("kayak.com");
    expect(registrableDomain("a.shop.co.uk")).toBe("shop.co.uk");
    expect(senderDomainOf("x@auth.foo.io")).toBe("foo.io");
  });
});
