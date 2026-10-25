import { useState } from "react";
import clsx from "clsx";
import { avatarColor, initials } from "../lib/avatar";
import styles from "./Avatar.module.css";

export type AvatarSize = 16 | 24 | 32;

export type AvatarProps = {
  address: string;
  name?: string;
  /** Image URL (sender logo, contact photo). Falls back to initials if it fails to load. */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
};

export function Avatar({ address, name = "", src, size = 32, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  return (
    <span
      className={clsx(styles.avatar, styles[`s${size}`], className)}
      style={{ background: avatarColor(address) }}
      role="img"
      aria-label={name || address}
    >
      {showImage ? (
        <img className={styles.img} src={src ?? undefined} alt="" onError={() => setFailedSrc(src ?? null)} draggable={false} />
      ) : (
        <span className={styles.initials} aria-hidden>{initials(name, address)}</span>
      )}
    </span>
  );
}
