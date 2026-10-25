import type { Address } from "@flint/core";
import { PEOPLE, SENDERS, type PersonKey } from "./people";
import { newsletterHtml, notificationHtml } from "./bodies";
import type { Rng } from "./rng";
import { DAY, type AcctKey, type SeedRecipient, type SeedThread } from "./seedTypes";

const PEOPLE_SUBJECTS: { subject: string; opening: string; reply: string }[] = [
  { subject: "Quick question about the handoff", opening: "Do you have a minute to look at the handoff notes? A couple of states are missing and I want to be sure I read them right.", reply: "Looking now. I will add the missing states to the file by end of day." },
  { subject: "Lunch next week?", opening: "It has been too long. Are you free for lunch Tuesday or Wednesday? I found a place with decent noodles.", reply: "Wednesday works. Noon at the noodle place?" },
  { subject: "Feedback on the onboarding prototype", opening: "I ran five sessions on the onboarding prototype. Short version: step two confuses people. Full notes in the doc.", reply: "That matches what I saw. I will try merging steps two and three." },
  { subject: "Updated brief for the spring campaign", opening: "The brief changed after yesterday's call. The audience is now mostly existing customers, so the tone can be warmer.", reply: "Got it. I will rework the key visuals and send a first pass Thursday." },
  { subject: "Can you review my slide order?", opening: "I reordered the deck so the numbers come before the story. Does it still flow? Be honest.", reply: "Story first still reads better. Put one number up front as a hook, then the narrative." },
  { subject: "Re: contract redlines", opening: "Legal came back with two small redlines, nothing structural. Section 4.2 and the termination notice period.", reply: "Both fine on our side. Send over the clean version when ready." },
  { subject: "Photos from Friday", opening: "Sharing the folder from Friday. The one of the whole group on the stairs came out surprisingly well.", reply: "These are great, thanks for sorting them out." },
  { subject: "Podcast interview request", opening: "I host a small podcast about design systems in practice and would love to have you on. Roughly 30 minutes, remote.", reply: "Happy to. Send me a few dates in November." },
  { subject: "Bug in the export dialog", opening: "Found a bug: exporting at 2x with a transparent background gives a white box on the right edge. Screenshot attached.", reply: "Reproduced. Filing it now, should be a one-line fix." },
  { subject: "Welcome to the team", opening: "Welcome aboard. Your laptop ships Monday and I have put your first week on the calendar. Ping me with anything.", reply: "Thank you, excited to get started." },
  { subject: "Notes from the user interview", opening: "Notes from this morning's interview are in the shared folder. The quote about 'inbox zero as a feeling, not a number' is gold.", reply: "Pulling that quote into the findings page." },
  { subject: "Travel plans for the conference", opening: "Booked the earlier flight so we have the afternoon free. Hotel is two blocks from the venue.", reply: "Perfect, thanks for handling it." },
];

const NOTIF: { sender: Address; subject: string; body: string; button?: string; category: "notifications" }[] = [
  { sender: SENDERS.gitforge, subject: "[northwind/app] Pull request #482: Tighten list virtualization", body: "tomas opened a pull request. 3 files changed, +84 -31. Review requested.", button: "View pull request", category: "notifications" },
  { sender: SENDERS.gitforge, subject: "[northwind/app] Run failed: build on main", body: "The build on main failed in step 'Typecheck'. 2 errors in src/list/Row.tsx.", button: "View run", category: "notifications" },
  { sender: SENDERS.paycart, subject: "Your receipt from Paycart #7721-4410", body: "Thanks for your payment of 29.00 EUR to Orbit Fonts. A copy of your receipt is attached to this email.", category: "notifications" },
  { sender: SENDERS.trackline, subject: "Priya assigned you: Update empty states", body: "Priya Raman assigned you to NW-318 'Update empty states'. Due Friday.", button: "Open task", category: "notifications" },
  { sender: SENDERS.bank, subject: "Card payment of 54.80 EUR", body: "A payment of 54.80 EUR was made with your card ending 4417 at Mercado Central. If this was not you, contact us.", category: "notifications" },
  { sender: SENDERS.deliver, subject: "Your parcel is out for delivery", body: "Parcel 8841-2207 will arrive today between 2 PM and 6 PM. Track it in the app.", button: "Track parcel", category: "notifications" },
  { sender: SENDERS.googleCalendar, subject: "Reminder: Standup @ Mon 9:30am", body: "Standup starts in 30 minutes. Join with the meeting link in the event.", category: "notifications" },
];

const NEWS: { sender: Address; subject: string; headline: string; accent: string }[] = [
  { sender: SENDERS.dispatch, subject: "Dispatch Daily: what happened while you were asleep", headline: "What happened while you were asleep", accent: "#8a1f2d" },
  { sender: SENDERS.bike, subject: "Bike Notes: winter gloves, tested", headline: "Winter gloves, tested", accent: "#2e7d5b" },
  { sender: SENDERS.cooking, subject: "Cooking for One: a soup for a Tuesday", headline: "A soup for a Tuesday", accent: "#c26a1a" },
  { sender: SENDERS.margin, subject: "The Margin Note #211: on keeping a commonplace book", headline: "On keeping a commonplace book", accent: "#b4532a" },
  { sender: SENDERS.frontend, subject: "Frontend Weekly 417: The case for fewer dependencies", headline: "The case for fewer dependencies", accent: "#1f6feb" },
];

