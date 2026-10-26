import { useMemo, useState } from "react";
import clsx from "clsx";
import { useAvatarImage } from "../lib/avatarImages";
import { avatarColor, initials } from "../lib/avatar";
import styles from "./Avatar.module.css";

export type AvatarSize = 16 | 24 | 32;

export type AvatarProps = {
  address: string;
  name?: string;
  /** Image URL (sender logo, contact photo). Falls back to initials if it fails to load. */
  src?: string | null;
  /** One of the user's accounts: shows that account's profile picture instead of looking the address up. */
  accountId?: string;
  size?: AvatarSize;
  className?: string;
};

/**
 * Colored initials with a profile picture faded in over them when one exists (the user's own accounts, Gravatar).
 * The circle has a fixed size, so a picture arriving later never moves anything.
 */
export function Avatar({ address, name = "", src, size = 32, className, accountId }: AvatarProps) {
  const ref = useMemo(
    () => (src ? null : accountId ? ({ kind: "account", accountId } as const) : address.includes("@") ? ({ kind: "sender", address } as const) : null),
    [src, accountId, address],
  );
  const found = useAvatarImage(ref);
  const url = src || found;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = Boolean(url) && failedUrl !== url;
  const letters = initials(name, address);
  return (
    <span
      className={clsx(styles.avatar, styles[`s${size}`], className)}
      style={{ background: avatarColor(address) }}
      role="img"
      aria-label={name || address}
    >
      <span className={styles.initials} aria-hidden>{size === 16 ? [...letters][0] : letters}</span>
      {showImage ? (
        <img
          className={clsx(styles.img, loadedUrl === url && styles.loaded)}
          src={url ?? undefined}
          alt=""
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
          draggable={false}
        />
      ) : null}
    </span>
  );
}
