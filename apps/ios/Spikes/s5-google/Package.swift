// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "s5-google",
    platforms: [.macOS(.v15), .iOS("26.0")],
    products: [.library(name: "GoogleOAuthSpike", targets: ["GoogleOAuthSpike"])],
    targets: [
        .target(name: "GoogleOAuthSpike"),
        .testTarget(name: "GoogleOAuthSpikeTests", dependencies: ["GoogleOAuthSpike"]),
    ]
)
