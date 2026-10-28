import FlintModel
import Foundation

/// `-FlintRoute <spec>` opens a screen right after launch, so screenshots and UI tests reach any screen without tapping:
/// `inbox`, `inbox:<n>` (n-th account, from 0), `pinned`, `drafts`, `scheduled`, `snoozed`, `sent`, `archive`, `trash`, `spam`,
/// `thread:<subject>`, `sidebar`, `search`, `search:<query>`, `settings`, `settings:<section>`, `compose`, `onboarding`.
enum LaunchRoute: Equatable {
    case route(Route)
    /// Open the first conversation (in the unified inbox) whose subject starts with this text.
    case thread(subjectPrefix: String)
    /// Open the n-th account's inbox.
    case account(index: Int)

    static let argumentKey = "FlintRoute"

    static func parse(_ spec: String) -> LaunchRoute? {
        let parts = spec.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        let argument = parts.count > 1 ? parts[1] : nil
        switch parts[0] {
        case "inbox": return argument.flatMap(Int.init).map { .account(index: $0) } ?? .route(.mailbox(.unifiedInbox))
        case "pinned": return .route(.mailbox(.pinned))
        case "drafts": return .route(.mailbox(.drafts))
        case "scheduled": return .route(.mailbox(.scheduled))
        case "snoozed": return .route(.mailbox(.snoozed))
        case "sent": return .route(.mailbox(.sent))
        case "archive": return .route(.mailbox(.archive))
        case "trash": return .route(.mailbox(.trash))
        case "spam": return .route(.mailbox(.spam))
        case "thread": return argument.map { .thread(subjectPrefix: $0) }
        case "sidebar": return .route(.sidebar)
        case "search": return .route(.search(argument))
        case "settings": return .route(.settings(argument.flatMap(SettingsSection.init(rawValue:)) ?? .root))
        case "compose": return .route(.compose(.start(.new())))
        case "onboarding": return .route(.onboarding)
        default: return nil
        }
    }

    static func fromArguments(_ defaults: UserDefaults = .standard) -> LaunchRoute? {
        #if DEBUG
        defaults.string(forKey: argumentKey).flatMap(parse)
        #else
        nil
        #endif
    }
}

extension AppModel {
    /// Applies `-FlintRoute` once the model is ready. Does nothing without the argument.
    func applyLaunchRoute(_ launch: LaunchRoute?) async {
        guard let launch, phase == .ready else { return }
        switch launch {
        case .route(let route):
            navigate(to: route)
        case .account(let index):
            if accounts.indices.contains(index) { navigate(to: .mailbox(.inbox(accounts[index].id))) }
        case .thread(let prefix):
            let page = try? await listThreads(ThreadQuery(view: .inbox, focused: false, limit: 200))
            if let match = page?.items.first(where: { $0.subject.hasPrefix(prefix) }) { navigate(to: .thread(match.id)) }
        }
    }
}
