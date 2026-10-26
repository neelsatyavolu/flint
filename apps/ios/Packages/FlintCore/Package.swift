// swift-tools-version: 6.0
import PackageDescription

// FlintCore: pure Swift (no UIKit, no SwiftUI). Builds and tests on the Mac host and builds for iOS.
// SwiftMail is pinned by revision (the 1.16.0 commit) because it depends on an unstable swift-nio-imap
// revision, which SwiftPM refuses to combine with a version requirement. Bump deliberately.
let package = Package(
    name: "FlintCore",
    platforms: [.macOS("15.0"), .iOS("26.0")],
    products: [
        .library(name: "FlintModel", targets: ["FlintModel"]),
        .library(name: "FlintStore", targets: ["FlintStore"]),
        .library(name: "FlintMail", targets: ["FlintMail"]),
        .library(name: "FlintClassify", targets: ["FlintClassify"]),
        .library(name: "FlintReceipts", targets: ["FlintReceipts"]),
        .library(name: "FlintHTML", targets: ["FlintHTML"]),
        .library(name: "FlintService", targets: ["FlintService"]),
    ],
    dependencies: [
        .package(url: "https://github.com/Cocoanetics/SwiftMail", revision: "88c45cbd31b347b373f7c87e197be63eb95efbc2"),
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.11.1"),
        .package(url: "https://github.com/scinfu/SwiftSoup", from: "2.14.3"),
        // swift-collections 1.7.x assumes a Swift 6.4 stdlib that Xcode 27's compiler does not have yet
        // (BorrowingIteratorProtocol). Hold at 1.6.0 until it builds again; transitive only, no target imports it.
        .package(url: "https://github.com/apple/swift-collections", exact: "1.6.0"),
    ],
    targets: [
        .target(name: "FlintModel"),
        .target(name: "FlintStore", dependencies: [
            "FlintModel",
            .product(name: "GRDB", package: "GRDB.swift"),
        ]),
        .target(name: "FlintMail", dependencies: [
            "FlintModel",
            "FlintStore",
            .product(name: "SwiftMail", package: "SwiftMail"),
        ]),
        .target(name: "FlintClassify", dependencies: ["FlintModel"]),
        .target(name: "FlintReceipts", dependencies: ["FlintModel", "FlintStore"]),
        .target(name: "FlintHTML", dependencies: [
            "FlintModel",
            .product(name: "SwiftSoup", package: "SwiftSoup"),
        ]),
        .target(name: "FlintService", dependencies: [
            "FlintModel", "FlintStore", "FlintMail", "FlintClassify", "FlintReceipts", "FlintHTML",
        ]),
        .testTarget(
            name: "FlintCoreTests",
            dependencies: ["FlintModel", "FlintStore", "FlintMail", "FlintClassify", "FlintReceipts", "FlintHTML", "FlintService"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
