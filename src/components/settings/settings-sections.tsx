"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CONNECTION_VIEW_ID } from "@/lib/settings-nav";

export interface SettingsViewItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface SettingsViewGroup {
  label: string | null;
  items: SettingsViewItem[];
}

/**
 * Two-level settings navigation. The server renders EVERY view's cards once (one
 * data pass) and hands them in as `groups[].items[].content`; this component only
 * toggles which panel is visible. Inactive panels stay MOUNTED (`hidden` =
 * display:none), so a half-typed form survives switching views.
 *
 * Desktop: a compact sticky nav on the LEFT, content on the right (no horizontal
 * tab strip / scrollbar). Mobile: an accessible native <select> section picker.
 *
 * `initialViewId` is computed on the server (deriveInitialViewId) so first paint
 * is already correct for `?hospitable=` / `?tab=`. The URL hash is the one thing
 * the server can't see, so `/settings#hospitable` (dashboard onboarding) is
 * resolved here after mount: switch to the connection view, then scroll its card
 * into view.
 */
export function SettingsSections({
  groups,
  initialViewId,
}: {
  groups: SettingsViewGroup[];
  initialViewId: string;
}) {
  const [active, setActive] = useState(initialViewId);
  const allItems = groups.flatMap((g) => g.items);

  // `#hospitable` (dashboard "Bağlantıyı kur") — hash is client-only, so do it
  // after mount to avoid a hydration mismatch, then scroll the (now-visible)
  // connection card into view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#hospitable" && allItems.some((i) => i.id === CONNECTION_VIEW_ID)) {
      setActive(CONNECTION_VIEW_ID);
      requestAnimationFrame(() => {
        document.getElementById("hospitable")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectView(id: string) {
    setActive(id);
    // Reflect the view in the URL (?tab=) for refresh/share, WITHOUT a Next
    // navigation — a real nav would re-run the server component and discard every
    // panel's in-progress form state. replaceState keeps the single server pass.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      url.hash = "";
      window.history.replaceState(null, "", url.toString());
    }
  }

  const activeLabel = allItems.find((i) => i.id === active)?.label ?? "";

  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      {/* Mobile: accessible section picker (no horizontal tab strip). */}
      <div className="mb-5 lg:hidden">
        <label htmlFor="settings-section-select" className="mb-1.5 block text-sm font-medium">
          Ayarlar bölümü
        </label>
        <select
          id="settings-section-select"
          value={active}
          onChange={(e) => selectView(e.target.value)}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          {groups.map((g, gi) =>
            g.label ? (
              <optgroup key={`g-${gi}`} label={g.label}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              g.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))
            ),
          )}
        </select>
      </div>

      {/* Desktop: compact sticky left nav. */}
      <nav aria-label="Ayarlar bölümleri" className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
          {groups.map((g, gi) => (
            <div key={`nav-${gi}`}>
              {g.label ? (
                <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/60">
                  {g.label}
                </p>
              ) : null}
              <ul className="space-y-1">
                {g.items.map((i) => {
                  const isActive = i.id === active;
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => selectView(i.id)}
                        className={cn(
                          "block w-full rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          isActive
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-transparent font-medium text-foreground/70 hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {i.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Content: every panel mounted, only the active one shown. */}
      <div className="min-w-0 space-y-6">
        {allItems.map((i) => (
          <section
            key={i.id}
            role="region"
            aria-label={i.id === active ? activeLabel : i.label}
            hidden={i.id !== active}
            className="space-y-6"
          >
            {i.content}
          </section>
        ))}
      </div>
    </div>
  );
}
