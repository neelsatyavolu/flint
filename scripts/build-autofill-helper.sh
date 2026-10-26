#!/usr/bin/env bash
# Builds the FlintAutofill helper as a universal (arm64 + x86_64) release binary and copies it to
# apps/autofill-helper/dist/FlintAutofill, where electron-builder picks it up (extraResources).
# scripts/dist.sh runs this before electron-builder. Signing happens in electron-builder (mac.binaries).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/autofill-helper"
cd "$PKG"
swift build -c release --arch arm64 --arch x86_64
# SwiftPM's Xcode build system puts the universal product in .build/out/Products/Release; the classic one in .build/apple/Products/Release.
BIN=""
for c in .build/out/Products/Release/FlintAutofill .build/apple/Products/Release/FlintAutofill; do [ -x "$c" ] && { BIN="$c"; break; }; done
[ -n "$BIN" ] || { echo "error: FlintAutofill was not built" >&2; exit 1; }
[ "$(lipo -archs "$BIN" | tr ' ' '\n' | sort | tr '\n' ' ')" = "arm64 x86_64 " ] || { echo "error: $BIN is not universal" >&2; exit 1; }
mkdir -p dist
cp "$BIN" dist/FlintAutofill
echo "==> $(lipo -archs dist/FlintAutofill) dist/FlintAutofill"
dist/FlintAutofill --self-test
