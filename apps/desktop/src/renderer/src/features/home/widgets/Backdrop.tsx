import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import clsx from "clsx";
import type { Scene } from "../scene";
import styles from "../HomeView.module.css";

type Layer = { key: string; scene: Scene; loaded: boolean };

/**
 * Photo layers for a cross-fade: at most the last loaded photo plus the incoming one, which fades in over it once
 * decoded. `shown` is the newest loaded scene; null keeps Home on its plain plane (nothing loaded yet, Plain mode,
 * or the file failed to load). Each incoming layer is a fresh <img> (new key), so returning to a photo still under
 * the stack loads and fades like any other.
 */
export function useSceneLayers(scene: Scene | null): { layers: Layer[]; shown: Scene | null; onLoad: (key: string) => void } {
  const [layers, setLayers] = useState<Layer[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    setLayers((ls) => {
      if (!scene) return [];
      if (ls.at(-1)?.scene.id === scene.id) return ls;
      return [...ls.filter((l) => l.loaded).slice(-1), { key: `${scene.id}:${++seq.current}`, scene, loaded: false }];
    });
  }, [scene]);
  const onLoad = useCallback((key: string) => setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, loaded: true } : l))), []);
  const shown = layers.filter((l) => l.loaded).at(-1)?.scene ?? null;
  return { layers, shown, onLoad };
}

/** The fixed photo behind Home and its one flat scrim. Decorative: hidden from assistive tech. */
export function Backdrop({ layers, onLoad, ready }: { layers: Layer[]; onLoad: (key: string) => void; ready: boolean }): JSX.Element {
  return (
    <>
      {layers.map((l) => (
        <img
          key={l.key}
          src={l.scene.url}
          alt=""
          aria-hidden
          decoding="async"
          draggable={false}
          className={clsx(styles.photo, l.loaded && styles.shown)}
          style={{ objectPosition: l.scene.focal }}
          onLoad={() => onLoad(l.key)}
        />
      ))}
      <div className={clsx(styles.scrim, ready && styles.shown)} aria-hidden />
    </>
  );
}
