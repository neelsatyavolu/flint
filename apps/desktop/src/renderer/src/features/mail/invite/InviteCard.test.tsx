import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Invite, MessageView } from "@flint/core/types";
import { InviteCard } from "./InviteCard";
import { InviteChip } from "./InviteChip";
import { ToastProvider } from "../../../ui";
import { flint } from "../../../lib/api";
import * as host from "../../../lib/host";

vi.mock("../../../lib/api", () => ({ flint: { rsvp: vi.fn(), inviteConflicts: vi.fn(), connectGoogleCalendar: vi.fn(), subscribe: vi.fn(() => () => {}) } }));

const rsvp = vi.mocked(flint.rsvp), conflicts = vi.mocked(flint.inviteConflicts), connect = vi.mocked(flint.connectGoogleCalendar);
const start = new Date(2026, 9, 27, 15).getTime();
const you = { name: "Alex", address: "alex@me.dev", response: "needs-action", role: "required", rsvp: true, isYou: true } as const;
const guest = (n: number) => ({ name: `Guest ${n}`, address: `g${n}@x.com`, response: "accepted", role: "required", rsvp: true, isYou: false }) as const;

const invite = (o: Partial<Invite> = {}): Invite => ({
  uid: "u1", method: "REQUEST", sequence: 0, recurrenceId: null, title: "Design sync", description: null, start, end: start + 45 * 60_000, allDay: false, startDate: null, endDate: null,
  timeZone: null, recurrence: null, location: null, url: null, conference: null, organizer: { name: "Priya Raman", address: "p@x.com" }, attendees: [you], invitedAs: { address: "alex@me.dev", role: "required", rsvp: true },
  dtstamp: null, source: "google", googleEventUrl: null, reply: null, state: "new", yourResponse: "needs-action", respondedAt: null, yourNote: null, changes: [], newerMessageId: null, rsvpVia: "google-calendar", ...o,
});
const message = (i: Invite): MessageView => ({ id: 9, accountId: "a1", invite: i }) as unknown as MessageView;
const show = (i: Invite, onUpdated = vi.fn()) => render(<ToastProvider><InviteCard message={message(i)} onUpdated={onUpdated} /></ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  conflicts.mockResolvedValue({ status: "unknown", reason: "no-scope" });
});

