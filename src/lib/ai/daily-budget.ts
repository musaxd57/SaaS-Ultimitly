import { rateLimit } from "@/lib/rate-limit";
import { limitsForOrg, planLimitsFor } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// ORG BAŞINA GÜNLÜK AI ÇAĞRI TAVANI.
//
// Neden gerekliydi: dakikalık limitler tek bir isteği yavaşlatır ama TOPLAM
// harcamayı sınırlamaz. Denetimde ölçüldü — bir hesap, dakikada 15 (ai/test) +
// 20 (ai-suggest) + 30 (çeviri) çağrı hakkıyla günde on binlerce çağrı
// yapabiliyordu ve kod tabanında hiçbir yerde günlük/aylık harcama tavanı YOKTU.
// Bu tavan iki farklı sorunu aynı anda kapatır:
//   1. kötü niyetli kullanım (deneme hesabıyla fatura şişirme),
//   2. KAZA — sonsuz döngüye giren bir istemci ya da yanlış yazılmış bir script.
// İkincisi daha olasıdır ve tavan onu da aynı sertlikte durdurur.
//
// Uygulama: yeni tablo YOK. `RateLimitCounter` zaten dağıtık, atomik ve DB-
// otoriteli (replikalar arası tutar, restart'ta sıfırlanmaz) — 24 saatlik bir
// pencereyle aynı mekanizma günlük bütçe olur. Migration gerekmez.
//
// Sayaç ORG başınadır, kullanıcı başına değil: maliyet org'a aittir ve ekip
// üyesi ekleyerek tavanı çoğaltmak mümkün olmamalı.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** Env ile ezilmediği sürece tavan PLANDAN gelir (billing/plan-limits.ts). Bu
 *  değer yalnız acil bir müdahale kaçışıdır — normalde kullanılmaz. */
const DEFAULT_DAILY_AI_CALLS = 750;

/** Env override — set edilmişse plandan BAĞIMSIZ olarak herkese uygulanır. */
export function dailyAiCallCapOverride(): number | null {
  const raw = process.env.AI_DAILY_CALL_CAP?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Geriye dönük uyumluluk + testler için: env override ya da genel varsayılan. */
export function dailyAiCallCap(): number {
  return dailyAiCallCapOverride() ?? DEFAULT_DAILY_AI_CALLS;
}

export interface DailyBudgetVerdict {
  ok: boolean;
  /** Saniye — tavana takılan çağrının ne kadar sonra tekrar deneyebileceği. */
  retryAfter: number;
  /** Uygulanan tavan (hata mesajında müşteriye söylenebilsin diye). */
  cap: number;
}

/**
 * Bir AI çağrısını org'un günlük bütçesine yaz ve bütçe içinde mi söyle.
 *
 * SAYIM fail-soft: `rateLimit` DB'ye ulaşamazsa instance-içi belleğe düşer
 * (koruma tamamen kapanmaz). PLAN OKUMASI ise fail-OPEN: `limitsForOrg` bir DB
 * hıçkırığında FIRLATIR ve tutulmazsa `withManage` bunu 500'e çevirir — yani
 * ödeyen müşterinin AI'si kapanırdı; tam olarak bu yorumun "daha kötü arıza
 * modu" dediği şey. Kardeş QR yolu bunu baştan doğru yapıyordu, burası
 * yapmıyordu (denetim, 07-31). Okuma başarısızsa EN GENİŞ plana düşülür:
 * kimlik kapılarında fail-closed doğrudur, KULLANIM kapılarında fail-open.
 */
/**
 * Tavana çarpan müşteriye gösterilecek TEK metin (dört rota da bunu kullanır).
 *
 * Neden gerekli: dört rotada da elle yazılmış "Yarın otomatik olarak sıfırlanır"
 * cümlesi vardı ve YANLIŞTI. Sayaç takvim gününe değil, İLK ÇAĞRIYA çapalı sabit
 * bir 24 saatlik pencere (`rate-limit.ts`). Saat 18:00'de dolan tavan ertesi gün
 * 18:00'de açılır, gece yarısı değil — host sabah hâlâ kapalı görüp arıza sanıyor
 * ve destek yazıyordu. `retryAfter` zaten hesaplanıyordu ama yalnız `Retry-After`
 * header'ına yazılıp müşteriye hiç söylenmiyordu.
 */
export function dailyBudgetMessage(v: DailyBudgetVerdict): string {
  const hours = Math.ceil(v.retryAfter / 3600);
  const when =
    v.retryAfter <= 0
      ? "Birazdan"
      : hours <= 1
        ? `Yaklaşık ${Math.max(1, Math.ceil(v.retryAfter / 60))} dakika sonra`
        : `Yaklaşık ${hours} saat sonra`;
  return `Bugünkü AI kullanım sınırınıza ulaştınız (planınız: günde ${v.cap.toLocaleString("tr-TR")} AI işlemi). ${when} yeniden kullanabilirsiniz.`;
}

export async function consumeDailyAiBudget(organizationId: string): Promise<DailyBudgetVerdict> {
  // Tavan PLANA göre (Başlangıç < Pro < İşletme). Env override'ı varsa o kazanır —
  // canlı bir arıza sırasında tek yerden kısabilmek için.
  const override = dailyAiCallCapOverride();
  const cap =
    override ??
    (await limitsForOrg(organizationId).catch(() => null) ?? planLimitsFor("business"))
      .aiCallsPerDay;
  const verdict = await rateLimit(`ai-daily:${organizationId}`, cap, DAY_MS);
  return { ok: verdict.ok, retryAfter: verdict.retryAfter, cap };
}
