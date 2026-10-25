import { useEffect, useMemo, useRef, useState } from "react";
import { MAIL_FRAME_SANDBOX, buildSrcdoc, interceptLinks, observeFrameHeight } from "../lib/html";
import { openExternal } from "../lib/host";
import { readFrameColors, useResolvedTheme } from "../lib/theme";

type Props = {
  html: string;
  allowRemoteImages: boolean;
  /** Explicit colors win over `sheet`. */
  colors?: { bg: string; fg: string; link: string; line?: string };
  /**
   * "theme": the frame paints in the app's colors (use with dark-adapted mail).
   * "light-sheet": the original white sheet with a small rounded inset.
   * Omitted: the white sheet, edge to edge (composer previews, signatures).
   */
  sheet?: "theme" | "light-sheet";
  padding?: number;
  title?: string;
  className?: string;
  onLink?: (url: string) => void;
  /** Called once the frame has its real height (at once when the height is already known from an earlier view). */
  onReady?: () => void;
};

/** Small on purpose: the first measure sets the real height, and a tall guess leaves dead space under short mail. */
const INITIAL_HEIGHT = 24;
/** Heights of frames seen before, so reopening a message starts at its real size and nothing below it moves. */
const MAX_HEIGHTS = 300;
const heights = new Map<string, number>();
function docKey(srcDoc: string): string {
  let h = 5381;
  for (let i = 0; i < srcDoc.length; i++) h = ((h << 5) + h + srcDoc.charCodeAt(i)) | 0;
  return `${srcDoc.length}:${h}`;
}
function rememberHeight(key: string, px: number): void {
  heights.delete(key);
  heights.set(key, px);
  if (heights.size > MAX_HEIGHTS) heights.delete(heights.keys().next().value as string);
}
const LIGHT = { bg: "#ffffff", fg: "#1a1a17", link: "#2f6fe0" };

/** Sandboxed mail iframe that sizes itself to its content. See lib/html.ts for why same-origin is needed. */
export function MailFrame({ html, allowRemoteImages, colors, sheet, padding, title = "Message", className, onLink, onReady }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const theme = useResolvedTheme();
  const themed = sheet === "theme" && !colors;
  const frameColors = useMemo(() => colors ?? (themed ? readFrameColors(theme) : undefined), [colors, themed, theme]);
  const scheme = themed && theme === "dark" ? "dark" : "light";
  const srcDoc = useMemo(
    () => buildSrcdoc({ html, allowRemoteImages, colors: frameColors, scheme, padding }),
    [html, allowRemoteImages, frameColors, scheme, padding],
  );

  const key = useMemo(() => docKey(srcDoc), [srcDoc]);
  const [height, setHeight] = useState(() => heights.get(key) ?? INITIAL_HEIGHT);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const known = heights.get(key);
    if (known !== undefined) {
      setHeight(known);
      readyRef.current?.();
    }
    let announced = known !== undefined;
    let loaded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const announce = () => {
      if (announced) return;
      announced = true;
      readyRef.current?.();
    };
    // The empty document a new frame starts with also reports a height; only the loaded mail counts.
    const onLoad = () => {
      loaded = true;
      timer = setTimeout(announce, 0);
    };
    frame.addEventListener("load", onLoad);
    const stopHeight = observeFrameHeight(frame, (px) => {
      if (loaded || known === undefined) setHeight(px);
      if (loaded) {
        rememberHeight(key, px);
        announce();
      }
    });
    let stopLinks = () => {};
    const bind = () => {
      stopLinks();
      stopLinks = interceptLinks(frame, onLink ?? openExternal);
    };
    frame.addEventListener("load", bind);
    return () => {
      frame.removeEventListener("load", bind);
      frame.removeEventListener("load", onLoad);
      clearTimeout(timer);
      stopLinks();
      stopHeight();
    };
  }, [srcDoc, key, onLink]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox={MAIL_FRAME_SANDBOX}
      srcDoc={srcDoc}
      className={className}
      data-sheet={sheet}
      style={{
        display: "block",
        width: "100%",
        height,
        border: 0,
        background: frameColors?.bg ?? LIGHT.bg,
        borderRadius: sheet === "light-sheet" ? "var(--r-card, 8px)" : undefined,
        colorScheme: scheme,
      }}
      scrolling="no"
    />
  );
}
