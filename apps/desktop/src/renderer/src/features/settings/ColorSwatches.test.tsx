import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorSwatches } from "./ColorSwatches";
import { ACCOUNT_COLORS } from "./accountColors";

const checked = () => screen.getAllByRole("radio").findIndex((r) => r.getAttribute("aria-checked") === "true");

describe("ColorSwatches", () => {
  it("shows a pick at once, before the saved value comes back", () => {
    const onChange = vi.fn();
    render(<ColorSwatches value={ACCOUNT_COLORS[0]!} label="Color" onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("radio")[2]!);
    expect(onChange).toHaveBeenCalledWith(ACCOUNT_COLORS[2]);
    expect(checked()).toBe(2);
  });

  it("matches the saved color regardless of case and keeps one tab stop", () => {
    render(<ColorSwatches value={ACCOUNT_COLORS[3]!.toUpperCase()} label="Color" onChange={() => undefined} />);
    expect(checked()).toBe(3);
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("moves and picks with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    render(<ColorSwatches value={ACCOUNT_COLORS[0]!} label="Color" onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(ACCOUNT_COLORS.at(-1));
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(ACCOUNT_COLORS[0]);
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[0]);
  });
});
