import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { appSupportDir, BROWSER_MANIFEST_DIRS, CODES_HOST_NAME, hostManifest, isFlintManifest } from "../contract";
import type { BrowserHelperBrowser } from "../../types";
import { readJson, writeFileAtomic } from "./files";

export type BrowserEnv = {
  /** Home folder whose Library/Application Support holds the browsers' folders. */
  home: string;
  /** Extra folders checked for a browser app bundle (Firefox keeps no data folder until first run). */
  applicationsDirs: string[];
  wrapperPath: string;
};

const manifestFile = (hostsDir: string): string => join(hostsDir, `${CODES_HOST_NAME}.json`);

function detected(env: BrowserEnv, entry: (typeof BROWSER_MANIFEST_DIRS)[number]): boolean {
  const support = appSupportDir(env.home);
  if (existsSync(join(support, entry.appSupport))) return true;
  return entry.id === "firefox" && env.applicationsDirs.some((d) => existsSync(join(d, "Firefox.app")));
}

/** Per-browser state. A manifest counts as installed only when it is Flint's and points at the current wrapper. */
export function browserStatuses(env: BrowserEnv): BrowserHelperBrowser[] {
  const support = appSupportDir(env.home);
  return BROWSER_MANIFEST_DIRS.map((entry) => {
    const manifestPath = manifestFile(join(support, entry.hosts));
    const found = readJson(manifestPath);
    const flint = found.exists && isFlintManifest(found.value);
    const current = flint && (found.value as { path: string }).path === env.wrapperPath;
    return {
      id: entry.id, name: entry.name, family: entry.family, detected: detected(env, entry),
      installed: current, foreign: found.exists && !flint, manifestPath,
    };
  });
}

/** Writes Flint's manifest into every detected browser that has none or has Flint's own. Foreign manifests are left alone. */
export function installManifests(env: BrowserEnv): void {
  for (const b of browserStatuses(env)) {
    if (!b.detected || b.foreign) continue;
    const family = BROWSER_MANIFEST_DIRS.find((e) => e.id === b.id)!.family;
    writeFileAtomic(b.manifestPath, `${JSON.stringify(hostManifest(family, env.wrapperPath), null, 2)}\n`, 0o644);
  }
}

/** Deletes Flint's manifests (detected or not). Foreign ones stay. */
export function removeManifests(env: BrowserEnv): void {
  for (const b of browserStatuses(env)) {
    if (b.foreign || !lstatSync(b.manifestPath, { throwIfNoEntry: false })) continue;
    const found = readJson(b.manifestPath);
    if (found.exists && isFlintManifest(found.value)) unlinkSync(b.manifestPath);
  }
}
