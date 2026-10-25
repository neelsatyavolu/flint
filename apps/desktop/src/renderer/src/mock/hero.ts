import { PEOPLE as P, SENDERS as S } from "./people";
import { SIGNATURES, forwardedBlock, newsletterHtml, notificationHtml, textToMailHtml } from "./bodies";
import { DAY, type SeedThread } from "./seedTypes";

const pdf = (filename: string, size: number) => ({ filename, contentType: "application/pdf", size });
const png = (filename: string, size: number) => ({ filename, contentType: "image/png", size });
const xlsx = (filename: string, size: number) => ({ filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size });

/** Handwritten threads that exercise the UI: long project threads, forwards, newsletters, notifications, tracked mail. */
export const HERO_THREADS: SeedThread[] = [
  {
    acct: "northwind", subject: "Freelancing Cycle 3", pinned: true, unread: true, labels: ["Clients"],
    msgs: [
      { from: P.carla, to: [P.rodney], minsAgo: 21 * DAY, text: "Hi Rodney, kicking off the third cycle. Alex will lead design again. Can you send over the revised scope by Friday?", cc: [] },
      { from: P.rodney, to: [P.carla], minsAgo: 20 * DAY, text: "Scope attached. Two changes: the onboarding flow is now in, and the reporting dashboard moves to cycle 4.", attach: [pdf("Cycle3-scope-v2.pdf", 482_113)] },
      { from: "me", to: [P.carla, P.rodney], minsAgo: 19 * DAY + 300, text: "Thanks both. I read through the scope. The onboarding flow is a bigger lift than the dashboard was, so I would like to talk about timing before we commit to the March date.", quote: true, signature: "short" },
      { from: P.carla, minsAgo: 19 * DAY, text: "Fair point. Rodney, do we have any slack on the launch side?" },
      { from: P.rodney, minsAgo: 18 * DAY + 200, text: "A week, maybe ten days. Anything past that and we collide with the partner event.", quote: true },
      { from: "me", to: [P.carla, P.rodney], minsAgo: 18 * DAY, text: "Then let's plan for the earlier date and cut the in-app tour from cycle 3. I will send a revised estimate tomorrow.", signature: "short" },
      { from: "me", to: [P.carla, P.rodney], minsAgo: 17 * DAY, text: "Revised estimate attached. Total comes to 212 hours across design and prototyping, with a 15 percent buffer.", attach: [xlsx("Cycle3-estimate.xlsx", 38_920)], signature: "short" },
      { from: P.carla, minsAgo: 15 * DAY, text: "Approved on our side. Rodney will countersign the agreement this week." },
      { from: P.rodney, minsAgo: 9, text: "Countersigned copy is attached. Carla, please file it and send Alex the kickoff invite for Monday. Alex, can you confirm you can start Monday morning?", attach: [pdf("Cycle3-agreement-signed.pdf", 211_480)], quote: true },
    ],
  },
  {
    acct: "northwind", subject: "Q4 roadmap review: Thursday 2pm", unread: true, pinned: false,
    msgs: [
      { from: P.priya, to: [P.tomas, P.sofia], minsAgo: 6 * DAY, text: "I booked the review for Thursday at 2pm. The agenda is in the doc. Please add your open questions before Wednesday night." },
      { from: P.tomas, minsAgo: 5 * DAY + 400, text: "Can we move it to 3pm? I have a customer call that might run over.", quote: true },
      { from: P.sofia, minsAgo: 5 * DAY + 300, text: "3pm works for me." },
      { from: "me", to: [P.priya, P.tomas, P.sofia], minsAgo: 5 * DAY + 200, text: "3pm is fine. I will have the design section ready by Wednesday noon.", signature: "short" },
      { from: P.priya, minsAgo: 5 * DAY + 100, text: "Done, moved to 3pm. Thanks all." },
      { from: P.tomas, minsAgo: 47, text: "One more thing for Thursday: can we add 10 minutes on the pricing page experiment? The first numbers are in and they are interesting." },
    ],
  },
  {
    acct: "northwind", subject: "Fwd: Invoice 2291 from Quillworks", labels: ["Receipts"],
    msgs: [
      { from: P.amara, to: [P.sofia], minsAgo: 4 * DAY + 600, text: "Hi Sofia, attached is invoice 2291 for the September typesetting work. Net 30.", attach: [pdf("Invoice-2291.pdf", 94_330)] },
      {
        from: P.sofia, to: [], minsAgo: 4 * DAY, text: "Alex, forwarding this one for you to approve. It matches the PO.",
        html: textToMailHtml("Alex, forwarding this one for you to approve. It matches the PO.") +
          forwardedBlock(P.amara, "Invoice 2291 from Quillworks", "Fri, Oct 17, 2026 at 9:14 AM", "Sofia Bianchi", textToMailHtml("Hi Sofia, attached is invoice 2291 for the September typesetting work. Net 30.")),
        attach: [pdf("Invoice-2291.pdf", 94_330)],
      },
      { from: "me", to: [P.sofia], minsAgo: 3 * DAY + 900, text: "Approved. Please schedule payment for the 30th.", signature: "short", seen: true },
    ],
  },
  {
    acct: "northwind", subject: "Brand refresh: logo options v2", unread: false, labels: ["Clients"],
    msgs: [
      { from: P.meiling, to: [P.priya], cc: [], minsAgo: 32 * DAY, text: "First round of marks attached. I explored three directions: monoline, faceted, and a type-only wordmark.", attach: [png("marks-round1.png", 2_410_552)] },
      { from: P.priya, minsAgo: 31 * DAY, text: "The faceted one has legs. Alex, thoughts?" },
      { from: "me", to: [P.meiling, P.priya], minsAgo: 31 * DAY - 120, text: "Faceted is the strongest, mostly because it reads at 16px. The type-only option loses too much at small sizes.", signature: "plain" },
      { from: P.meiling, minsAgo: 29 * DAY, text: "Great, refining the faceted direction. Do you want a spark element or keep it pure?" },
      { from: "me", to: [P.meiling], minsAgo: 29 * DAY - 60, text: "Try a small spark as a separate shape so we can use the mark with or without it.", signature: "plain" },
      { from: P.meiling, minsAgo: 24 * DAY, text: "Round 2 attached. Spark is detachable. I also added a one-color version.", attach: [png("marks-round2.png", 1_120_338), pdf("marks-round2-sheet.pdf", 640_219)] },
      { from: P.priya, minsAgo: 23 * DAY, text: "Love the detachable spark. Tomas, can engineering export these as SVG?" },
      { from: P.tomas, minsAgo: 23 * DAY - 200, text: "Yes. Send us the source file and we will handle the export." },
      { from: P.meiling, minsAgo: 22 * DAY, text: "Source file attached.", attach: [{ filename: "flint-marks.fig", contentType: "application/octet-stream", size: 5_882_001 }] },
      { from: "me", to: [P.meiling, P.priya, P.tomas], minsAgo: 21 * DAY, text: "All set on my side. Marking this thread done. Thanks, Mei-Ling.", signature: "rich" },
      { from: P.meiling, minsAgo: 20 * DAY, text: "Thank you all. Invoice coming separately." },
    ],
  },
  {
    acct: "northwind", subject: "Re: Offsite venue shortlist", labels: ["Team"],
    msgs: [
      { from: P.sofia, to: [P.priya, P.tomas], minsAgo: 12 * DAY, text: "Shortlist of three venues: a lake house (2h away), a converted warehouse in town, and a mountain lodge. Prices in the sheet." },
      { from: P.tomas, minsAgo: 11 * DAY, text: "Lake house, if the Wi-Fi is real. Last time the 'high speed internet' was a hotspot.", quote: true },
      { from: P.priya, minsAgo: 11 * DAY - 300, text: "Warehouse is cheapest but I worry about energy. Lodge is lovely and expensive.", quote: true },
      { from: "me", to: [P.sofia, P.priya, P.tomas], minsAgo: 10 * DAY, text: "Vote for the lake house. Sofia, can you ask them about Wi-Fi in writing?", quote: true, signature: "short" },
      { from: P.sofia, minsAgo: 3 * DAY, text: "Asked. They have fibre and a backup line. I will book if nobody objects by Friday.", quote: true },
    ],
  },
  {
    acct: "northwind", subject: "Proposal: Harborline site rebuild", labels: ["Clients"],
    msgs: [
      {
        from: "me", to: [P.elena, P.marcus], cc: [P.ines], minsAgo: 2 * DAY + 180, signature: "rich",
        text: "Hi Elena, Marcus, Ines,\n\nThanks for the time on Monday. Attached is our proposal for the Harborline site rebuild: scope, timeline and a fixed price. Happy to walk through it whenever suits.\n\nBest,\nAlex",
        attach: [pdf("Harborline-proposal.pdf", 1_804_220)],
        track: [
          { who: P.elena, status: "opened", opens: [
            { minsAfter: 18, kind: "open", client: "Gmail", device: "MacBook, Chrome", location: "Lisbon, PT", counted: true },
            { minsAfter: 1020, kind: "open", client: "Gmail", device: "iPhone", location: "Lisbon, PT", counted: true },
          ] },
          { who: P.marcus, status: "opened", forwarded: true, opens: [
            { minsAfter: 52, kind: "open", client: "Outlook", device: "Windows, Outlook 365", location: "Porto, PT", counted: true },
            { minsAfter: 2870, kind: "open", client: "Apple Mail", device: "iPad", location: "Madrid, ES", counted: true },
          ] },
          { who: P.ines, status: "unknowable", note: "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed.", opens: [
            { minsAfter: 1, kind: "prefetch", client: "Apple Mail", device: null, location: null, counted: false },
          ] },
        ],
      },
    ],
  },
  {
    acct: "northwind", subject: "Security alert", category: "notifications", unread: true,
    msgs: [
      { from: S.googleSecurity, minsAgo: 130, text: "A new sign-in on a Mac was detected for alex@northwind.dev. If this was you, you don't need to do anything.", html: notificationHtml({ title: "New sign-in on a Mac", body: "Your Account alex@northwind.dev was just signed in to from a new Mac. If this was you, you don't need to do anything. If not, we'll help you secure your account.", button: "Check activity" }), textOnly: false },
    ],
  },
  {
    acct: "northwind", subject: "Invitation: Design sync @ Wed Oct 29, 10:30am (alex@northwind.dev)", category: "notifications",
    msgs: [
      { from: S.googleCalendar, minsAgo: 1 * DAY + 90, text: "Priya Raman has invited you to Design sync. When: Wed Oct 29, 10:30am - 11:00am. Where: Meet. Reply: Yes, No, Maybe.", html: notificationHtml({ title: "Design sync", body: "Priya Raman invited you. Wed Oct 29, 10:30am - 11:00am (GMT+1). Joining info: meet link in the calendar event.", button: "Yes" }) },
    ],
  },
  {
    acct: "northwind", subject: "#212: The slow web is not coming back, and that's fine", category: "newsletters", unread: true,
    msgs: [
      {
        from: S.margin, minsAgo: 200, text: "The Margin Note, issue 212. This week: the slow web, a typographer's guide to line length, and a small tool for quiet reading.",
        html: newsletterHtml({ name: "The Margin Note", issue: "No. 212", headline: "The slow web is not coming back, and that is fine", intro: "Every few months someone declares the return of the personal website. This week we look at what actually changed, and what small habits are worth keeping.", accent: "#b4532a", items: [
          { title: "A typographer's guide to line length", blurb: "Why 66 characters keeps turning up, and what to do when your column is narrower than that." },
          { title: "A quiet reading tool worth trying", blurb: "A tiny extension that strips pages down to text and a single typeface, with no account." },
          { title: "Letters: your replies on RSS", blurb: "Readers weigh in on feeds, newsletters and the case for boring formats." },
        ] }),
        unsub: { url: "https://example.com/unsubscribe", mailto: "unsubscribe@themarginnote.example", oneClick: true }, remoteImages: "blocked", hasTrackers: true,
      },
    ],
  },
  {
    acct: "northwind", subject: "Frontend Weekly 418: Container queries in practice", category: "newsletters",
    msgs: [
      {
        from: S.frontend, minsAgo: 2 * DAY + 400, text: "This week: container queries in practice, a CSS anchor positioning tour, and the state of view transitions.",
        html: newsletterHtml({ name: "Frontend Weekly", issue: "418", headline: "Container queries in practice", intro: "Three months in, here is what teams actually use container queries for, and where they still reach for media queries.", accent: "#1f6feb", items: [
          { title: "CSS anchor positioning: a tour", blurb: "Tooltips and popovers without a positioning library, with real fallbacks." },
          { title: "View transitions in a multi-page app", blurb: "A working example, plus the two gotchas that cost us an afternoon." },
        ] }),
        unsub: { url: "https://example.com/unsub", oneClick: false }, remoteImages: "blocked", seen: true,
      },
    ],
  },
  {
    acct: "gmail", subject: "Weekend trip", labels: [],
    msgs: [
      { from: P.dana, to: [], minsAgo: 3 * DAY, text: "Hey Alex,\n\nAre you still up for the coast this weekend? Mom wants to do lunch on Saturday if the weather holds. I can drive, you bring the playlist.\n\nAlso, don't forget to bring back the tent from last summer. It's in your garage, I'm fairly sure.\n\nDana", textOnly: true },
      { from: "me", to: [P.dana], minsAgo: 3 * DAY - 180, text: "In. Lunch Saturday works. The tent is definitely in the garage, I will check the poles.\n\nAlex", textOnly: true, seen: true },
      { from: P.dana, minsAgo: 26, text: "Perfect. Leaving at 9 on Saturday, I'll text you the pickup spot.\n\nD", textOnly: true },
    ],
    unread: true,
  },
  {
    acct: "gmail", subject: "Dinner Saturday?",
    msgs: [
      { from: P.kofi, minsAgo: 5 * DAY, text: "Thinking of trying that new Ethiopian place on Elm. Saturday 7:30? I'll book a table for four if you and Lena are in." },
      { from: "me", to: [P.kofi], minsAgo: 5 * DAY - 120, text: "Count us in. Lena says yes as well.", seen: true },
    ],
  },
  {
    acct: "gmail", subject: "Your flight to Lisbon is confirmed", category: "notifications", pinned: true,
    msgs: [
      { from: S.aerolux, minsAgo: 7 * DAY, text: "Booking AX4P7Q. Outbound Fri Nov 14, 8:55 AM. Return Sun Nov 23, 6:20 PM. Check-in opens 24 hours before departure.", html: notificationHtml({ title: "You're booked: Lisbon", body: "Booking reference AX4P7Q. Outbound Fri Nov 14, 08:55. Return Sun Nov 23, 18:20. Check-in opens 24 hours before departure.", button: "Manage booking" }), attach: [pdf("Itinerary-AX4P7Q.pdf", 128_004)] },
    ],
  },
  {
    acct: "orbit", subject: "Studio rent renewal", labels: ["Team"],
    msgs: [
      { from: P.hiro, to: [P.nadia], minsAgo: 8 * DAY, text: "Landlord sent the renewal terms: 3 percent increase, one-year term. Alex, I think we should take it, but check the clause about subletting." },
      { from: P.nadia, minsAgo: 7 * DAY + 400, text: "Subletting clause is the same as last year. I'm fine with it.", quote: true },
      { from: "me", to: [P.hiro, P.nadia], minsAgo: 7 * DAY, text: "Same read. Hiro, go ahead and sign. I will transfer my share this week.", signature: "plain", quote: true },
      { from: P.hiro, minsAgo: 5 * DAY, text: "Signed and sent. Thanks both." },
    ],
  },
  {
    acct: "orbit", subject: "Your hosting invoice for October", category: "notifications",
    msgs: [
      { from: S.cloudhost, minsAgo: 3 * DAY + 60, text: "Your October invoice is ready: 41.20 EUR. It will be charged on Nov 1.", html: notificationHtml({ title: "Invoice ready: 41.20 EUR", body: "Your October invoice for studio-orbit.com hosting is ready. It will be charged to the card ending 4417 on Nov 1.", button: "View invoice" }), seen: true },
    ],
  },
  {
    acct: "orbit", subject: "Moodboard for the Lumen packaging", labels: [],
    msgs: [
      { from: P.daniel, to: [P.omar], minsAgo: 45 * DAY, text: "Sharing the moodboard for the Lumen packaging. Mostly matte, warm neutrals, one hot accent." },
      { from: "me", to: [P.daniel], minsAgo: 44 * DAY, text: "Love the direction. Can we see the accent in two intensities?", signature: "plain", seen: true },
      { from: P.daniel, minsAgo: 43 * DAY, text: "Two intensities attached.", attach: [png("accent-a.png", 880_112), png("accent-b.png", 901_440)] },
    ],
  },
  {
    acct: "orbit", subject: "Newsletter spam test", category: "newsletters", location: "spam",
    msgs: [
      { from: { name: "Deal Desk", address: "offers@bulk-deals.example" }, minsAgo: 6 * DAY, text: "Limited time offer on bulk storage. Reply STOP to opt out.", unsub: { mailto: "stop@bulk-deals.example", oneClick: false } },
    ],
  },
  {
    acct: "northwind", subject: "Re: Pricing page copy", blocked: true, location: "trash",
    msgs: [
      { from: { name: "Growth Hacker Pro", address: "outreach@growth-hacker.example" }, minsAgo: 12 * DAY, text: "Hi there, I'd love to get 15 minutes on your calendar to talk about 10x-ing your pipeline." },
    ],
  },
];
