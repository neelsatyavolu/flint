import FlintModel
import Foundation

/// The first IMAP account: a work mailbox with a tracked send nobody has opened yet.
enum DemoMailboxWork {
    private typealias P = DemoPeople
    private static let day = 1440
    static let trackedRef = "ref-draft-proposal"

    static func messages(now: Date) -> [SeedMessage] {
        var all: [SeedMessage] = []
        all += people(now: now)
        all += notifications()
        all += newsletters()
        all.append(trackedSend())
        return all
    }

    private static func people(now: Date) -> [SeedMessage] {
        let sprint = SeedMessage(
            key: "w-sprint", from: P.priya, to: [P.mayaWork], cc: [P.daniel], subject: "Sprint planning agenda",
            text: "Agenda for Monday:\n\n1. Last sprint, what shipped\n2. Send later: scope and risks\n3. Staffing for the offsite week\n\nAdd anything you want covered.\n\nPriya",
            minutesAgo: 50, unread: true)
        let limits1 = SeedMessage(
            key: "w-limits-1", from: P.daniel, to: [P.mayaWork], subject: "API rate limits",
            text: "Quick question: do we back off on every 429, or only when the server sends Retry-After?\n\nDaniel", minutesAgo: 2 * day)
        let limits2 = SeedQuote.reply(
            key: "w-limits-2", to: limits1, from: P.mayaWork, recipients: [P.daniel],
            body: "Only when Retry-After is present. Without it we wait 30 seconds and try once more, then show the error.\n\nMaya",
            minutesAgo: 2 * day - 60, now: now, box: .sent)
        let limits3 = SeedQuote.reply(
            key: "w-limits-3", to: limits2, from: P.daniel, recipients: [P.mayaWork],
            body: "That matches what I saw in the logs. Merging the change now.\n\nDaniel", minutesAgo: day + 100, now: now)
        let benefits = SeedMessage(
            key: "w-benefits", from: P.hr, to: [P.mayaWork], subject: "Benefits enrollment closes Friday",
            text: "Enrollment for next year closes this Friday at 5 pm. The guide is attached. If you do nothing, your current choices carry over.",
            minutesAgo: 2 * day + 90, unread: true,
            attachments: [.init(
                filename: "benefits-guide.pdf", contentType: "application/pdf",
                data: SeedFiles.pdf(title: "Benefits guide", lines: ["Health plans", "Dental and vision", "Retirement matching", "Enrollment closes Friday at 5 pm"]))])
        let mentor1 = SeedMessage(
            key: "w-mentor-1", from: P.ravi, to: [P.mayaWork], subject: "Mentoring session notes",
            text: "Notes from today:\n\n- Write the decision down before the meeting, not after.\n- Ask for the smallest version first.\n- Protect one morning a week.\n\nRavi", minutesAgo: 5 * day)
        let mentor2 = SeedQuote.reply(
            key: "w-mentor-2", to: mentor1, from: P.mayaWork, recipients: [P.ravi],
            body: "These are great. I am trying the protected morning this week.\n\nMaya", minutesAgo: 5 * day - 200, now: now, box: .sent)
        let mentor3 = SeedQuote.reply(
            key: "w-mentor-3", to: mentor2, from: P.ravi, recipients: [P.mayaWork],
            body: "Good. Report back in two weeks.\n\nRavi", minutesAgo: 4 * day + 300, now: now)
        let budget = SeedMessage(
            key: "w-budget", from: P.priya, to: [P.mayaWork], subject: "Offsite budget",
            text: "The numbers are in the attached sheet. We are under by about 8 percent, so there is room for the dinner.\n\nPriya",
            minutesAgo: 5 * day + 40,
            attachments: [.init(filename: "offsite-budget.csv", contentType: "text/csv", data: Data("item,cost\ntrain,1840\nlodge,3200\nmeals,1460\n".utf8))])
        let forwarded = SeedMessage(
            key: "w-forward", from: P.daniel, to: [P.mayaWork], subject: "Fwd: Customer feedback roundup",
            text: "FYI, see the second point.\n\n---------- Forwarded message ---------\nFrom: Support Desk <desk@northwind.example>\nSubject: Customer feedback roundup\n\n1. Customers love the unified inbox.\n2. Several asked whether send later works when the phone is locked.\n3. Search is fast. Nobody mentioned it, which is the point.\n",
            minutesAgo: 3 * day + 30, unread: true)
        return [sprint, limits1, limits2, limits3, benefits, mentor1, mentor2, mentor3, budget, forwarded]
    }

