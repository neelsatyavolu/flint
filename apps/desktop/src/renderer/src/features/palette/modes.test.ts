import { describe, expect, it } from "vitest";
import { parseQuery } from "./modes";

describe("parseQuery", () => {
  it("reads a leading prefix as a mode", () => {
    expect(parseQuery(">arch")).toEqual({ mode: "commands", text: "arch" });
    expect(parseQuery("/ from:carla")).toEqual({ mode: "mail", text: "from:carla" });
    expect(parseQuery("@ car")).toEqual({ mode: "contacts", text: "car" });
    expect(parseQuery("#")).toEqual({ mode: "folders", text: "" });
  });
  it("leaves everything else as a plain search", () => {
    expect(parseQuery("  arch ")).toEqual({ mode: "all", text: "arch" });
    expect(parseQuery("a > b")).toEqual({ mode: "all", text: "a > b" });
    expect(parseQuery("")).toEqual({ mode: "all", text: "" });
  });
});
