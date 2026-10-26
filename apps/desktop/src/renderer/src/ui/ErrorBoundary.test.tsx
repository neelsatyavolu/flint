import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("shows the crash plane with the error and reloads on demand", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      render(<ErrorBoundary><Boom /></ErrorBoundary>);
      expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
      expect(screen.getByText("render exploded")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
      quiet.mockRestore();
    }
  });
});
