import { appDefaultTimezone } from "@/lib/app-config";
import { rateLimit } from "@/lib/rate-limit";
import { dateKeyInTimeZone } from "@/lib/timezone";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO TALEBİ BİLDİRİM BÜTÇESİ (G3, kurucu kararı 10-13 "Günde 50 + özet"; ACIK-ISLER 08-08 §15)
//
// `/api/leads` kimliksiz bir formdur; tek freni IP başına saatte 5. IP döndüren biri her talepte operatöre bir e-posta tetikleyip
// e-posta sağlayıcısının kotasını bitirebilirdi — o kota kayıt doğrulama ve şifre sıfırlama e-postalarıyla ORTAK. Kural:
//  · Talep HER ZAMAN kaydedilir (bu modül yalnız BİLDİRİMİ sınırlar; kaynak doğruluk `Lead` tablosu).
//  · Uygulama gününde (varsayılan saat dilimi) ilk 50 talep → normal bildirim; 51. talep → TEK özet e-postası; sonrası → e-posta yok.
//  · Sayaç veritabanındadır (`rateLimit`: tek atomik INSERT … ON CONFLICT) → birden çok kopya / yeniden başlatma sayımı bölmez.
//    Veritabanı erişilemezse `rateLimit` kopya başına bellek yedeğine düşer (kapalı değil, gevşek — en kötü kopya başına 50 + 1).
// Rota dosyası (`route.ts`) yalnız bilinen rota alanlarını dışa aktarabildiği için sabit ve karar burada.
// ─────────────────────────────────────────────────────────────────────────────

/** Gün başına normal bildirim sayısı (kurucu kararı). */
export const LEAD_NOTIFY_DAILY_CAP = 50;

// Anahtar güne bağlı; pencere günden UZUN tutulur ki aynı günün sayacı gün içinde sıfırlanmasın (yeni gün = yeni anahtar).
const WINDOW_MS = 26 * 60 * 60_000;

export type LeadNotifySlot = "notify" | "summary" | "skip";

/** Bu talep için hangi bildirim gider? Her çağrı bir talebi SAYAR — yalnız bildirim adresi ayarlıyken çağrılır. */
export async function claimLeadNotifySlot(now: Date = new Date()): Promise<LeadNotifySlot> {
  const day = dateKeyInTimeZone(now, appDefaultTimezone());
  if ((await rateLimit(`lead-notify:${day}`, LEAD_NOTIFY_DAILY_CAP, WINDOW_MS)).ok) return "notify";
  if ((await rateLimit(`lead-notify-summary:${day}`, 1, WINDOW_MS)).ok) return "summary";
  return "skip";
}
