import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MessageView } from "@flint/core/types";
import { MessageItem } from "../MessageItem";
import { ToastProvider } from "../../../ui";
import { AppContext, type AppData } from "../../../state/AppContext";
import { defaultSettings } from "../../../mock/fixtures";

vi.mock("../../../lib/avatarImages", () => ({ useAvatarImage: () => null }));
vi.mock("../../../lib/api", () => ({ flint: { inviteConflicts: vi.fn().mockResolvedValue({ status: "unknown", reason: "no-scope" }), subscribe: vi.fn(() => () => {}) } }));

const app = { settings: defaultSettings(), updateSettings: async () => defaultSettings(), accounts: [], refreshAccounts: () => undefined, sidebar: undefined, narrow: false, selfAddresses: [] } as unknown as AppData;
const start = new Date(2026, 9, 27, 15).getTime();
const message = {
  id: 1, accountId: "a1", threadId: 1, messageId: "<i@x>", from: [{ name: "Priya", address: "p@x.com" }], to: [], cc: [], bcc: [], replyTo: [], subject: "Invitation", date: start, seen: true, pinned: false,
  isFromMe: false, snippet: "", html: null, text: "Generated invite boilerplate", bodyLoaded: true, remoteImages: "allowed", hasTrackers: false, unsubscribe: null, receipt: null,
  attachments: [{ id: 1, filename: "invite.ics", contentType: "text/calendar", size: 10, inline: false, contentId: null }, { id: 2, filename: "agenda.pdf", contentType: "application/pdf", size: 10, inline: false, contentId: null }],
  invite: { uid: "u", method: "REQUEST", sequence: 0, recurrenceId: null, title: "Design sync", description: null, start, end: start + 3_600_000, allDay: false, startDate: null, endDate: null, timeZone: null, recurrence: null, location: null, url: null, conference: null, organizer: null, attendees: [], invitedAs: null, dtstamp: null, source: "other", googleEventUrl: null, reply: null, state: "new", yourResponse: "needs-action", respondedAt: null, yourNote: null, changes: [], newerMessageId: null, rsvpVia: "none" },
} as unknown as MessageView;

describe("MessageItem with an invitation", () => {
  it("shows the card, hides the .ics tile, and keeps the original behind Show original", () => {
    render(<ToastProvider><AppContext.Provider value={app}><MessageItem message={message} expanded selfAddresses={[]} onToggle={() => {}} onUpdated={() => {}} now={start} /></AppContext.Provider></ToastProvider>);
    expect(screen.getByRole("region", { name: "Invitation: Design sync" })).toBeTruthy();
    expect(screen.queryByText("invite.ics")).toBeNull();
    expect(screen.getByText("agenda.pdf")).toBeTruthy();
    expect(screen.queryByText("Generated invite boilerplate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText("Generated invite boilerplate")).toBeTruthy();
  });
});
