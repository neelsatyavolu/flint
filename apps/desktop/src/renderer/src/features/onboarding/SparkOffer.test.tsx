import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../lib/api";
import { ToastProvider } from "../../ui";
import { SparkOffer } from "./SparkOffer";

afterEach(() => vi.restoreAllMocks());

const scan = { path: "/p", signatures: [{ sparkId: "A", name: "Alex", html: "<div>Alex</div>", accounts: [], modifiedAt: 0, matches: [] }] };
const mount = (onDone = vi.fn()) => render(<ToastProvider><SparkOffer onDone={onDone} /></ToastProvider>);

describe("SparkOffer", () => {
  it("offers the import and opens the sheet", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(scan);
    mount();
    expect(await screen.findByText("Bring your signatures from Spark?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("button", { name: "Import 1 signature" })).toBeTruthy();
  });

  it("skips with one click", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(scan);
    const onDone = vi.fn();
    mount(onDone);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalled();
  });

  it.each([["Spark missing", null], ["no signatures", { path: "/p", signatures: [] }]])("stays out of the way when %s", async (_n, result) => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(result);
    const onDone = vi.fn();
    mount(onDone);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByText("Bring your signatures from Spark?")).toBeNull();
  });

  it("stays out of the way when Spark can't be read", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockRejectedValue(new Error("blocked"));
    const onDone = vi.fn();
    mount(onDone);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
