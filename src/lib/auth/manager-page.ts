import "server-only";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManage } from "@/lib/api";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// YÖNETİCİ SAYFASI KAPISI (10-11 gece, Haiku incelemesi). Personel (temizlikçi) yalnız `/tasks` görür; bu sınır bugün middleware'de
// (`middleware.ts`, JWT rolüyle yönlendirme). Uygulama sayfalarının çoğu personel sınırı için YALNIZ ona dayanıyordu — middleware bir gün
// eşleyici değişikliği / yapılandırma hatasıyla atlanırsa raporlar, takvim, QR sohbetleri gibi misafir verisi taşıyan sayfalar personele
// çizilirdi. Bu yardımcı sayfa katmanındaki İKİNCİ kapı: oturum (`requireAuth`, rol veritabanından tazelenir) + yönetici değilse `/tasks`.
// Davranış DEĞİŞMEZ (middleware zaten aynı yere yönlendiriyor). Yeni uygulama sayfası bu kapı olmadan eklenemez (pin:
// `tests/unit/manager-page-gate.test.ts`).
// ---------------------------------------------------------------------------

export async function requireManagerSession(): Promise<SessionPayload> {
  const session = await requireAuth();
  if (!canManage(session)) redirect("/tasks");
  return session;
}