const ACCOUNTS: AcctKey[] = ["northwind", "northwind", "northwind", "orbit", "gmail"];
const PERSON_KEYS = Object.keys(PEOPLE) as PersonKey[];
const orgOf = (a: AcctKey): PersonKey[] =>
  a === "northwind" ? ["priya", "tomas", "sofia", "carla", "rodney", "jonas", "meiling"] : a === "orbit" ? ["hiro", "nadia", "daniel", "omar", "amara"] : ["dana", "kofi", "lena", "elena"];

const TRACKED: SeedRecipient[][] = [
  [{ who: PEOPLE.jonas, status: "replied", repliedMinsAfter: 240, opens: [{ minsAfter: 30, kind: "open", client: "Gmail", device: "MacBook, Chrome", location: "Berlin, DE", counted: true }] }],
  [{ who: PEOPLE.daniel, status: "sent" }],
  [{ who: PEOPLE.amara, status: "unknowable", note: "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed.", opens: [{ minsAfter: 1, kind: "prefetch", client: "Apple Mail", device: null, location: null, counted: false }] }],
  [{ who: PEOPLE.omar, status: "opened", forwarded: true, opens: [
    { minsAfter: 12, kind: "open", client: "Outlook", device: "Windows, Outlook 365", location: "Utrecht, NL", counted: true },
    { minsAfter: 3600, kind: "open", client: "Gmail", device: "Android", location: "Rotterdam, NL", counted: true },
  ] }, { who: PEOPLE.daniel, status: "opened", opens: [{ minsAfter: 95, kind: "open", client: "Apple Mail", device: "iPhone", location: "Utrecht, NL", counted: true }] }],
  [{ who: PEOPLE.hiro, status: "opened", opens: [{ minsAfter: 5, kind: "open", client: "Spark", device: "Mac", location: "Tokyo, JP", counted: true }] }],
];
const TRACKED_SUBJECTS = ["Follow-up on our call", "Draft agreement for review", "Intro: Alex <> Amara", "Pricing options", "Timeline for November"];

/** About 100 more threads across the three months so lists scroll and date groups appear. */
export function generateThreads(rng: Rng): SeedThread[] {
  const out: SeedThread[] = [];

  for (let i = 0; i < 52; i++) {
    const t = rng.pick(PEOPLE_SUBJECTS);
    const acct = rng.pick(ACCOUNTS);
    const org = orgOf(acct);
    const a = PEOPLE[rng.pick(org)];
    const b = PEOPLE[rng.pick(org)];
    const count = rng.int(1, 4);
    const start = Math.round(i * 1.6 * DAY + rng.int(30, 1200));
    const msgs: SeedThread["msgs"] = [{ from: a, minsAgo: start, text: t.opening }];
    for (let m = 1; m < count; m++) {
      const mine = m % 2 === 1;
      msgs.push({ from: mine ? "me" : b, to: mine ? [a] : undefined, minsAgo: Math.max(5, start - m * rng.int(40, 600)), text: mine ? t.reply : "Thanks, that works for me.", quote: m > 1, seen: mine ? true : undefined, signature: mine ? "short" : undefined });
    }
    out.push({ acct, subject: t.subject, msgs, unread: i < 6 || rng.chance(0.08), pinned: rng.chance(0.04), labels: rng.chance(0.15) ? ["Clients"] : undefined });
  }

  for (let i = 0; i < 28; i++) {
    const n = rng.pick(NOTIF);
    const acct = rng.pick(ACCOUNTS);
    out.push({
      acct, subject: n.subject, category: "notifications", unread: i < 3,
      msgs: [{ from: n.sender, minsAgo: Math.round(i * 3 * DAY + rng.int(20, 1000)), text: n.body, html: notificationHtml({ title: n.subject, body: n.body, button: n.button }) }],
    });
  }

  for (let i = 0; i < 16; i++) {
    const n = NEWS[i % NEWS.length]!;
    out.push({
      acct: rng.pick(["northwind", "gmail"] as const), subject: n.subject, category: "newsletters", unread: i < 2,
      msgs: [{
        from: n.sender, minsAgo: Math.round(i * 5 * DAY + rng.int(60, 1200)), text: `${n.headline}. Read the full issue online.`,
        html: newsletterHtml({ name: n.sender.name, issue: `Issue ${400 - i}`, headline: n.headline, intro: "A short selection of things worth your time this week, chosen by hand.", accent: n.accent, items: [{ title: "Worth a look", blurb: "A short piece that rewards a slow read." }, { title: "From the archive", blurb: "An older issue that still holds up." }] }),
        unsub: { url: "https://example.com/unsub", oneClick: i % 2 === 0 }, remoteImages: "blocked", hasTrackers: i % 3 === 0,
      }],
    });
  }

  TRACKED.forEach((recipients, i) => {
    const first = recipients[0]!.who;
    out.push({
      acct: "northwind", subject: TRACKED_SUBJECTS[i]!, labels: undefined,
      msgs: [{ from: "me", to: recipients.map((r) => r.who), minsAgo: Math.round((i * 4 + 1) * DAY + 400), text: `Hi ${first.name.split(" ")[0]},\n\nFollowing up on the above. Let me know what you think.\n\nAlex`, signature: "short", seen: true, track: recipients }],
    });
  });

  // A few archived and trashed threads so those views are not empty.
  for (let i = 0; i < 4; i++) {
    const t = PEOPLE_SUBJECTS[i + 4]!;
    out.push({ acct: "northwind", subject: `Archive: ${t.subject}`, location: i % 2 === 0 ? "archive" : "trash", msgs: [{ from: PEOPLE[PERSON_KEYS[i]!], minsAgo: (30 + i * 6) * DAY, text: t.opening, seen: true }] });
  }
  return out;
}
