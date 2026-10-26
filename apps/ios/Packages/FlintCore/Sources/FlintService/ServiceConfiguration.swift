// Everything the app decides when it builds the service: where files live, the seams to the outside world (transport,
// browser, network, HTTP) and timing. Defaults are the production values; tests replace the seams.

import FlintMail
import FlintModel
import FlintReceipts
import Foundation

public struct FlintServiceConfiguration: Sendable {
    /// The Google iOS OAuth client id (public, no secret). Settings > Advanced may override it.
    public static let builtInGoogleClientId = "617596563618-84523hu1pellgad03t263u2mqig2i45i.apps.googleusercontent.com"

    /// Holds `flint.sqlite` and `drafts/`. Application Support on iOS.
    public var dataDirectory: URL
    /// Holds the attachment cache. Caches on iOS (the system may purge it).
    public var cacheDirectory: URL
    public var secrets: any SecretStore
    public var transport: MailTransportFactory
    /// Runs the Google sign-in page (`ASWebAuthenticationSession` in the app).
    public var browser: any OAuthBrowser
    public var http: HTTPClient
    public var autoconfig: AutoconfigDeps
    public var network: (any NetworkMonitoring)?
    public var receiptsTransport: any ReceiptsTransport
    public var session: SessionConfigurationOverrides
    public var clock: @Sendable () -> EpochMs
    /// The send scheduler is only pumped while the app is in the foreground. Tests turn the pump off and call `runDueWork()`.
    public var runsScheduler: Bool
    /// Starts account sync with `start()`. Off in tests that drive sync by hand.
    public var autoSync: Bool

    public init(
        dataDirectory: URL, cacheDirectory: URL, secrets: any SecretStore, browser: any OAuthBrowser,
        transport: @escaping MailTransportFactory = SwiftMailTransport.factory, http: HTTPClient = .live,
        autoconfig: AutoconfigDeps = .live, network: (any NetworkMonitoring)? = NWPathNetworkMonitor(),
        receiptsTransport: any ReceiptsTransport = URLSessionReceiptsTransport(), session: SessionConfigurationOverrides = .init(),
        clock: @escaping @Sendable () -> EpochMs = { Int((Date().timeIntervalSince1970 * 1000).rounded()) },
        runsScheduler: Bool = true, autoSync: Bool = true
    ) {
        self.dataDirectory = dataDirectory
        self.cacheDirectory = cacheDirectory
        self.secrets = secrets
        self.browser = browser
        self.transport = transport
        self.http = http
        self.autoconfig = autoconfig
        self.network = network
        self.receiptsTransport = receiptsTransport
        self.session = session
        self.clock = clock
        self.runsScheduler = runsScheduler
        self.autoSync = autoSync
    }

    var databasePath: String { dataDirectory.appendingPathComponent("flint.sqlite").path }
    var draftsDirectory: URL { dataDirectory.appendingPathComponent("drafts", isDirectory: true) }
}

/// The sync timings a test or a diagnostics build may change. Nil keeps the engine default.
public struct SessionConfigurationOverrides: Sendable {
    public var pollInterval: Duration?
    public var idlePollInterval: Duration?
    public var backoffMinimum: Duration?
    public var backoffMaximum: Duration?

    public init(pollInterval: Duration? = nil, idlePollInterval: Duration? = nil, backoffMinimum: Duration? = nil, backoffMaximum: Duration? = nil) {
        self.pollInterval = pollInterval
        self.idlePollInterval = idlePollInterval
        self.backoffMinimum = backoffMinimum
        self.backoffMaximum = backoffMaximum
    }

    func apply(to config: inout SessionConfiguration) {
        if let pollInterval { config.pollInterval = pollInterval }
        if let idlePollInterval { config.idlePollInterval = idlePollInterval }
        if let backoffMinimum { config.backoffMinimum = backoffMinimum }
        if let backoffMaximum { config.backoffMaximum = backoffMaximum }
    }
}
