import FlintMail
import FlintModel
import Foundation

/// Demo only (`-FlintSeed demo`): each background run first receives one new message from a fictional person, so a simulated
/// BGTask launch has something to sync and announce. The mail is invented and goes to an in-memory server.
actor DemoBackgroundMail {
    private var delivered = 0
    private let server: FakeMailTransport

    init(server: FakeMailTransport) { self.server = server }

    func deliver(now: Date = Date()) async {
        delivered += 1
        let message = SeedMessage(
            key: "g-background-\(delivered)", from: DemoPeople.hannah, to: [DemoPeople.mayaGoogle],
            subject: "Lunch on Thursday? (\(delivered))",
            text: "Hi Maya,\n\nAre you free for lunch on Thursday? The new place on Alma has a table at noon.\n\nHannah",
            minutesAgo: 0, unread: true)
        await DemoDelivery.deliver([message], to: .google, server: server, now: now, batch: 10 + delivered)
    }

    /// One more sign-in code mail, for tests of the code path in a background run.
    func deliverCode(now: Date = Date()) async {
        delivered += 1
        let message = SeedMessage(
            key: "g-background-code-\(delivered)", from: DemoPeople.signIn, to: [DemoPeople.mayaGoogle],
            subject: "Your Pocket verification code",
            text: "Your Pocket verification code is 61\(delivered)204.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this message.",
            minutesAgo: 0, unread: true)
        await DemoDelivery.deliver([message], to: .google, server: server, now: now, batch: 10 + delivered)
    }
}
