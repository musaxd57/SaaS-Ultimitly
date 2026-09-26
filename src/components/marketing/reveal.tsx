"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper (fade + slide-up once on first intersection). Renders
 * `as` so it can BE a grid child / heading / list item without an extra div.
 * SSR-safe + degrades to always-visible when IntersectionObserver is missing,
 * and is forced visible under prefers-reduced-motion (see globals.css).
 */
export function Reveal({
  children,
  as,
  delay = 0,
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
}) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setSupported(false);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cn("reveal", (shown || !supported) && "is-visible", className)}
      style={delay ? ({ "--reveal-delay": `${Math.min(delay, 320)}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
