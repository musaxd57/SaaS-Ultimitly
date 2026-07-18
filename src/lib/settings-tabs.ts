// Settings-page tab contract (pure — no React, safe to import on server + client
// + tests). The slugs are the stable `?tab=` URL contract; keep them stable so a
// shared/bookmarked `/settings?tab=faturalandirma` link keeps opening the same tab.

export const SETTINGS_TAB_IDS = [
  "yapay-zeka",
  "otomatik-mesajlar",
  "baglanti-takvim",
  "faturalandirma",
  "hesap-guvenlik",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

// The Airbnb/Booking connection card lives here — the OAuth callback and the
// dashboard `#hospitable` deep-link both target this tab.
export const CONNECTION_TAB_ID: SettingsTabId = "baglanti-takvim";

// The product's core surface (AI voice + automation) — where a returning host
// most often lands, so it is the default when no param/hash steers elsewhere.
export const DEFAULT_TAB_ID: SettingsTabId = "yapay-zeka";

/**
 * Decide which tab is active on FIRST PAINT, from the server-readable inputs only
 * (the `#hospitable` hash is client-only and handled in a mount effect, NOT here).
 * Precedence:
 *   1. `?hospitable=<code>` → the connection tab, so the OAuth result banner
 *      renders on the correct panel with no flash (covers all 8 callback codes).
 *   2. `?tab=<slug>` → honored ONLY if it is a real, currently-VISIBLE tab
 *      (a staff user who types `?tab=faturalandirma` must not land on a hidden/
 *      empty panel — it falls through to the default).
 *   3. Default: the AI tab, or the first visible tab as a floor (should always
 *      exist, but never return an id that isn't visible).
 */
export function deriveInitialTabId(opts: {
  hospitable?: string | null;
  tab?: string | null;
  visibleIds: string[];
}): string {
  const { hospitable, tab, visibleIds } = opts;
  if (hospitable && visibleIds.includes(CONNECTION_TAB_ID)) return CONNECTION_TAB_ID;
  if (tab && visibleIds.includes(tab)) return tab;
  if (visibleIds.includes(DEFAULT_TAB_ID)) return DEFAULT_TAB_ID;
  return visibleIds[0] ?? DEFAULT_TAB_ID;
}
