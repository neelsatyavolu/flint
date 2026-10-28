#!/bin/bash
# Usage: scripts/gen-project.sh
# Generates Flint.xcodeproj with XcodeGen and pins the app build to the package versions `swift test` uses: FlintCore's
# committed Package.resolved is copied into the project's workspace, where Xcode reads its resolved versions. Build and archive
# with `-onlyUsePackageVersionsFromResolvedFile` (scripts/testflight.sh and scripts/verify.sh do) so a mismatch fails the build
# instead of resolving to newer packages. Run this instead of a bare `xcodegen generate`.
set -euo pipefail
cd "$(dirname "$0")/.."
xcodegen generate >/dev/null
PINS=Flint.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
mkdir -p "$PINS"
cp Packages/FlintCore/Package.resolved "$PINS/Package.resolved"
echo "gen-project: Flint.xcodeproj generated, packages pinned to Packages/FlintCore/Package.resolved"
