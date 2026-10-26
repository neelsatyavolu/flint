import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SettingsProvider } from "../settingsStore";
import { CalendarsSection } from "./CalendarsSection";

afterEach(() => vi.restoreAllMocks());
const wrap = (ui: React.ReactNode) => render(<ToastProvider><SettingsProvider>{ui}</SettingsProvider></ToastProvider>);

describe("CalendarsSection", () => {
  it("shows hint rows for mail accounts without a calendar", async () => {
    wrap(<CalendarsSection />);
    const hints = await screen.findAllByText(/are answered by email\. Add a calendar to update your calendar too\./);
    expect(hints.length).toBeGreaterThan(0);
  });

  it("adds an iCloud calendar, validating first, and shows the addresses it covers", async () => {
    const add = vi.spyOn(flint, "addCalDavAccount");
    wrap(<CalendarsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Add iCloud Calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add calendar" }));
    expect(await screen.findByText("Enter your Apple ID.")).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Apple ID/), { target: { value: "neel@icloud.com" } });
    fireEvent.change(screen.getByLabelText(/^App-specific password/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Add calendar" }));
    expect(await screen.findByText("The server rejected the username or password.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^App-specific password/), { target: { value: "abcd-efgh" } });
    fireEvent.change(screen.getByLabelText(/Also answers invitations/), { target: { value: "neel@xanom.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Add calendar" }));
    await waitFor(() => expect(add).toHaveBeenLastCalledWith({ preset: "icloud", username: "neel@icloud.com", password: "abcd-efgh", extraAddresses: ["neel@xanom.co"] }));
    expect((await screen.findAllByText(/neel@icloud.com, neel@xanom.co/)).length).toBeGreaterThan(0);
  });

  it("adds Google Calendar with the address as login hint, then edits and removes it", async () => {
    const google = vi.spyOn(flint, "addGoogleCalendarAccount");
    const update = vi.spyOn(flint, "updateCalendarAccount");
    const remove = vi.spyOn(flint, "removeCalendarAccount");
    wrap(<CalendarsSection page="neel@xanom.co" />);
    fireEvent.click(await screen.findByRole("button", { name: "Google Calendar" }));
    expect((screen.getByLabelText(/Google account email/) as HTMLInputElement).value).toBe("neel@xanom.co");
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(google).toHaveBeenCalledWith({ loginHint: "neel@xanom.co" }));
    const field = await screen.findByLabelText("Add an address");
    fireEvent.change(field, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    expect(screen.getByRole("alert").textContent).toMatch(/not a full email/);
    fireEvent.change(field, { target: { value: "alias@xanom.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.any(String), { extraAddresses: ["alias@xanom.co"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove calendar" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
