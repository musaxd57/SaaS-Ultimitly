"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetch the server-rendered data so messages pulled by the
 * background sync show up WITHOUT a manual page refresh. router.refresh() updates
 * server data while preserving client state (a half-typed reply, open menus), so
 * it never interrupts the host. Only ticks while the tab is visible, and catches
 * up the moment the tab regains focus. Renders nothing.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const period = Math.max(10, seconds) * 1000;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(refreshIfVisible, period);
    // Refresh immediately when the host returns to the tab after being away.
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, seconds]);

  return null;
}