describe("InviteCard", () => {
  it("sends the answer with the note, updates the card, and refreshes the thread", async () => {
    const onUpdated = vi.fn();
    rsvp.mockResolvedValue(invite({ yourResponse: "accepted", attendees: [{ ...you, response: "accepted" }] }));
    show(invite(), onUpdated);
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Note to the organizer"), { target: { value: " Running 5 min late " } });
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(rsvp).toHaveBeenCalledWith(9, "accepted", "Running 5 min late"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    const yes = await screen.findByRole("button", { name: "Yes" });
    await waitFor(() => expect((yes as HTMLButtonElement).disabled).toBe(false));
    expect(yes.getAttribute("aria-pressed")).toBe("true");
  });

  it("rolls back and says so when the answer fails", async () => {
    rsvp.mockRejectedValue(new Error("offline"));
    show(invite());
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await screen.findByText("Couldn't send your answer. Try again.");
    const no = screen.getByRole("button", { name: "No" }) as HTMLButtonElement;
    await waitFor(() => expect(no.disabled).toBe(false));
    expect(no.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows no answer buttons when cancelled, and strikes the title", () => {
    show(invite({ state: "cancelled", method: "CANCEL", rsvpVia: "none" }));
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.getByText("The organizer cancelled this event.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  });

  it("labels the pending answer while it sends, keeping the chosen button selected", async () => {
    let done!: (v: Invite) => void;
    rsvp.mockReturnValue(new Promise<Invite>((r) => { done = r; }));
    show(invite());
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    const pending = await screen.findByRole("button", { name: "Sending…" });
    expect(pending.getAttribute("aria-pressed")).toBe("true");
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    done(invite({ yourResponse: "tentative" }));
    const maybe = await screen.findByRole("button", { name: "Maybe" });
    await waitFor(() => expect((maybe as HTMLButtonElement).disabled).toBe(false));
  });

  it("hides the guest list on a cancelled event and leaves the organizer line plain", () => {
    show(invite({ state: "cancelled", method: "CANCEL", rsvpVia: "none", attendees: [you, guest(1)] }));
    expect(screen.queryByRole("list", { name: "Guests" })).toBeNull();
    const from = screen.getByText("From").parentElement!;
    expect(from.className).not.toContain("struck");
    expect(screen.getByText("When").parentElement!.className).toContain("struck");
  });

  it("puts Join before the description", () => {
    const { container } = show(invite({ description: "Agenda", conference: { kind: "meet", url: "https://meet.example/x", label: "Google Meet", code: null, phone: null } }));
    const join = screen.getByRole("button", { name: "Join Google Meet" });
    const text = screen.getByText("Agenda");
    expect(container.innerHTML.indexOf(join.outerHTML)).toBeLessThan(container.innerHTML.indexOf(text.outerHTML));
  });

  it("shows what changed on an updated invite", () => {
    show(invite({ state: "updated", changes: [{ field: "location", before: "Atlas room", after: "Harbor room" }] }));
    expect(screen.getByRole("list", { name: "What changed" }).textContent).toContain("Harbor room");
  });

  it("collapses guests after five and expands them", () => {
    show(invite({ attendees: [you, guest(1), guest(2), guest(3), guest(4), guest(5), guest(6)] }));
    expect(screen.getByRole("list", { name: "Guests" }).children).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByRole("list", { name: "Guests" }).children).toHaveLength(7);
  });

  it("opens the join link and Google Calendar", () => {
    const open = vi.spyOn(host, "openExternal").mockImplementation(() => {});
    show(invite({ conference: { kind: "meet", url: "https://meet.example/x", label: "Google Meet", code: null, phone: null }, googleEventUrl: "https://calendar.example/e", location: "214 Mission St" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Google Meet" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Google Calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "214 Mission St" }));
    expect(open.mock.calls.map((c) => c[0])).toEqual(["https://meet.example/x", "https://calendar.example/e", "https://www.google.com/maps/search/?api=1&query=214%20Mission%20St"]);
  });

  it("offers Connect Google Calendar when the scope is missing and refreshes after", async () => {
    const onUpdated = vi.fn();
    connect.mockResolvedValue({} as never);
    show(invite({ rsvpVia: "google-needs-scope" }), onUpdated);
    expect(conflicts).not.toHaveBeenCalled();
    expect(screen.getByText(/Answers are sent as an email reply/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Connect Google Calendar" });
    fireEvent.click(btn);
    await waitFor(() => expect(connect).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it("shows conflicts", async () => {
    conflicts.mockResolvedValue({ status: "conflict", checkedAt: 1, events: [{ title: "1:1 with Tomas", start, end: start + 1, allDay: false }] });
    show(invite());
    expect(await screen.findByText("Conflicts with 1:1 with Tomas")).toBeTruthy();
  });

  it("shows a reply plainly", () => {
    show(invite({ method: "REPLY", state: "reply", rsvpVia: "none", reply: { from: { name: "Carla Mendes", address: "c@x.com" }, response: "accepted", comment: null } }));
    expect(screen.getByText("Carla Mendes accepted your invitation")).toBeTruthy();
  });
});

describe("InviteChip", () => {
  const chip = { uid: "u", method: "REQUEST", title: "Design sync", start, end: start + 1, allDay: false, startDate: null, state: "new", yourResponse: "needs-action", organizerName: null, messageId: 1 } as const;
  it("renders nothing without an invite, and the time with one", () => {
    const now = new Date(2026, 9, 25, 12).getTime();
    const { container, rerender } = render(<InviteChip invite={undefined} now={now} />);
    expect(container.textContent).toBe("");
    rerender(<InviteChip invite={chip} now={now} />);
    expect(container.textContent).toBe("Invite · Tue 3 PM");
  });
});
