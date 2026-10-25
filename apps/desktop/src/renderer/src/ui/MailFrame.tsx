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
};

/** Small on purpose: the first measure sets the real height, and a tall guess leaves dead space under short mail. */
const INITIAL_HEIGHT = 24;
const LIGHT = { bg: "#ffffff", fg: "#1a1a17", link: "#2f6fe0" };

/** Sandboxed mail iframe that sizes itself to its content. See lib/html.ts for why same-origin is needed. */
export function MailFrame({ html, allowRemoteImages, colors, sheet, padding, title = "Message", className, onLink }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const theme = useResolvedTheme();
  const themed = sheet === "theme" && !colors;
  const frameColors = useMemo(() => colors ?? (themed ? readFrameColors(theme) : undefined), [colors, themed, theme]);
  const scheme = themed && theme === "dark" ? "dark" : "light";
  const srcDoc = useMemo(
    () => buildSrcdoc({ html, allowRemoteImages, colors: frameColors, scheme, padding }),
    [html, allowRemoteImages, frameColors, scheme, padding],
  );

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const stopHeight = observeFrameHeight(frame, setHeight);
    let stopLinks = () => {};
    const bind = () => {
      stopLinks();
      stopLinks = interceptLinks(frame, onLink ?? openExternal);
    };
    frame.addEventListener("load", bind);
    return () => {
      frame.removeEventListener("load", bind);
      stopLinks();
      stopHeight();
    };
  }, [srcDoc, onLink]);

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
