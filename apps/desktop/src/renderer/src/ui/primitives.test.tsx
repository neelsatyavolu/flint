import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Avatar, Checkbox, DateTimePanel, Dialog, ResizeHandle, SegmentedControl, Tabs, Toggle, usePersistedSize } from ".";
import { avatarHue } from "../lib/avatar";

describe("Avatar", () => {
  it("shows initials and the hashed hue", () => {
    const { container } = render(<Avatar name="Carla Mendes" address="carla@brightfield.studio" />);
    expect(screen.getByRole("img", { name: "Carla Mendes" }).textContent).toBe("CM");
    expect((container.firstChild as HTMLElement).style.background).toContain(String(avatarHue("carla@brightfield.studio")));
  });
  it("falls back to initials when the image fails", () => {
    const { container } = render(<Avatar address="x@y.io" src="https://bad.example/x.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img").textContent).toBe("X");
  });
});

describe("Toggle and Checkbox", () => {
  it("toggles via click", () => {
    const fn = vi.fn();
    render(<Toggle checked={false} onChange={fn} label="Focused" />);
    fireEvent.click(screen.getByRole("switch", { name: "Focused" }));
    expect(fn).toHaveBeenCalledWith(true);
  });
  it("checks", () => {
    const fn = vi.fn();
    render(<Checkbox checked={false} onChange={fn} label="Block trackers" />);
    fireEvent.click(screen.getByLabelText("Block trackers"));
    expect(fn).toHaveBeenCalledWith(true);
  });
});

describe("Tabs and SegmentedControl", () => {
  it("moves selection with arrow keys", () => {
    function T() {
      const [v, setV] = useState<"a" | "b">("a");
      return <Tabs label="t" tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} value={v} onChange={setV}>{v}</Tabs>;
    }
    render(<T />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "A" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("b");
  });
  it("selects with arrows and Home/End", () => {
    const fn = vi.fn();
    render(<SegmentedControl label="m" options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} value="a" onChange={fn} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "End" });
    expect(fn).toHaveBeenCalledWith("c");
    fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "ArrowLeft" });
    expect(fn).toHaveBeenLastCalledWith("c");
  });
});

describe("ResizeHandle", () => {
  it("resizes with the keyboard within limits", () => {
    const fn = vi.fn();
    render(<ResizeHandle value={232} min={200} max={240} onResize={fn} />);
    const h = screen.getByRole("separator");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    expect(fn).toHaveBeenLastCalledWith(240);
    fireEvent.keyDown(h, { key: "ArrowLeft", shiftKey: true });
    expect(fn).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(h, { key: "Home" });
    expect(fn).toHaveBeenLastCalledWith(200);
  });
  it("persists the size", () => {
    window.localStorage.clear();
    function T() {
      const [w, setW] = usePersistedSize("pane", 232, 200, 320);
      return <button onClick={() => setW(999)}>{w}</button>;
    }
    const { unmount } = render(<T />);
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem("pane")).toBe("320");
    unmount();
    render(<T />);
    expect(screen.getByRole("button").textContent).toBe("320");
  });
});

describe("DateTimePanel", () => {
  const now = new Date(2026, 9, 26, 10, 10).getTime();
  it("lists presets with resolved times and picks one", () => {
    const fn = vi.fn();
    render(<DateTimePanel title="Snooze until" onPick={fn} now={now} />);
    expect(screen.getByText("1:30 PM")).toBeTruthy();
    fireEvent.click(screen.getByText("Tomorrow morning"));
    expect(fn).toHaveBeenCalledWith(new Date(2026, 9, 27, 8).getTime());
  });
  it("accepts a custom future time only", () => {
    const fn = vi.fn();
    render(<DateTimePanel title="x" onPick={fn} now={now} />);
    fireEvent.click(screen.getByText(/Pick date/));
    const input = screen.getByLabelText("Date and time");
    fireEvent.change(input, { target: { value: "2026-11-03T14:05" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(fn).toHaveBeenCalledWith(new Date(2026, 10, 3, 14, 5).getTime());
    fn.mockClear();
    fireEvent.change(input, { target: { value: "2026-10-01T09:00" } });
    expect((screen.getByRole("button", { name: "Set" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Dialog", () => {
  it("renders when open and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Delete rule"><p>Body</p></Dialog>);
    expect(screen.getByRole("dialog", { name: "Delete rule" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it("renders nothing when closed", () => {
    render(<Dialog open={false} onClose={() => undefined} title="x">y</Dialog>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