    private static func notifications() -> [SeedMessage] {
        [
            SeedMessage(
                key: "w-tracker", from: P.tracker, to: [P.mayaWork], subject: "NW-214: Send later copy review was assigned to you",
                text: "Priya Natarajan assigned NW-214 to you.\n\nSend later copy review\nPriority: High\nDue: Friday",
                minutesAgo: 95, unread: true, headers: ["x-linear-team": "NW"]),
            SeedMessage(
                key: "w-cal", from: P.calendar, to: [P.mayaWork], subject: "Accepted: Sprint planning @ Mon 10:00 AM",
                text: "Daniel Reyes accepted your invitation to Sprint planning.", minutesAgo: day + 40, headers: P.automated),
            SeedMessage(
                key: "w-ledger", from: P.ledger, to: [P.mayaWork], subject: "Your receipt from Ledger",
                text: "Thanks for your payment of $24.00. A PDF receipt is attached.", minutesAgo: 3 * day, headers: P.automated,
                attachments: [.init(
                    filename: "receipt-1042.pdf", contentType: "application/pdf",
                    data: SeedFiles.pdf(title: "Receipt 1042", lines: ["Ledger Team plan", "1 seat, October", "Total $24.00"]))]),
            SeedMessage(
                key: "w-security", from: P.securityDesk, to: [P.mayaWork], subject: "Security alert: new sign-in to your Northwind account",
                text: "We noticed a new sign-in to your account from an iPad in Lisbon. If this was you, no action is needed.",
                minutesAgo: 25, unread: true, headers: P.automated),
        ]
    }

    private static func newsletters() -> [SeedMessage] {
        [
            SeedMessage(
                key: "w-digest", from: P.digest, to: [P.mayaWork], subject: "Engineering Digest: queues, caches and other small mercies",
                text: "This week: why your queue is probably too deep, a cache invalidation story, and three tools worth a look.",
                html: "<h2>Engineering Digest</h2><p>This week: why your queue is probably too deep, a cache invalidation story, and three tools worth a look.</p><ul><li>Queues you can reason about</li><li>A cache invalidation story</li><li>Three tools worth a look</li></ul>",
                minutesAgo: day + 700, headers: DemoPeople.listHeaders(id: "weekly", host: "engdigest.example")),
            SeedMessage(
                key: "w-radar", from: Address(name: "Dev Radar", address: "issue@devradar.example"), to: [P.mayaWork],
                subject: "Dev Radar #212: Swift concurrency in the wild",
                text: "Issue 212. Swift concurrency patterns from real apps, plus a talk worth your lunch break.",
                html: "<h2>Dev Radar #212</h2><p>Swift concurrency patterns from real apps, plus a talk worth your lunch break.</p>",
                minutesAgo: 4 * day, unread: true, headers: DemoPeople.listHeaders(id: "radar", host: "devradar.example")),
        ]
    }

    private static func trackedSend() -> SeedMessage {
        SeedMessage(
            key: "w-proposal", box: .sent, from: P.mayaWork, to: [P.priya], subject: "Draft proposal for review",
            text: "Hi Priya,\n\nThe draft proposal is in the shared folder. I would value your read on section 3 in particular.\n\nMaya",
            minutesAgo: day + 300, headers: ["x-flint-ref": trackedRef])
    }
}
