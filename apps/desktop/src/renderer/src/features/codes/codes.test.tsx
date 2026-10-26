import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodeBadge } from "@flint/core/types";
import { flint } from "../../lib/api";
import { CodeBanner } from "./CodeBanner";
import { CodeChip } from "./CodeChip";
import { minutesLeft } from "./useLiveCode";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const badge = (over: Partial<CodeBadge> = {}): CodeBadge => ({ id: "c1", code: "530331", service: "KAYAK", expiresAt: Date.now() + 8 * 60_000, used: false, ...over });

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("CodeBanner", () => {
  it("shows the code, the service and the time left", () => {
    render(<CodeBanner badge={badge()} />);
    expect(screen.getByTestId("code-value").textContent).toBe("530331");
    expect(screen.getByText(/KAYAK/)).toBeTruthy();
    expect(screen.getByText("Expires in 8 minutes")).toBeTruthy();
  });

  it("copies the code without marking it used", async () => {
    const writeText = stubClipboard();
    const used = vi.spyOn(flint, "markCodeUsed").mockResolvedValue();
    render(<CodeBanner badge={badge()} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("530331"));
    expect(used).not.toHaveBeenCalled();
    await screen.findByRole("button", { name: "Copied" });
  });

  it("renders nothing without a code or after it expired", () => {
    const { container, rerender } = render(<CodeBanner badge={undefined} />);
    expect(container.textContent).toBe("");
    rerender(<CodeBanner badge={badge({ expiresAt: Date.now() - 1 })} />);
    expect(container.textContent).toBe("");
  });

  it("disappears when the code expires while open", () => {
    vi.useFakeTimers();
    render(<CodeBanner badge={badge({ expiresAt: Date.now() + 5_000 })} />);
    expect(screen.queryByTestId("code-value")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByTestId("code-value")).toBeNull();
  });
});

describe("CodeChip", () => {
  it("copies on click without letting the row handle the click", async () => {
    const writeText = stubClipboard();
    vi.spyOn(flint, "markCodeUsed").mockResolvedValue();
    const rowClick = vi.fn();
    render(<div onClick={rowClick}><CodeChip badge={badge()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Copy code 530331" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("530331"));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("is hidden once the code is used or expired", () => {
    const { container, rerender } = render(<CodeChip badge={badge({ used: true })} />);
    expect(container.textContent).toBe("");
    rerender(<CodeChip badge={badge({ expiresAt: Date.now() - 1 })} />);
    expect(container.textContent).toBe("");
  });
});

describe("minutesLeft", () => {
  it("rounds up and never shows zero", () => {
    expect(minutesLeft(10 * 60_000, 0)).toBe(10);
    expect(minutesLeft(60_001, 0)).toBe(2);
    expect(minutesLeft(1_000, 0)).toBe(1);
  });
});
