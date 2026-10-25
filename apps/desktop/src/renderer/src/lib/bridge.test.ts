import { describe, expect, it } from "vitest";
import { FlintError } from "@flint/core/types";
import { toFlintError } from "./api";

describe("toFlintError", () => {
  it("turns the preload's plain object into a FlintError with its code", () => {
    const e = toFlintError({ name: "FlintError", code: "auth", message: "Wrong password." });
    expect(e).toBeInstanceOf(FlintError);
    expect((e as FlintError).code).toBe("auth");
  });
  it("maps unknown codes to internal and leaves other errors alone", () => {
    expect((toFlintError({ name: "FlintError", code: "weird", message: "x" }) as FlintError).code).toBe("internal");
    const plain = new Error("boom");
    expect(toFlintError(plain)).toBe(plain);
  });
});
