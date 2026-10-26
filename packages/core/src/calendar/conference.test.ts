import { describe, expect, it } from "vitest";
import { cleanDescription, findConference } from "./conference";

describe("findConference", () => {
  it.each([
    ["meet", { googleConference: "https://meet.google.com/abc-defg-hij" }, "Google Meet"],
    ["meet", { description: "Join: https://meet.google.com/lookup/abcd1234ef now" }, "Google Meet"],
    ["zoom", { location: "https://us02web.zoom.us/j/81234567890?pwd=x" }, "Zoom"],
    ["zoom", { description: "see https://company.zoom.us/my/jane.doe." }, "Zoom"],
    ["teams", { vendorUrls: ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0"] }, "Microsoft Teams"],
    ["teams", { description: "<https://teams.live.com/meet/9876543210123>" }, "Microsoft Teams"],
    ["webex", { location: "https://acme.webex.com/acme/j.php?MTID=m123" }, "Webex"],
    ["webex", { description: "https://acme.webex.com/meet/jane" }, "Webex"],
  ])("finds %s", (kind, src, label) => {
    expect(findConference(src)).toMatchObject({ kind, label });
  });

  it("strips trailing punctuation from the link", () => {
    expect(findConference({ description: "Link: https://meet.google.com/abc-defg-hij." })?.url).toBe("https://meet.google.com/abc-defg-hij");
  });
  it("prefers an explicit property over the description", () => {
    const c = findConference({ googleConference: "https://meet.google.com/aaa-bbbb-ccc", description: "https://zoom.us/j/123456789" });
    expect(c?.kind).toBe("meet");
  });
  it("keeps an unrecognized call link as other, labelled by host", () => {
    expect(findConference({ googleConference: "https://whereby.com/acme-standup" })).toMatchObject({ kind: "other", label: "whereby.com", url: "https://whereby.com/acme-standup" });
    expect(findConference({ location: "https://jitsi.example.org/room" })).toMatchObject({ kind: "other" });
  });
  it("is null for a plain address or nothing", () => {
    expect(findConference({ location: "Room 4B, 500 Howard St" })).toBeNull();
    expect(findConference({})).toBeNull();
  });
  it("reads the Zoom meeting id from the URL when the text has none", () => {
    expect(findConference({ location: "https://x.zoom.us/j/81234567890" })?.code).toBe("81234567890");
  });
  it("reads a dial-in number, ignoring bidi marks", () => {
    const c = findConference({ googleConference: "https://meet.google.com/abc-defg-hij", description: "Join by phone\n(US) ‪+1 650-555-0142‬ PIN: 123 456#" });
    expect(c?.phone).toBe("+1 650-555-0142");
  });
});

describe("cleanDescription", () => {
  it("keeps real text and drops Google's footer", () => {
    const raw = "Agenda: budget\n\nInvitation from Google Calendar: https://calendar.google.com/calendar/\n\nYou are receiving this email because you are an attendee.\n\nForwarding this invitation could allow any recipient to modify your RSVP.";
    expect(cleanDescription(raw)).toBe("Agenda: budget");
  });
  it("is null when only boilerplate is left", () => {
    expect(cleanDescription("Join with Google Meet: https://meet.google.com/abc-defg-hij\nPIN: 123 456#", "https://meet.google.com/abc-defg-hij")).toBeNull();
    expect(cleanDescription("   \n ")).toBeNull();
    expect(cleanDescription(null)).toBeNull();
  });
  it("removes a Teams block between rule lines and keeps what is above and below", () => {
    const rule = "_".repeat(80);
    const raw = `Before\n\n${rule}\nMicrosoft Teams meeting\nMeeting ID: 245 987 133 410\n${rule}\n\nAfter`;
    expect(cleanDescription(raw)).toBe("Before\n\nAfter");
  });
  it("keeps an underscore rule that holds real content", () => {
    const rule = "_".repeat(40);
    expect(cleanDescription(`Notes\n${rule}\nSigned, Jo\n${rule}`)).toContain("Signed, Jo");
  });
  it("cuts a Zoom invite at its join block", () => {
    const raw = "Hi there,\nJo is inviting you to a scheduled Zoom meeting.\n\nTopic: Weekly\nTime: Oct 28\n\nJoin Zoom Meeting\nhttps://x.zoom.us/j/1\nMeeting ID: 1";
    expect(cleanDescription(raw)).toBeNull();
    expect(cleanDescription(`Please read the doc first.\n\n${raw}`)).toBe("Please read the doc first.");
  });
  it("converts <br> and collapses blank runs", () => {
    expect(cleanDescription("a<br>b\n\n\n\n\nc")).toBe("a\nb\n\nc");
  });
});
