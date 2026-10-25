import clsx from "clsx";
import styles from "./Skeleton.module.css";

/** A single placeholder block. */
export function Skeleton({ width, height = 12, className }: { width?: number | string; height?: number; className?: string }) {
  return <span className={clsx(styles.block, className)} style={{ width, height }} aria-hidden />;
}

/** Placeholder thread rows with the same height as real rows, so nothing shifts when data arrives. */
export function SkeletonRows({ count = 8, density = "comfortable", rowHeight }: { count?: number; density?: "comfortable" | "compact"; rowHeight?: number }) {
  const compact = density === "compact" || (rowHeight !== undefined && rowHeight <= 56);
  return (
    <div role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={clsx(styles.row, compact && styles.compact)} style={rowHeight ? { height: rowHeight } : undefined}>
          <span className={clsx(styles.block, styles.avatar)} style={{ width: compact ? 24 : 32, height: compact ? 24 : 32 }} />
          <div className={styles.lines}>
            <Skeleton width={`${38 + ((i * 17) % 30)}%`} />
            <Skeleton width={`${55 + ((i * 11) % 35)}%`} />
            {compact ? null : <Skeleton width={`${40 + ((i * 23) % 45)}%`} />}
          </div>
        </div>
      ))}
    </div>
  );
}
