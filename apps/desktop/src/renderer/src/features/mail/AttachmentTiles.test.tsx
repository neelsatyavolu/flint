import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AttachmentInfo } from "@flint/core";
import { ToastProvider } from "../../ui";
import { flint } from "../../lib/api";
import { AttachmentTiles, fileKind, previewable } from "./AttachmentTiles";

vi.mock("../../lib/api", () => ({ flint: { saveAttachment: vi.fn(), openAttachment: vi.fn(), subscribe: vi.fn(() => () => {}) } }));

const file = (id: number, filename: string, contentType: string, over: Partial<AttachmentInfo> = {}): AttachmentInfo => ({ id, filename, contentType, size: 2048, inline: false, contentId: null, ...over });
const show = (list: AttachmentInfo[]) => render(<ToastProvider><AttachmentTiles attachments={list} /></ToastProvider>);

beforeEach(() => {
  vi.mocked(flint.saveAttachment).mockReset();
  vi.mocked(flint.openAttachment).mockReset().mockResolvedValue(undefined);
});

describe("fileKind", () => {
  it("reads the content type first, then the extension", () => {
    expect(fileKind({ contentType: "image/png", filename: "a.bin" })).toBe("image");
    expect(fileKind({ contentType: "application/pdf", filename: "a" })).toBe("pdf");
    expect(fileKind({ contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "a" })).toBe("doc");
    expect(fileKind({ contentType: "application/vnd.ms-excel", filename: "a" })).toBe("sheet");
    expect(fileKind({ contentType: "application/zip", filename: "a" })).toBe("zip");
    expect(fileKind({ contentType: "application/octet-stream", filename: "Budget.XLSX" })).toBe("sheet");
    expect(fileKind({ contentType: "application/octet-stream", filename: "notes" })).toBe("file");
  });

  it("never previews SVG", () => {
    expect(previewable({ contentType: "image/svg+xml", filename: "logo.svg" })).toBe(false);
    expect(previewable({ contentType: "image/jpeg", filename: "a.jpg" })).toBe(true);
  });
});

describe("AttachmentTiles", () => {
  it("shows a thumbnail for images and opens other files", () => {
    const { container } = show([file(1, "photo.jpg", "image/jpeg"), file(2, "report.pdf", "application/pdf")]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("flint-attachment://1");
    fireEvent.click(screen.getByRole("button", { name: "Open report.pdf" }));
    expect(flint.openAttachment).toHaveBeenCalledWith(2);
  });

  it("previews images in a dialog and steps through them with the arrow keys", () => {
    show([file(1, "a.jpg", "image/jpeg"), file(2, "doc.pdf", "application/pdf"), file(3, "b.png", "image/png")]);
    fireEvent.click(screen.getByRole("button", { name: "Preview a.jpg" }));
    expect(screen.getByRole("dialog", { name: "a.jpg" })).toBeTruthy();
    expect(screen.getByText(/1 of 2/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "b.png" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "a.jpg" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Save all for several files and reports the count", async () => {
    vi.mocked(flint.saveAttachment).mockResolvedValue("/Downloads/x");
    show([file(1, "a.pdf", "application/pdf"), file(2, "b.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(screen.getByText("Saved 2 files to Downloads")).toBeTruthy());
    expect(flint.saveAttachment).toHaveBeenCalledTimes(2);
  });

  it("names the files Save all could not save", async () => {
    vi.mocked(flint.saveAttachment).mockImplementation(async (id) => (id === 2 ? Promise.reject(new Error("disk")) : "/x"));
    show([file(1, "a.pdf", "application/pdf"), file(2, "b.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(screen.getByText("Saved 1 of 2 files. Couldn't save b.pdf.")).toBeTruthy());
  });

  it("has no Save all for a single file and hides inline parts", () => {
    show([file(1, "a.pdf", "application/pdf"), file(2, "logo.png", "image/png", { inline: true })]);
    expect(screen.queryByRole("button", { name: "Save all" })).toBeNull();
    expect(screen.queryByText("logo.png")).toBeNull();
  });
});
