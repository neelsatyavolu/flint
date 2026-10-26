import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchField } from "./SearchField";

describe("SearchField operator hints", () => {
  it("is a combobox that points at the active hint while hints show", () => {
    render(<SearchField />);
    const input = screen.getByRole("combobox", { name: "Search mail" });
    const list = screen.getByRole("listbox", { name: "Search operators" });
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("wraps through the visible hints only", () => {
    render(<SearchField />);
    const input = screen.getByRole("combobox", { name: "Search mail" });
    const options = screen.getAllByRole("option");
    for (let i = 0; i < options.length; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)!.id);
  });

  it("drops the combobox role when no hint applies", () => {
    render(<SearchField />);
    const input = screen.getByRole("combobox", { name: "Search mail" });
    fireEvent.change(input, { target: { value: "quarterly report" } });
    const field = screen.getByRole("textbox", { name: "Search mail" });
    expect(field.getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
