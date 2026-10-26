import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast, type ToastInput } from "./Toast";

let show: (t: ToastInput) => number;
function Capture() {
  show = useToast().show;
  return null;
}
const mount = () => render(<ToastProvider><Capture /></ToastProvider>);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Toast", () => {
  it("shows a message and dismisses it after the default 5s", () => {
    mount();
    act(() => void show({ message: "Archived" }));
    expect(screen.getByRole("status").textContent).toBe("Archived");
    act(() => void vi.advanceTimersByTime(4900));
    expect(screen.queryByText("Archived")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText("Archived")).toBeNull();
  });

  it("runs the undo action once and dismisses", () => {
    mount();
    const undo = vi.fn();
    act(() => void show({ message: "Archived", action: { label: "Undo", onClick: undo } }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Archived")).toBeNull();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(undo).toHaveBeenCalledOnce();
  });

  it("runs the secondary action instead of undo and dismisses", () => {
    mount();
    const undo = vi.fn();
    const always = vi.fn();
    act(() => void show({ message: "Moved to Notifications", action: { label: "Undo", onClick: undo }, secondaryAction: { label: "Always for Hotel", onClick: always } }));
    fireEvent.click(screen.getByRole("button", { name: "Always for Hotel" }));
    expect(always).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(screen.queryByText("Moved to Notifications")).toBeNull();
  });

  it("honors a custom timeout and keeps timeout 0 toasts until dismissed", () => {
    mount();
    act(() => void show({ message: "Quick", timeout: 1000 }));
    act(() => void show({ message: "Sticky", timeout: 0 }));
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByText("Quick")).toBeNull();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.queryByText("Sticky")).not.toBeNull();
  });

  it("pauses the timer while hovered", () => {
    mount();
    act(() => void show({ message: "Hold on", timeout: 1000 }));
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Hold on")).not.toBeNull();
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByText("Hold on")).toBeNull();
  });

  it("pauses the timer while focus is inside", () => {
    mount();
    act(() => void show({ message: "Hold on", timeout: 1000, action: { label: "Undo", onClick: () => undefined } }));
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.focus(undo);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Hold on")).not.toBeNull();
    fireEvent.blur(undo);
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByText("Hold on")).toBeNull();
  });

  it("closes from its X button", () => {
    mount();
    act(() => void show({ message: "Sticky", timeout: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Sticky")).toBeNull();
  });

  it("announces through each toast's role, not a live viewport", () => {
    mount();
    act(() => void show({ message: "Archived" }));
    expect(screen.getByRole("status").closest("[aria-live]")).toBeNull();
  });

  it("keeps at most three toasts and marks errors as alerts", () => {
    mount();
    act(() => {
      show({ message: "one" });
      show({ message: "two" });
      show({ message: "three" });
      show({ message: "four", level: "error" });
    });
    expect(screen.queryByText("one")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("four");
  });

  it("throws without a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Capture />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
