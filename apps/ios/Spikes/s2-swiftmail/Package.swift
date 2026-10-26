// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "s2-swiftmail",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/Cocoanetics/SwiftMail.git", revision: "88c45cbd31b347b373f7c87e197be63eb95efbc2"),
    ],
    targets: [
        .executableTarget(name: "probe", dependencies: [.product(name: "SwiftMail", package: "SwiftMail")], path: "Sources/probe"),
    ]
)
