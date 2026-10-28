import FlintMail
import FlintModel
import FlintService
import Foundation

/// Settings, accounts and sync. Account calls throw so the add-account and account-detail screens show their own messages.
extension AppModel {
    // MARK: Settings

    /// Deep-merges a partial JSON patch into the settings. `settings` updates from the stream. Returns nil after showing an error.
    @discardableResult
    func updateSettings(patch: JSONValue) async -> Settings? {
        do { return try await requireService().updateSettings(patch: patch) } catch {
            report(error)
            return nil
        }
    }

    @discardableResult
    func updateSettings(_ settings: Settings) async -> Settings? {
        do { return try await requireService().updateSettings(settings) } catch {
            report(error)
            return nil
        }
    }

    // MARK: Accounts

    func autoconfig(email: String) async throws -> AutoconfigResult? { try await requireService().autoconfig(email: email) }
    func autoconfigAdvice(email: String) async -> ProviderAdvice? { await service?.autoconfigAdvice(email: email) }
    func testConnection(_ input: AddAccountInput) async throws -> ConnectionCheck { try await requireService().testConnection(input) }
    func addAccount(_ input: AddAccountInput) async throws -> Account { try await requireService().addAccount(input) }
    func addGoogleAccount(loginHint: String? = nil) async throws -> Account { try await requireService().addGoogleAccount(loginHint: loginHint) }
    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account { try await requireService().updateAccount(id: id, patch) }

    /// Removes the account and its mail. If the open list belongs to it, goes back to the unified inbox.
    func removeAccount(id: AccountID) async throws {
        try await requireService().removeAccount(id: id)
        switch mailbox {
        case .inbox(let account?) where account == id: navigate(to: .mailbox(.unifiedInbox))
        case .folder(let account, _) where account == id: navigate(to: .mailbox(.unifiedInbox))
        default: break
        }
    }

    // MARK: Sync

    /// Pull to refresh. Syncs one account or all and reports a failure as a toast.
    func syncNow(accountId: AccountID? = nil) async {
        do { try await requireService().syncNow(accountId: accountId) } catch { report(error) }
        // Pull to refresh on all accounts also asks the receipts service (4A).
        if accountId == nil, let service { await ReceiptsPoller.shared.pollIfDue(ServiceReceiptsSource(service: service), force: true) }
    }

    func syncStatus(for id: AccountID) -> SyncStatus? { syncStatuses.first { $0.accountId == id } }
}
