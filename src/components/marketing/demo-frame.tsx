"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Embeds the static animated setup walkthrough (public/kurulum.html) in an
 * isolated iframe. The HTML posts its real content height to us so the iframe
 * has no empty gap / scrollbar at any width.
 */
export function DemoFrame() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(680);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const h = (e.data as { lixusDemo?: number } | null)?.lixusDemo;
      if (typeof h === "number" && h > 200 && h < 2000) setHeight(Math.ceil(h));
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <iframe
      ref={ref}
      src="/kurulum.html"
      title="Lixus AI — kurulum anlatımı"
      loading="lazy"
      className="w-full rounded-2xl border border-border bg-card"
      style={{ height }}
    />
  );
}
