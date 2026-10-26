import { useEffect, useState } from "react";
import type { CodeBadge } from "@flint/core/types";

/** Whole minutes left, rounded up, never below 1 while the code is valid. */
export function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 60_000));
}

/**
 * Returns the badge while it is still valid and re-renders when it expires (and once a minute for the countdown).
 * Returns undefined for no badge or an expired one.
 */
export function useLiveCode(badge: CodeBadge | undefined): { badge: CodeBadge; now: number } | undefined {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = badge?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    setNow(Date.now());
    const left = expiresAt - Date.now();
    if (left <= 0) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const end = setTimeout(() => setNow(Date.now()), left + 50);
    return () => { clearInterval(tick); clearTimeout(end); };
  }, [expiresAt]);
  if (!badge || badge.expiresAt <= now) return undefined;
  return { badge, now };
}
