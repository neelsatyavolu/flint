import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { detectCode, registrableDomain, senderDomainOf, type DetectInput } from "./detect";

type Input = ({ fn: "detectCode" } & DetectInput) | { fn: "registrableDomain"; host: string } | { fn: "senderDomainOf"; address: string };
const fixture = loadFixture<Input, unknown>("codes");

describe("codes fixtures", () => {
  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    if (input.fn === "registrableDomain") return expect(registrableDomain(input.host)).toBe(want);
    if (input.fn === "senderDomainOf") return expect(senderDomainOf(input.address)).toBe(want);
    const { fn: _fn, ...mail } = input;
    expect(detectCode(mail)).toEqual(want);
  });
});
