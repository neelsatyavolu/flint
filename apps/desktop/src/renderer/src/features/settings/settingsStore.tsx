import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DeepPartial, Settings } from "@flint/core";
import { flint } from "../../lib/api";
import { useToast } from "../../ui/Toast";

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isPlain(base) || !isPlain(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = merge(out[k], v);
  }
  return out;
}

/** Immutable deep merge, mirroring what updateSettings does on the other side of IPC. */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  return merge(base, patch) as Settings;
}

export type SettingsStore = {
  settings: Settings;
  /** Applies the patch at once, then confirms with the service. Reverts and shows a toast on failure. */
  save: (patch: DeepPartial<Settings>) => Promise<boolean>;
};

const Ctx = createContext<SettingsStore | null>(null);

export function useSettingsStore(): SettingsStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettingsStore must be used inside SettingsProvider");
  return v;
}

/** Loads settings once, keeps them live through 'settings' events, and offers optimistic saves. */
export function SettingsProvider({ children, fallback, initial }: { children: ReactNode; fallback?: ReactNode; initial?: Settings }) {
  const toast = useToast();
  // The app already holds settings, so a screen opened from it paints at once instead of waiting for a second load.
  const [settings, setSettings] = useState<Settings | undefined>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const current = useRef<Settings | undefined>(initial);
  const seq = useRef(0);

  const apply = useCallback((next: Settings) => {
    current.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    let alive = true;
    flint.getSettings().then(
      (s) => alive && seq.current === 0 && apply(s),
      () => alive && setLoadError("Couldn't load settings. Close this view and open it again."),
    );
    const off = flint.subscribe((e) => {
      if (e.type === "settings" && alive) apply(e.settings);
    });
    return () => {
      alive = false;
      off();
    };
  }, [apply]);

  const save = useCallback(
    async (patch: DeepPartial<Settings>): Promise<boolean> => {
      const before = current.current;
      if (!before) return false;
      const id = ++seq.current;
      apply(mergeSettings(before, patch));
      try {
        const confirmed = await flint.updateSettings(patch);
        if (id === seq.current) apply(confirmed);
        return true;
      } catch (err) {
        if (id === seq.current) apply(before);
        toast.show({ message: err instanceof Error ? err.message : "Couldn't save that setting. Try again.", level: "error" });
        return false;
      }
    },
    [apply, toast],
  );

  if (!settings) return <>{loadError ? <p style={{ padding: 24, color: "var(--danger)" }}>{loadError}</p> : fallback}</>;
  return <Ctx.Provider value={{ settings, save }}>{children}</Ctx.Provider>;
}
