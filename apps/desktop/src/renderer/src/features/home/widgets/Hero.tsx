import type { JSX } from "react";
import { format } from "date-fns";
import clsx from "clsx";
import { Image, ImageOff, SkipForward } from "lucide-react";
import { IconButton, Menu } from "../../../ui";
import type { Scene, SceneMode } from "../scene";
import styles from "../HomeView.module.css";

/** The band at the top of Home: greeting, date and the live time, with the photo credit at its foot. */
export function Hero({ title, now, scene }: { title: string; now: number; scene: Scene | null }): JSX.Element {
  return (
    <div className={styles.band}>
      <h1 className={clsx("t-subject", styles.greeting)}>{title}</h1>
      <p className={clsx("t-data", styles.date)}>
        {format(now, "EEEE, MMMM d")}
        <span aria-hidden> · </span>
        <time dateTime={format(now, "HH:mm")}>{format(now, "h:mm a")}</time>
      </p>
      {scene ? <p className={clsx("t-data", styles.credit)}>Photo: {scene.credit} · {scene.place}</p> : null}
    </div>
  );
}

/** Home background controls: next photo for today, and Photo or Plain. Kept on Home, per device. */
export function SceneMenu({ mode, onMode, onNext }: { mode: SceneMode; onMode: (mode: SceneMode) => void; onNext: () => void }): JSX.Element {
  const I = { size: 16, strokeWidth: 1.5 } as const;
  return (
    <Menu
      placement="bottom-end"
      items={[
        { id: "next", label: "Next photo", icon: <SkipForward {...I} />, disabled: mode !== "photo", onSelect: onNext },
        { type: "separator" },
        { type: "label", label: "Background" },
        { id: "photo", label: "Photo", icon: <Image {...I} />, checked: mode === "photo", onSelect: () => onMode("photo") },
        { id: "plain", label: "Plain", icon: <ImageOff {...I} />, checked: mode === "plain", onSelect: () => onMode("plain") },
      ]}
      trigger={<IconButton label="Home background" className={styles.sceneButton}><Image size={18} strokeWidth={1.5} /></IconButton>}
    />
  );
}
