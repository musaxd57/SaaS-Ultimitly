"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CONNECTION_TAB_ID } from "@/lib/settings-tabs";

export interface SettingsTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Tabbed settings shell. The server renders EVERY panel's cards once (one data
 * pass) and hands them in as `tabs[].content`; this component only toggles which
 * panel is visible. Inactive panels stay MOUNTED (`hidden` = display:none), so a
 * half-typed form is never lost when the host flips tabs.
 *
 * `initialTabId` is computed on the server (see deriveInitialTabId) so first paint
 * is already correct for `?hospitable=` / `?tab=`. The one thing the server can't
 * see is the URL hash, so the dashboard's `/settings#hospitable` deep-link is
 * resolved here in a mount effect: switch to the connection tab, then scroll the
 * card into view.
 */
export function SettingsTabs({
  tabs,
  initialTabId,
}: {
  tabs: SettingsTab[];
  initialTabId: string;
}) {
  const [active, setActive] = useState(initialTabId);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // `#hospitable` (dashboard onboarding "Bağlantıyı kur") — hash is client-only,
  // so the server couldn't SSR the right tab. Do it after mount to avoid a
  // hydration mismatch, then scroll the (now-visible) connection card into view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#hospitable" && tabs.some((t) => t.id === CONNECTION_TAB_ID)) {
      setActive(CONNECTION_TAB_ID);
      // Next frame: the panel must be visible (not display:none) before scrollIntoView.
      requestAnimationFrame(() => {
        document.getElementById("hospitable")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(id: string) {
    setActive(id);
    // Reflect the tab in the URL (?tab=) for refresh/share, WITHOUT a Next
    // navigation — a real nav would re-run the server component and discard every
    // panel's in-progress form state. replaceState keeps the single server pass.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      url.hash = "";
      window.history.replaceState(null, "", url.toString());
    }
  }

  // Roving-tabindex keyboard nav (WAI-ARIA tabs): Left/Right move + activate,
  // Home/End jump to the ends. Only the active tab is in the tab order.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const nextTab = tabs[next];
    selectTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  }

  return (
    <div className="space-y-6">
      {/* Horizontally scrollable on a phone so no label truncates (hosts are
          mobile-heavy); underline-style tabs read as a settings surface. */}
      <div
        role="tablist"
        aria-label="Ayarlar bölümleri"
        className="-mb-px flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((t, i) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={isActive}
              aria-controls={`settings-panel-${t.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`settings-panel-${t.id}`}
          aria-labelledby={`settings-tab-${t.id}`}
          hidden={t.id !== active}
          className="space-y-6"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
