import FlintModel
import Foundation

/// The Google-looking account: personal mail, a tracked send, a calendar invite, newsletters and notifications.
enum DemoMailboxGoogle {
    private typealias P = DemoPeople
    private static let day = 1440

    static func messages(now: Date) -> [SeedMessage] {
        var all: [SeedMessage] = []
        all += roadmap(now: now)
        all += people(now: now)
        all += notifications(now: now)
        all += newsletters(now: now)
        all += trackedSend(now: now)
        return all
    }

    /// Mail that arrives after the first sync, so it counts as new and its verification code is detected.
    static func lateMessages() -> [SeedMessage] {
        [
            SeedMessage(
                key: "g-code", from: P.signIn, to: [P.mayaGoogle], subject: "Your Pocket verification code",
                text: "Your Pocket verification code is 482913.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this message.",
                html: "<p>Your Pocket verification code is</p><p style=\"font-size:28px;letter-spacing:4px\"><strong>482913</strong></p><p>It expires in 10 minutes. If you did not ask for it, ignore this message.</p>",
                minutesAgo: 2, unread: true, headers: P.automated),
        ]
    }

    private static func roadmap(now: Date) -> [SeedMessage] {
        let first = SeedMessage(
            key: "g-roadmap-1", from: P.daniel, to: [P.mayaGoogle], subject: "Q4 roadmap notes",
            text: "Hi Maya,\n\nThe three themes we landed on: faster first sync, a calmer inbox, and send later that survives a locked phone.\n\nCan you take the send later write-up? I would like a draft before Friday.\n\nDaniel",
            minutesAgo: 3 * day)
        let second = SeedQuote.reply(
            key: "g-roadmap-2", to: first, from: P.mayaGoogle, recipients: [P.daniel],
            body: "Yes, I can take it. I will cover what the phone can and cannot do in the background, and what we tell people when it cannot.\n\nMaya",
            minutesAgo: 3 * day - 120, now: now, box: .sent)
        let third = SeedQuote.reply(
            key: "g-roadmap-3", to: second, from: P.daniel, recipients: [P.mayaGoogle],
            body: "Perfect. One more thing: please include the reminder fallback, since that is the part people ask about.\n\nDaniel",
            minutesAgo: 140, now: now, unread: true)
        return [first, second, third]
    }

    private static func people(now: Date) -> [SeedMessage] {
        let dinner1 = SeedMessage(
            key: "g-dinner-1", from: P.chidi, to: [P.mayaGoogle], subject: "Sunday dinner?",
            text: "Maya, are you coming on Sunday? Your cousins are in from Lagos and everyone is asking.\n\nAunt Chidi", minutesAgo: day + 300)
        let dinner2 = SeedQuote.reply(
            key: "g-dinner-2", to: dinner1, from: P.chidi, recipients: [P.mayaGoogle],
            body: "Also, can you bring the jollof? Yours is the one they remember.\n\nAunt Chidi", minutesAgo: 70, now: now, unread: true)

        let lake = SeedMessage(
            key: "g-lake", from: P.lena, to: [P.mayaGoogle], subject: "Photos from the lake",
            text: "Here are the two best ones. The light was gone ten minutes later.\n\nLena",
            minutesAgo: 2 * day + 200,
            attachments: [
                .init(filename: "lake-morning.png", contentType: "image/png", data: SeedFiles.png(width: 900, height: 600, hue: 0.58)),
                .init(filename: "lake-dusk.png", contentType: "image/png", data: SeedFiles.png(width: 900, height: 600, hue: 0.08)),
            ])

        let recipe1 = SeedMessage(
            key: "g-recipe-1", from: P.hannah, to: [P.mayaGoogle], subject: "Recipe swap",
            text: "I will send you my grandmother's plum cake if you send me the pepper soup. Deal?\n\nHannah", minutesAgo: 9 * day)
        let recipe2 = SeedQuote.reply(
            key: "g-recipe-2", to: recipe1, from: P.mayaGoogle, recipients: [P.hannah],
            body: "Deal. Fair warning: the pepper soup has no measurements, only opinions.\n\nMaya", minutesAgo: 9 * day - 90, now: now, box: .sent)
        let recipe3 = SeedQuote.reply(
            key: "g-recipe-3", to: recipe2, from: P.hannah, recipients: [P.mayaGoogle],
            body: "Opinions are fine. Cake recipe below, 175 g sugar, not 150, whatever the card says.\n\nHannah", minutesAgo: 7 * day, now: now)
        let recipe4 = SeedQuote.reply(
            key: "g-recipe-4", to: recipe3, from: P.mayaGoogle, recipients: [P.hannah],
            body: "Made it last night. The 175 g is right.\n\nMaya", minutesAgo: 6 * day, now: now, box: .sent)

        let intro = SeedMessage(
            key: "g-intro-1", from: P.noor, to: [P.mayaGoogle, P.ravi], subject: "Intro: Maya and Ravi",
            text: "Maya, meet Ravi. Ravi runs the mentoring circle I mentioned. Ravi, Maya is building the mail app I keep talking about.\n\nI will let you two take it from here.\n\nNoor",
            minutesAgo: 4 * day)
        let introReply = SeedQuote.reply(
            key: "g-intro-2", to: intro, from: P.ravi, recipients: [P.noor, P.mayaGoogle],
            body: "Thanks, Noor. Maya, would Thursday morning work for a call?\n\nRavi", minutesAgo: 3 * day + 400, now: now)

        let invite = SeedMessage(
            key: "g-invite", from: P.jordan, to: [P.mayaGoogle], subject: "Invitation: Logo review @ Thu 3:00 PM",
            text: "Jordan Ellis invited you to Logo review.\n\nThu 3:00 PM to 3:45 PM, Studio B or video call.\n\nOpen the attached invitation to add it to your calendar.",
            minutesAgo: 190, unread: true,
            attachments: [.init(
                filename: "invite.ics", contentType: "text/calendar",
                data: SeedFiles.calendarInvite(
                    uid: "logo-review-1@ellisdesign.example", title: "Logo review", location: "Studio B", organizer: P.jordan.address,
                    attendee: P.mayaGoogle.address, start: now.addingTimeInterval(3 * 86_400), minutes: 45))])

        let offsite = SeedMessage(
            key: "g-offsite", from: P.daniel, to: [P.mayaGoogle, P.priya], subject: "Offsite logistics",
            text: "Train leaves at 08:40 from platform 3. Lunch is booked at the lodge. Please send dietary notes to Priya by Wednesday.\n\nDaniel",
            minutesAgo: 8 * day)
        let logo = SeedMessage(
            key: "g-logo", from: P.jordan, to: [P.mayaGoogle], subject: "Logo options v3",
            text: "Three directions attached as a link. My pick is the second, the faceted stone with the lighter outline.\n\nJordan",
            minutesAgo: 2 * day + 600)
        let thanks = SeedMessage(
            key: "g-thanks", box: .archive, from: P.ravi, to: [P.mayaGoogle], subject: "Thanks!",
            text: "Thanks for the call on Thursday. Sending the reading list tomorrow.\n\nRavi", minutesAgo: 12 * day)
        let old = SeedMessage(
            key: "g-coupon", box: .trash, from: P.hannah, to: [P.mayaGoogle], subject: "Old coupon",
            text: "Forwarding the coupon, it expired last month, sorry.", minutesAgo: 20 * day)
        return [dinner1, dinner2, lake, recipe1, recipe2, recipe3, recipe4, intro, introReply, invite, offsite, logo, thanks, old]
    }

