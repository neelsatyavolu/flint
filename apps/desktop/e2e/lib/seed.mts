import type { Delivery, GreenMail } from "../../../../packages/core/test/greenmail.ts";
import { gradientPng } from "./png.mts";

const H = 3_600_000;
const D = 24 * H;

type Person = { name: string; email: string };
const P = {
  priya: { name: "Priya Raman", email: "priya@acme.dev" },
  marco: { name: "Marco Bellini", email: "marco@studiofarina.it" },
  june: { name: "June Okafor", email: "june@okafor.design" },
  sam: { name: "Sam Whitlock", email: "sam@whitlock.co" },
  lena: { name: "Lena Hoffmann", email: "lena@hoffmann-legal.de" },
  github: { name: "GitHub", email: "notifications@github.com" },
  stripe: { name: "Stripe", email: "receipts@stripe.com" },
  linear: { name: "Linear", email: "notifications@linear.app" },
  bytes: { name: "The Weekly Byte", email: "hello@weeklybyte.news" },
  atlas: { name: "Atlas Travel", email: "deals@atlas-travel.example" },
  brew: { name: "Brewline Coffee", email: "orders@brewline.example" },
} satisfies Record<string, Person>;
const addr = (p: Person): string => `${p.name} <${p.email}>`;

function newsletterHtml(opts: { brand: string; accent: string; headline: string; blurb: string; items: string[] }): string {
  const rows = opts.items.map((t, i) => `<tr><td style="padding:14px 0;border-top:1px solid #e9e6df;font:15px/1.45 Georgia,serif;color:#1d1c18"><span style="font:600 12px Helvetica,Arial;color:${opts.accent};letter-spacing:.06em">0${i + 1}</span><br>${t}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:6px">
<tr><td style="background:${opts.accent};padding:28px 32px;color:#fff;font:700 22px Helvetica,Arial">${opts.brand}</td></tr>
<tr><td style="padding:0"><img src="https://images.example.com/hero-${opts.brand.length}.jpg" width="600" height="220" alt="Hero" style="display:block;width:100%;height:auto;background:#dcd6c8"></td></tr>
<tr><td style="padding:32px 32px 8px"><h1 style="margin:0 0 12px;font:700 28px/1.2 Georgia,serif;color:#1d1c18">${opts.headline}</h1><p style="margin:0;font:16px/1.55 Helvetica,Arial;color:#4a483f">${opts.blurb}</p></td></tr>
<tr><td style="padding:8px 32px 24px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
<tr><td align="center" style="padding:8px 32px 32px"><a href="https://weeklybyte.example/read" style="display:inline-block;background:${opts.accent};color:#fff;text-decoration:none;font:600 15px Helvetica,Arial;padding:12px 28px;border-radius:4px">Read the full issue</a></td></tr>
<tr><td style="padding:20px 32px;background:#faf8f3;font:12px/1.5 Helvetica,Arial;color:#8a867a">You are receiving this because you subscribed. <a href="https://weeklybyte.example/unsub" style="color:#8a867a">Unsubscribe</a><img src="https://track.weeklybyte.example/o.gif?u=abc" width="1" height="1" alt="" style="display:block"></td></tr>
</table></td></tr></table></body></html>`;
}

function build(): Delivery[] {
  const now = Date.now();
  const at = (ago: number): Date => new Date(now - ago);
  const unsub = (host: string): Record<string, string> => ({ "List-Unsubscribe": `<https://${host}/unsub?id=1>, <mailto:unsub@${host}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  const out: Delivery[] = [];

  // People thread with replies (Priya, 4 messages).
  const t1 = "<launch-1@acme.dev>";
  out.push({ from: addr(P.priya), subject: "Launch checklist for Thursday", messageId: t1, date: at(2 * D + 3 * H), text: "Hi,\n\nI put together the checklist for Thursday's launch. Three things still need an owner:\n\n1. Final copy review on the pricing page\n2. Status page banner\n3. The rollback plan\n\nCan you take the rollback plan? I can handle the pricing copy.\n\nPriya" });
  out.push({ from: addr(P.sam), subject: "Re: Launch checklist for Thursday", messageId: "<launch-2@whitlock.co>", inReplyTo: t1, references: t1, date: at(2 * D), text: "I can take the status page banner. Draft text below.\n\n\"We are deploying a scheduled update between 14:00 and 14:30 UTC. Mail sync may pause briefly.\"\n\nSam\n\n> Hi,\n> I put together the checklist for Thursday's launch. Three things still need an owner:" });
  out.push({ from: addr(P.priya), subject: "Re: Launch checklist for Thursday", messageId: "<launch-3@acme.dev>", inReplyTo: "<launch-2@whitlock.co>", references: `${t1} <launch-2@whitlock.co>`, date: at(1 * D + 6 * H), text: "Banner text looks good. Marco confirmed he can do the design pass tomorrow morning, so the pricing page will have the new layout before copy review.\n\nOne question: are we still on for the 14:00 UTC window, or should we move to 16:00 so the EU team is around?\n\nPriya" });
  out.push({ from: addr(P.sam), subject: "Re: Launch checklist for Thursday", messageId: "<launch-4@whitlock.co>", inReplyTo: "<launch-3@acme.dev>", references: `${t1} <launch-2@whitlock.co> <launch-3@acme.dev>`, date: at(5 * H), text: "16:00 works for me. I'll update the banner and move the calendar hold. Rollback plan is in the doc, please skim section 3 before the dry run.\n\nSam" });

  // Short people mails.
  out.push({ from: addr(P.marco), subject: "Logo exploration, round two", date: at(3 * H), text: "Ciao,\n\nattached are the three directions we talked about. My favourite is the second one, the spark reads clearly even at 16px.\n\nLet me know what you think before Friday.\n\nMarco", attachments: [
    { filename: "directions-v2.png", content: gradientPng(320, 200, [40, 44, 60], [76, 141, 255]), contentType: "image/png" },
    { filename: "notes.txt", content: "Direction 1: wordmark only\nDirection 2: spark + wordmark\nDirection 3: monogram\n", contentType: "text/plain" },
  ] });
  out.push({ from: addr(P.june), subject: "Coffee next week?", date: at(26 * H), text: "Are you around Tuesday or Wednesday afternoon? I'm in town and would love to catch up. No agenda, just coffee." });
  out.push({ from: addr(P.lena), subject: "Contract draft: please review", date: at(4 * D), text: "Dear colleague,\n\nPlease find the revised service agreement below. The main changes are in clauses 4 (liability cap) and 9 (termination notice).\n\nBest regards,\nLena Hoffmann" });

  // Forwarded message.
  out.push({ from: addr(P.sam), subject: "Fwd: Venue quote for the offsite", date: at(8 * H), text: "FYI, this is the quote I mentioned. Thoughts on the second option?\n\n---------- Forwarded message ---------\nFrom: Hotel Aurelia <events@aurelia.example>\nDate: Mon, 19 Oct 2026 at 10:12\nSubject: Venue quote for the offsite\nTo: Sam Whitlock <sam@whitlock.co>\n\nDear Sam,\n\nThank you for your enquiry. For 24 guests over two nights we can offer:\n\nOption A: Garden room, EUR 4,800 total\nOption B: Terrace suite with catering, EUR 6,250 total\n\nThis offer is valid until 30 October.\n\nKind regards,\nHotel Aurelia events team" });

  // Inline image message.
  const inline = gradientPng(480, 240, [255, 190, 120], [200, 80, 90]);
  out.push({ from: addr(P.june), subject: "New homepage hero, what do you think", date: at(30 * H), html: `<div style="font:15px/1.5 Helvetica,Arial;color:#222"><p>Here is the hero I was describing:</p><p><img src="cid:hero@flint.test" alt="Homepage hero mockup" width="480" height="240" style="border-radius:4px"></p><p>The warm gradient carries the whole page. Next up is the pricing section.</p><p>June</p></div>`, attachments: [{ filename: "hero.png", content: inline, contentType: "image/png", cid: "hero@flint.test" }] });

  // Newsletters with HTML designs.
  out.push({ from: addr(P.bytes), subject: "The Weekly Byte: SQLite is eating the backend", date: at(4 * H), headers: unsub("weeklybyte.news"), html: newsletterHtml({ brand: "The Weekly Byte", accent: "#c2410c", headline: "SQLite is eating the backend", blurb: "Local-first apps keep winning, and this week three more teams moved their primary store off a managed Postgres.", items: ["Why one file beats a fleet of services for most products", "A field guide to WAL mode and what it changes", "Benchmarks: 50k writes per second on a laptop", "The case against microservices, ten years on"] }), text: "The Weekly Byte. SQLite is eating the backend." });
  out.push({ from: addr(P.atlas), subject: "Lisbon from 189 EUR, plus 4 more fares we spotted", date: at(2 * D + 8 * H), headers: unsub("atlas-travel.example"), html: newsletterHtml({ brand: "Atlas Travel", accent: "#0f766e", headline: "Five fares worth a second look", blurb: "Prices dropped on routes out of Amsterdam, Berlin and Paris this week. Most are valid through March.", items: ["Lisbon, from 189 EUR return", "Porto, from 204 EUR return", "Madeira, from 249 EUR return", "Seville, from 176 EUR return"] }), text: "Atlas Travel fares." });
  out.push({ from: addr(P.brew), subject: "Your order has shipped", date: at(9 * H), headers: unsub("brewline.example"), html: `<div style="max-width:560px;margin:0 auto;font:15px/1.5 -apple-system,Helvetica,Arial;color:#2b2a26;padding:24px"><h2 style="margin:0 0 8px">Your beans are on the way</h2><p>Order #48213 shipped today and should arrive Thursday.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;border-bottom:1px solid #eee">Ethiopia Guji, 250g x2</td><td align="right" style="border-bottom:1px solid #eee">24.00</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #eee">Colombia Huila, 250g</td><td align="right" style="border-bottom:1px solid #eee">13.50</td></tr></table><p><a href="https://brewline.example/track/48213" style="color:#1d4ed8">Track your package</a></p><img src="https://brewline.example/p.gif" width="1" height="1" alt=""></div>`, text: "Order #48213 shipped." });

  // Notifications.
  out.push({ from: addr(P.github), subject: "[flint] Pull request #214: Fix scheduler wake after sleep", date: at(2 * H), text: "A new pull request was opened by priya.\n\nFix scheduler wake after sleep\n\nView it on GitHub: https://github.com/example/flint/pull/214", headers: { "List-Id": "<flint.example.github.com>" } });
  out.push({ from: addr(P.github), subject: "[flint] CI failed on main", date: at(20 * H), text: "The workflow 'test' failed on main at 7f3c9a1.\n\nView details: https://github.com/example/flint/actions/runs/1", headers: { "List-Id": "<flint.example.github.com>" } });
  out.push({ from: addr(P.linear), subject: "FLT-88 assigned to you: Snooze presets ignore time zone", date: at(7 * H), text: "Priya assigned FLT-88 to you.\n\nSnooze presets ignore time zone\nPriority: High\n\nhttps://linear.app/flint/issue/FLT-88", headers: { "List-Id": "<flint.linear.app>" } });
  out.push({ from: addr(P.stripe), subject: "Your receipt from Flint Labs [#1842-3391]", date: at(3 * D), html: `<div style="max-width:520px;margin:0 auto;font:14px/1.5 Helvetica,Arial;color:#32325d;padding:24px"><h3>Receipt from Flint Labs</h3><p>Amount paid: <strong>USD 19.00</strong></p><p>Paid October 22, 2026</p></div>`, text: "Receipt from Flint Labs. Amount paid USD 19.00.", headers: { "Precedence": "bulk" } });
  return out;
}

/** A second, smaller mailbox with different mail so the unified inbox shows two real accounts. */
function buildWork(): Delivery[] {
  const now = Date.now();
  const at = (ago: number): Date => new Date(now - ago);
  const out: Delivery[] = [];
  const q1 = "<q3-1@northwind.example>";
  out.push({ from: "Dana Whitfield <dana@northwind.example>", subject: "Q3 planning: draft agenda", messageId: q1, date: at(6 * H), text: "Team,\n\nHere is the draft agenda for Thursday's planning session:\n\n- Review of Q2 results\n- Hiring plan\n- Roadmap trade-offs\n\nPlease add anything I missed." });
  out.push({ from: "Omar Haddad <omar@northwind.example>", subject: "Re: Q3 planning: draft agenda", messageId: "<q3-2@northwind.example>", inReplyTo: q1, references: q1, date: at(4 * H), text: "Can we add 15 minutes on the support backlog? It has doubled since March.\n\nOmar" });
  out.push({ from: "Dana Whitfield <dana@northwind.example>", subject: "Invoice 2026-0418 attached", date: at(52 * H), text: "Hello,\n\nPlease find invoice 2026-0418 attached. Payment is due in 14 days.\n\nDana", attachments: [{ filename: "invoice-2026-0418.pdf", content: "%PDF-1.4\n%fake\n", contentType: "application/pdf" }] });
  out.push({ from: addr(P.github), subject: "[northwind/api] Issue #77: Rate limit headers missing", date: at(10 * H), text: "A new issue was opened.\n\nRate limit headers missing on 429 responses.\nhttps://github.com/northwind/api/issues/77", headers: { "List-Id": "<api.northwind.github.com>" } });
  out.push({ from: "Ines Duarte <ines@northwind.example>", subject: "Lunch on Wednesday?", date: at(70 * H), text: "A few of us are going to the noodle place on Wednesday at 12:30. Join?" });
  return out;
}

export async function seedMail(gm: GreenMail, userNames: string[]): Promise<number> {
  let n = 0;
  const personal = build();
  const work = buildWork();
  const [first, second] = userNames;
  for (const m of personal) { await gm.deliver({ ...m, to: gm.user(first!).email }); n++; }
  if (second) for (const m of work) { await gm.deliver({ ...m, to: gm.user(second).email }); n++; }
  return n;
}
