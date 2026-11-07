"use client";

import { useEffect } from "react";

/** Adds an elevated shadow to the sticky nav once the page is scrolled. */
export function NavScroll({ target = "site-nav" }: { target?: string }) {
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el) return;
    const onScroll = () => el.classList.toggle("nav-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [target]);
  return null;
}
