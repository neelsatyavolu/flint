// swift-tools-version:5.9
import Foundation
import PackageDescription

// Absolute path, so `swift build` works from any directory.
let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Sources/FlintAutofill/Info.plist").path

// FlintAutofill: system-wide verification code autofill through macOS Accessibility.
//   FlintAutofillCore  pure logic (protocol, field classification, geometry); Foundation only, fully unit tested
//   FlintAutofill      the executable: AX / AppKit / CGEvent glue around the core
// Build universal:  swift build -c release --arch arm64 --arch x86_64   (scripts/build-autofill-helper.sh)
// The Info.plist is embedded in the binary so System Settings shows "Flint" for the Accessibility entry.
let package = Package(
    name: "FlintAutofill",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "FlintAutofill", targets: ["FlintAutofill"])],
    targets: [
        .target(name: "FlintAutofillCore"),
        .executableTarget(
            name: "FlintAutofill",
            dependencies: ["FlintAutofillCore"],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist]),
            ]
        ),
        .testTarget(
            name: "FlintAutofillCoreTests",
            dependencies: ["FlintAutofillCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