    private static func notifications(now: Date) -> [SeedMessage] {
        [
            SeedMessage(
                key: "g-pr", from: P.codeForge, to: [P.mayaGoogle], subject: "[orbit/api] Pull request #482: Retry on 429 (review requested)",
                text: "Daniel Reyes requested your review on orbit/api#482.\n\nRetry on 429 with jittered backoff.\n\n  + 38  - 6   4 files changed\n\nView it on Code Forge: https://codeforge.example/orbit/api/pull/482",
                minutesAgo: 40, unread: true, headers: ["x-github-reason": "review_requested"]),
            SeedMessage(
                key: "g-bank", from: P.orbitBank, to: [P.mayaGoogle], subject: "Your October statement is ready",
                text: "Your October statement for the account ending 4417 is ready to view in the Orbit Bank app. No action is needed.",
                html: "<p>Your October statement for the account ending 4417 is ready to view in the Orbit Bank app.</p><p>No action is needed.</p>",
                minutesAgo: 2 * day, headers: P.automated),
            SeedMessage(
                key: "g-parcel", from: P.parcelPost, to: [P.mayaGoogle], subject: "Your order has shipped",
                text: "Good news: your order is on its way.\n\nCarrier: Parcel Post Standard\nTracking: PP-7731-0042\nArrives: in 2 to 3 days\n\nTrack it in the Parcel Post app.",
                minutesAgo: 360, unread: true, headers: P.automated),
        ]
    }

    private static func newsletters(now: Date) -> [SeedMessage] {
        let trellisHeaders = DemoPeople.listHeaders(id: "weekly", host: "trellis.example")
        let fieldHeaders = DemoPeople.listHeaders(id: "daily", host: "fieldnotes.example")
        let makerHeaders = DemoPeople.listHeaders(id: "issue", host: "quarterlymaker.example")
        return [
            SeedMessage(
                key: "g-trellis", from: P.trellis, to: [P.mayaGoogle], subject: "Seven small habits for a quieter inbox",
                text: DemoNewsletterHTML.shortText, html: DemoNewsletterHTML.short(), minutesAgo: day + 120, unread: true, headers: trellisHeaders),
            SeedMessage(
                key: "g-field", from: P.fieldNotes, to: [P.mayaGoogle], subject: "Field Notes: the quiet return of the paper map",
                text: "Maps are back in backpacks. We asked six hikers why.\n\nRead the full story on the site.",
                html: "<h2>The quiet return of the paper map</h2><p>Maps are back in backpacks. We asked six hikers why.</p><p><a href=\"https://fieldnotes.example/maps\">Read the full story</a></p>",
                minutesAgo: 2 * day + 30, headers: fieldHeaders),
            SeedMessage(
                key: "g-maker", from: P.makers, to: [P.mayaGoogle], subject: "Quarterly Maker, Autumn issue: workshops, tools and a very long essay",
                text: DemoNewsletterHTML.longText, html: DemoNewsletterHTML.long(), minutesAgo: day + 500, unread: true, headers: makerHeaders),
        ]
    }

    /// Sent to two people with read receipts on. One opens it, the other replies.
    private static func trackedSend(now: Date) -> [SeedMessage] {
        let sent = SeedMessage(
            key: "g-flat", box: .sent, from: P.mayaGoogle, to: [P.tomas, P.sam], subject: "Flat viewing on Saturday",
            text: "Hi both,\n\nThe agent can show the flat at 11:00 on Saturday. Does that work for you?\n\nMaya",
            minutesAgo: 2 * day, headers: ["x-flint-ref": trackedRef])
        let reply = SeedQuote.reply(
            key: "g-flat-2", to: sent, from: P.sam, recipients: [P.mayaGoogle], body: "Saturday works for me. I will meet you outside.\n\nSam",
            minutesAgo: day + 200, now: now)
        return [sent, reply]
    }

    static let trackedRef = "ref-flat-viewing"
}
