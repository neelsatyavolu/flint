import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProseText, toBlocks } from "./ProseText";

describe("toBlocks", () => {
  it("splits paragraphs and groups bullets", () => {
    expect(toBlocks("First line.\n\nAction needed:\n- One\n- Two\n\nDone.")).toEqual([
      { kind: "p", text: "First line." },
      { kind: "p", text: "Action needed:" },
      { kind: "ul", items: ["One", "Two"] },
      { kind: "p", text: "Done." },
    ]);
  });
  it("keeps single newlines inside a paragraph", () => {
    expect(toBlocks("a\nb")).toEqual([{ kind: "p", text: "a\nb" }]);
  });
});

describe("ProseText", () => {
  it("renders text without interpreting markup", () => {
    const { container } = render(<ProseText text={"<b>x</b>\n- item"} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("<b>x</b>");
  });
});
