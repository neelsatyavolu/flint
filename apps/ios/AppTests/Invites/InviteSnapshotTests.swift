@testable import Flint
import FlintModel
import SwiftUI
import Testing

/// Renders the card for every state in both themes. Each render must produce an image; when `TEST_RUNNER_FLINT_SHOT_DIR` is set the
/// PNGs are written there as `invite-<state>-<theme>.png` for the human review the plan asks for.
@MainActor
@Suite("Invite card render")
struct InviteSnapshotTests {
    typealias F = InviteFixtures
    typealias M = InviteModelFixtures

    private struct Scenario {
        var name: String
        var files: [(id: Int, name: String)]
        var open: Int
        var now: Int = F.now
        var answer: RSVPAnswer?
    }

    private let scenarios = [
        Scenario(name: "new", files: [(1, "brand-review-v0.ics")], open: 1),
        Scenario(name: "answered", files: [(1, "brand-review-v0.ics")], open: 1, answer: .accepted),
        Scenario(name: "updated", files: [(1, "brand-review-v0.ics"), (2, "brand-review-v1.ics")], open: 2),
        Scenario(name: "cancelled", files: [(2, "brand-review-v1.ics"), (3, "brand-review-cancel.ics")], open: 3),
        Scenario(name: "weekly-meet", files: [(1, "google-weekly-meet.ics")], open: 1),
        Scenario(name: "zoom", files: [(1, "outlook-zoom.ics")], open: 1),
        Scenario(name: "allday", files: [(1, "apple-allday.ics")], open: 1),
        Scenario(name: "reply", files: [(1, "google-reply.ics")], open: 1),
        Scenario(name: "past", files: [(1, "brand-review-v0.ics")], open: 1, now: F.utc(2026, 11, 20)),
    ]

    private func model(_ scenario: Scenario) async -> InviteCardModel {
        let spy = InviteSpy()
        let messages = scenario.files.map { M.message($0.id, ics: F.fixture($0.name)) }
        var files: [Int: String] = [:]
        for file in scenario.files { files[file.id * 10] = F.fixture(file.name) }
        let services = M.services(files: files, spy: spy, now: scenario.now)
        let model = InviteCardModel()
        let opened = messages.first { $0.id == scenario.open }!
        await model.load(message: opened, thread: messages, accountName: "Neel Rao", ownAddresses: F.own, services: services)
        if let answer = scenario.answer { await model.answer(answer, services: services) }
        return model
    }

    private func image(_ model: InviteCardModel, id: Int, scheme: ColorScheme) -> Data? {
        guard let merged = model.merged, let times = model.times else { return nil }
        let view = InviteCardContent(messageId: id, merged: merged, times: times, model: model, onAnswer: { _ in }, onAddToCalendar: {}, onJoin: { _ in })
            .padding(FlintMetrics.Space.s4)
            .frame(width: 380)
            .background(FlintColor.plane1)
            .environment(\.colorScheme, scheme)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        return renderer.uiImage?.pngData()
    }

    @Test("every state renders in Graphite and Paper")
    func render() async throws {
        let dir = ProcessInfo.processInfo.environment["FLINT_SHOT_DIR"]
        if let dir { try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true) }
        for scenario in scenarios {
            let model = await model(scenario)
            for (scheme, theme) in [(ColorScheme.dark, "dark"), (ColorScheme.light, "light")] {
                let data = try #require(image(model, id: scenario.open, scheme: scheme), "\(scenario.name) did not render")
                #expect(data.count > 2000)
                if let dir { try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent("invite-\(scenario.name)-\(theme).png")) }
            }
        }
    }
}
