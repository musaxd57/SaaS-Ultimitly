import { LinkButton } from "@/components/ui/link-button";
import { isSuperAdmin } from "@/lib/admin-core";
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// UX-14 (kurucu 11-13: "mantıklı yap, akışı düşünerek"): boş sayfalarda "Airbnb / Booking'i bağlayın" düğmesi TEK kuraldan.
// Bağlantıyı yalnız HESAP SAHİBİ (ve operatör) kurar — Ayarlar › Bağlantılar'da yönetici "hesap sahibinden isteyin" metnini görür
// (`settings/page.tsx` `canManageChannel`). Örnek (demo) hesapta kanal hiç kurulmaz (kurucu kuralı). Bu üç koşul tek yerde; her boş
// sayfa kendi kopyasını yazınca yönetici, kuramayacağı bağlantının düğmesini görüyordu (mülkler sayfası).
// ---------------------------------------------------------------------------

export const CONNECT_CHANNEL_HREF = "/settings?tab=baglantilar";
export const CONNECT_CHANNEL_LABEL = "Airbnb / Booking'i bağlayın";

/** Bağlantıyı kurabilecek kişi mi (hesap sahibi ya da operatör). Ayarlar sayfasındaki `canManageChannel` ile aynı. */
export function canManageChannel(session: SessionPayload): boolean {
  return session.role === "owner" || isSuperAdmin(session);
}

/** Boş durumda bağlantı düğmesi gösterilir mi: bağlantı yok + kurabilecek kişi + gerçek hesap. */
export function showConnectChannel(session: SessionPayload, channelConnected: boolean): boolean {
  return !channelConnected && canManageChannel(session) && !isDemoOrg(session.organizationId);
}

export function ConnectChannelButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <LinkButton href={CONNECT_CHANNEL_HREF} size="sm" variant={variant}>
      {CONNECT_CHANNEL_LABEL}
    </LinkButton>
  );
}
