import FlintModel
import Testing
@testable import FlintStore

@Suite("Store contract")
struct StoreContractTests {
    /// Compile-time check: `Store` is the union of the repository protocols the engine and service rely on.
    @Test func storeComposesEveryRepository() {
        func check(_ store: any Store) {
            let _: any AccountsRepository = store
            let _: any FoldersRepository = store
            let _: any IngestRepository = store
            let _: any MessagesRepository = store
            let _: any ThreadsRepository = store
            let _: any DraftsRepository = store
            let _: any ScheduledSendRepository = store
            let _: any RemindersRepository = store
            let _: any LibraryRepository = store
            let _: any RulesRepository = store
            let _: any ContactsRepository = store
            let _: any SettingsRepository = store
            let _: any KeyValueRepository = store
            let _: any PendingOpsRepository = store
            let _: any ReceiptsRepository = store
        }
        _ = check
    }

    @Test func threadQueryDefaultsMatchDesktop() {
        let query = ThreadQuery(view: .inbox)
        #expect(query.limit == 50 && query.sort == .newest && !query.focused && query.accountId == nil)
    }

    @Test func pendingOpSpecCarriesTypedArgument() {
        #expect(PendingOpSpec(kind: .seen, arg: .flag(true)).arg == .flag(true))
        #expect(PendingOpSpec(kind: .moveFolder, arg: .folder(4)).arg == .folder(4))
        #expect(PendingOpSpec(kind: .archive).arg == nil)
    }
}
