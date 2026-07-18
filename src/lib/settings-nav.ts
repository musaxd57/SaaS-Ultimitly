// Settings-page navigation contract (pure — no React, safe on server + client +
// tests). Three top-level sections; the org-scoped "İşletme Ayarları" section is
// split into sub-views. The slugs are the stable `?tab=` URL contract — keep them
// stable so a shared/bookmarked `/settings?tab=baglantilar` link keeps working.

export interface SettingsNavItem {
  id: string;
  label: string;
}

export interface SettingsNavGroup {
  // A section header shown above its items (e.g. "İşletme Ayarları"), or null for
  // a standalone top-level section that is itself a single view.
  label: string | null;
  items: SettingsNavItem[];
}

// The full navigation tree (labels only — visibility is filtered per role at
// render time by intersecting with the visible id set).
export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "İşletme Ayarları",
    items: [
      { id: "yapay-zeka", label: "Yapay Zekâ" },
      { id: "otomatik-mesajlar", label: "Otomatik Mesajlar" },
      { id: "baglantilar", label: "Bağlantılar" },
      { id: "bildirimler", label: "Bildirimler" },
      { id: "saat-dilimi", label: "Saat Dilimi" },
    ],
  },
  { label: null, items: [{ id: "faturalandirma", label: "Faturalandırma" }] },
  { label: null, items: [{ id: "hesap-guvenlik", label: "Hesap ve Güvenlik" }] },
];

export const SETTINGS_VIEW_IDS = SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id));

// The Airbnb/Booking connection card lives under İşletme Ayarları › Bağlantılar —
// the OAuth callback and the dashboard `#hospitable` deep-link both target it.
export const CONNECTION_VIEW_ID = "baglantilar";

// The product's core surface (AI voice + how it answers) — where a returning host
// most often lands, so it is the default when no param/hash steers elsewhere.
export const DEFAULT_VIEW_ID = "yapay-zeka";

/**
 * Decide which view is active on FIRST PAINT, from the server-readable inputs only
 * (the `#hospitable` hash is client-only and handled in a mount effect, NOT here).
 * Precedence:
 *   1. `?hospitable=<code>` → the connection view, so the OAuth result banner
 *      renders on the correct panel with no flash (covers all callback codes).
 *   2. `?tab=<slug>` → honored ONLY if it is a real, currently-VISIBLE view
 *      (a staff user who types `?tab=faturalandirma` must not land on a hidden
 *      panel — it falls through to the default).
 *   3. Default: the AI view, or the first visible view as a floor (never an id
 *      that isn't visible).
 */
export function deriveInitialViewId(opts: {
  hospitable?: string | null;
  tab?: string | null;
  visibleIds: string[];
}): string {
  const { hospitable, tab, visibleIds } = opts;
  if (hospitable && visibleIds.includes(CONNECTION_VIEW_ID)) return CONNECTION_VIEW_ID;
  if (tab && visibleIds.includes(tab)) return tab;
  if (visibleIds.includes(DEFAULT_VIEW_ID)) return DEFAULT_VIEW_ID;
  return visibleIds[0] ?? DEFAULT_VIEW_ID;
}
