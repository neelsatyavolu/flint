import clsx from "clsx";

/**
 * The Flint mark: a faceted flint shard with a spark. Uses currentColor; facets differ by opacity.
 * `spark` colours the spark with the accent (brand use). The empty reader uses the plain mark in --fg-4.
 */
export function FlintMark({ size = 96, spark = false, className }: { size?: number; spark?: boolean; className?: string }) {
  return (
    <svg className={clsx(className)} width={size} height={size} viewBox="0 0 96 96" fill="currentColor" role="img" aria-label="Flint" xmlns="http://www.w3.org/2000/svg">
      <polygon points="14,52 38,16 46,54" opacity="0.55" />
      <polygon points="38,16 66,26 46,54" opacity="0.9" />
      <polygon points="66,26 80,60 46,54" opacity="0.7" />
      <polygon points="80,60 62,86 46,54" opacity="0.45" />
      <polygon points="62,86 30,86 46,54" opacity="0.8" />
      <polygon points="30,86 14,52 46,54" opacity="0.6" />
      <polygon points="74,6 77.5,14.5 86,18 77.5,21.5 74,30 70.5,21.5 62,18 70.5,14.5" style={spark ? { fill: "var(--accent)" } : undefined} />
    </svg>
  );
}
