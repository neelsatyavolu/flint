import { PEOPLE } from "./people";
import type { Rng } from "./rng";
import type { SeedThread } from "./seedTypes";
import { DAY } from "./seedTypes";

const TOPICS: { subject: string; text: string }[] = [
  { subject: "Notes from the vendor review", text: "Attaching my notes from the vendor review. Two of the three quotes came in under budget." },
  { subject: "Offsite logistics", text: "Booked the room for the offsite. Can you confirm the headcount by Friday?" },
  { subject: "Draft of the annual report", text: "Here is a first pass at the annual report. The numbers on page four still need a check." },
  { subject: "Hiring plan for next year", text: "Sketched the hiring plan for next year. Two engineering roles and one designer." },
  { subject: "Contract renewal", text: "The contract renews at the end of the month. Do we want to renegotiate the rate?" },
  { subject: "Workshop recap", text: "Thanks for joining the workshop. The slides and the recording are linked below." },
  { subject: "Travel receipts", text: "Forwarding the travel receipts from the conference. Please file them before the 15th." },
  { subject: "Design review follow-up", text: "A few follow-ups from the design review. Nothing blocking, but worth a look this week." },
];
const SENDERS = [PEOPLE.carla, PEOPLE.rodney, PEOPLE.priya, PEOPLE.tomas, PEOPLE.meiling, PEOPLE.daniel, PEOPLE.sofia, PEOPLE.jonas] as const;

/** Mail from beyond the synced window: 4 to 24 months old. The mock hands it out through loadOlder and server search. */
export function generateOlder(rng: Rng): SeedThread[] {
  const out: SeedThread[] = [];
  for (let i = 0; i < 70; i++) {
    const t = TOPICS[i % TOPICS.length]!;
    const sender = SENDERS[(i * 3) % SENDERS.length]!;
    out.push({
      acct: rng.pick(["northwind", "gmail"] as const),
      subject: `${t.subject}${i >= TOPICS.length ? ` (${Math.floor(i / TOPICS.length) + 1})` : ""}`,
      unread: false,
      msgs: [{ from: sender, minsAgo: Math.round((110 + i * 9) * DAY + rng.int(30, 1200)), text: t.text, seen: true }],
    });
  }
  out.push({
    acct: "northwind", subject: "Quarterly budget rollup",
    msgs: [{ from: { name: "Zed Archive", address: "zed@archive.example" }, minsAgo: 640 * DAY, text: "The quarterly budget rollup, as discussed. Totals are on the second sheet.", seen: true }],
  });
  return out;
}
