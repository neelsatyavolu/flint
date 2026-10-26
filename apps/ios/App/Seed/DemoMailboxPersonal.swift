import FlintModel
import Foundation

/// The second IMAP account: a personal address with a lease, a bookshop, a train booking and two newsletters.
enum DemoMailboxPersonal {
    private typealias P = DemoPeople
    private static let day = 1440

    static func messages(now: Date) -> [SeedMessage] {
        let book1 = SeedMessage(
            key: "p-club-1", from: P.lena, to: [P.mayaPersonal], subject: "Book club on Thursday",
            text: "We are meeting at my place at 7. The book is the short one about the lighthouse. No spoilers in the chat, please.\n\nLena",
            minutesAgo: 3 * day)
        let book2 = SeedQuote.reply(
            key: "p-club-2", to: book1, from: P.mayaPersonal, recipients: [P.lena],
            body: "I will bring dessert. Can I bring a friend?\n\nMaya", minutesAgo: 3 * day - 150, now: now, box: .sent)
        let book3 = SeedQuote.reply(
            key: "p-club-3", to: book2, from: P.lena, recipients: [P.mayaPersonal],
            body: "Of course. The more the merrier, and the more the louder.\n\nLena", minutesAgo: 95, now: now, unread: true)
        return [
            SeedMessage(
                key: "p-lease", from: P.park, to: [P.mayaPersonal], subject: "Lease renewal for unit 4B",
                text: "Dear Maya,\n\nYour lease ends on 31 December. The renewal terms are attached. Please let me know by the end of next week whether you wish to renew.\n\nJ. Park",
                minutesAgo: day + 180, unread: true,
                attachments: [.init(
                    filename: "lease-renewal-4B.pdf", contentType: "application/pdf",
                    data: SeedFiles.pdf(title: "Lease renewal, unit 4B", lines: ["Term: 12 months", "Start: 1 January", "Rent: unchanged", "Reply by the end of next week"]))]),
            SeedMessage(
                key: "p-books", from: P.sam, to: [P.mayaPersonal], subject: "Your order is ready for pickup",
                text: "Hi Maya, the two books you ordered arrived. We hold them for a week.\n\nSam, Harbor Books", minutesAgo: 4 * day),
            SeedMessage(
                key: "p-garden", from: P.garden, to: [P.mayaPersonal], subject: "Letters from the allotment: planting garlic",
                text: "October is garlic month. Here is how we plant ours, and why we never plant the same bed twice.",
                html: "<h2>Planting garlic</h2><p>October is garlic month. Here is how we plant ours, and why we never plant the same bed twice.</p><p><a href=\"https://gardenandgrain.example/garlic\">Read the guide</a></p>",
                minutesAgo: day + 60, unread: true, headers: DemoPeople.listHeaders(id: "letters", host: "gardenandgrain.example")),
            SeedMessage(
                key: "p-markets", from: P.markets, to: [P.mayaPersonal], subject: "Markets in Brief: a quiet week, mostly",
                text: "Stocks drifted, bonds yawned, and the only headline was about the weather.",
                html: "<h2>A quiet week, mostly</h2><p>Stocks drifted, bonds yawned, and the only headline was about the weather.</p>",
                minutesAgo: 2 * day + 400, headers: DemoPeople.listHeaders(id: "brief", host: "marketsbrief.example")),
            SeedMessage(
                key: "p-rail", from: P.rail, to: [P.mayaPersonal], subject: "Booking confirmation: Porto to Lisbon, Fri 30 Oct",
                text: "Your booking is confirmed.\n\nPorto Campanha 09:12 to Lisboa Santa Apolonia 11:47\nCoach 5, seat 31\nReference: TR-8841-QZ",
                minutesAgo: 8 * 60, unread: true, headers: P.automated),
            SeedMessage(
                key: "p-thanks", from: P.hannah, to: [P.mayaPersonal], subject: "Thank you for the soup",
                text: "The pepper soup arrived hot and was gone in an hour. Thank you, truly.\n\nHannah", minutesAgo: 7 * day),
            SeedMessage(
                key: "p-trash", box: .trash, from: P.garden, to: [P.mayaPersonal], subject: "Seed swap reminder",
                text: "The seed swap was last Saturday. See you next year.", minutesAgo: 25 * day,
                headers: DemoPeople.listHeaders(id: "letters", host: "gardenandgrain.example")),
            book1, book2, book3,
        ]
    }
}
