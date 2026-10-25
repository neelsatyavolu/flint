import { useEffect, useMemo, useRef, useState } from "react";
import { MAIL_FRAME_SANDBOX, buildSrcdoc, interceptLinks, observeFrameHeight } from "../lib/html";
import { openExternal } from "../lib/host";

type Props = {
  html: string;
  allowRemoteImages: boolean;
  colors?: { bg: string; fg: string; link: string };
  padding?: number;
  title?: string;
  className?: string;
  onLink?: (url: string) => void;
};

/** Sandboxed mail iframe that sizes itself to its content. See lib/html.ts for why same-origin is needed. */
export function MailFrame({ html, allowRemoteImages, colors, padding, title = "Message", className, onLink }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const srcDoc = useMemo(() => buildSrcdoc({ html, allowRemoteImages, colors, padding }), [html, allowRemoteImages, colors, padding]);

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
      style={{ display: "block", width: "100%", height, border: 0, background: colors?.bg ?? "#ffffff" }}
      scrolling="no"
    />
  );
}
