/* electron-builder configuration (replaces electron-builder.yml so signing can follow the environment).
 *
 *   pnpm dist                  unsigned .app/.dmg/.zip → release/ (local only)
 *   ../../scripts/dist.sh --apple   Developer ID sign + notarize + staple (see APPLE_SIGNING.md)
 *
 * Signing comes from scripts/load-apple-creds.sh, which imports the Developer ID certificate into a temporary
 * keychain and exports CSC_NAME / CSC_KEYCHAIN (never CSC_LINK: electron-builder's import hits a keychain
 * partition-list bug). Notarization needs APPLE_API_KEY (path to .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER.
 *
 *   FLINT_SIGN=1|0       force signing on / off
 *   FLINT_NOTARIZE=0     skip notarization on a signed build
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_IDENTITY = "Ramakrishna Satyavolu (VTQW687WBQ)";
const stripPrefix = (name) => (name || "").replace(/^(Developer ID Application|Developer ID Installer|Apple Development|Apple Distribution):\s*/i, "").trim();

// The shared loader exports APPLE_API_KEY = key id and APPLE_API_KEY_PATH = .p8 path; electron-builder wants the path.
if (process.env.APPLE_API_KEY_PATH && fs.existsSync(process.env.APPLE_API_KEY_PATH)) {
  const isPath = process.env.APPLE_API_KEY && (process.env.APPLE_API_KEY.includes(path.sep) || process.env.APPLE_API_KEY.endsWith(".p8"));
  if (!isPath) {
    if (!process.env.APPLE_API_KEY_ID && process.env.APPLE_API_KEY) process.env.APPLE_API_KEY_ID = process.env.APPLE_API_KEY;
    process.env.APPLE_API_KEY = process.env.APPLE_API_KEY_PATH;
  }
}

const hasIdentity = Boolean(process.env.CSC_KEYCHAIN || process.env.CSC_NAME);
const sign = process.env.FLINT_SIGN !== "0" && (process.env.FLINT_SIGN === "1" || hasIdentity);
const hasNotary = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER);
const notarize = sign && hasNotary && process.env.FLINT_NOTARIZE !== "0";
if (sign) process.env.CSC_NAME = stripPrefix(process.env.CSC_NAME || DEFAULT_IDENTITY);

process.stderr.write(
  sign
    ? `[electron-builder] Signing as ${process.env.CSC_NAME}; notarization ${notarize ? "on" : "off"}\n`
    : "[electron-builder] Building unsigned (run scripts/dist.sh --apple for a release)\n",
);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "co.xanom.flint",
  productName: "Flint",
  copyright: "Xanom",
  directories: { output: "release", buildResources: "build" },
  asar: true,
  // runAsNode stays on: the flint command wrapper runs the bundled CLI with ELECTRON_RUN_AS_NODE.
  electronFuses: {
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  // The main process bundle includes every dependency, so no node_modules ship.
  files: ["out/**", "package.json", "!node_modules/**/*"],
  extraResources: [{ from: "../cli/dist/flint.js", to: "cli/flint.js" }],
  protocols: [{ name: "Mail link", schemes: ["mailto"] }],
  mac: {
    category: "public.app-category.productivity",
    icon: "build/icon.png",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    // Unsigned builds never pick up whatever identity happens to be in the keychain.
    identity: sign ? process.env.CSC_NAME : null,
    hardenedRuntime: sign,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize,
    artifactName: "Flint-${version}-${arch}-mac.${ext}",
  },
  dmg: { artifactName: "Flint-${version}-${arch}.dmg" },
};
