import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ScheduledSend } from "@flint/core";
import { flint } from "../../lib/api";
import { ToastProvider } from "../../ui";
import { ScheduledView } from "./ScheduledView";

const hoisted = vi.hoisted(() => ({ openComposer: vi.fn() }));
vi.mock("../compose/composerStore", async (importOriginal) => ({ ...(await importOriginal<object>()), openComposer: hoisted.openComposer }));

const failed: ScheduledSend = {
  id: 41, draftId: 7, subject: "Quarterly plan", to: [{ name: "Bob", address: "bob@x.test" }], sendAt: Date.now() - 60_000,
  status: "failed", error: "550 5.7.1 Relaying denied for bob@x.test: the server refused the message", requestedBy: "user",
};

const show = () => render(<ToastProvider><ScheduledView /></ToastProvider>);

afterEach(() => {
  vi.restoreAllMocks();
  hoisted.openComposer.mockReset();
});

describe("ScheduledView", () => {
  it("shows a failed send's full error with Edit and resend and Retry", async () => {
    vi.spyOn(flint, "listScheduled").mockResolvedValue([failed]);
    show();
    await screen.findByText(failed.error!);
    expect(screen.getByRole("button", { name: "Edit and resend" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Edit and resend clears the failure and reopens the draft", async () => {
    vi.spyOn(flint, "listScheduled").mockResolvedValue([failed]);
    const cancel = vi.spyOn(flint, "cancelSend").mockResolvedValue({} as never);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit and resend" }));
    await vi.waitFor(() => expect(hoisted.openComposer).toHaveBeenCalledWith({ draftId: 7 }));
    expect(cancel).toHaveBeenCalledWith(41);
  });

  it("Retry clears the failure and sends the draft right away", async () => {
    vi.spyOn(flint, "listScheduled").mockResolvedValue([failed]);
    const order: string[] = [];
    vi.spyOn(flint, "cancelSend").mockImplementation(async () => { order.push("cancel"); return {} as never; });
    const send = vi.spyOn(flint, "sendDraft").mockImplementation(async () => { order.push("send"); return {} as never; });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("Sending again.");
    expect(order).toEqual(["cancel", "send"]);
    expect(send.mock.calls[0]![0]).toBe(7);
  });

  it("offers Try again when the list can't load", async () => {
    const list = vi.spyOn(flint, "listScheduled").mockRejectedValueOnce(new Error("The database is locked.")).mockResolvedValue([]);
    show();
    await screen.findByText("Couldn't load scheduled mail.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await screen.findByText("Nothing scheduled.");
    expect(list).toHaveBeenCalledTimes(2);
  });
});
