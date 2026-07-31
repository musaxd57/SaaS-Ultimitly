import { rateLimit } from "@/lib/rate-limit";
import { limitsForOrg } from "@/lib/billing/plan-limits";

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
 * FAIL-OPEN DEĞİL, FAIL-SOFT: `rateLimit` DB'ye ulaşamazsa instance-içi belleğe
 * düşer (koruma tamamen kapanmaz). Bu bilinçli — bir DB hıçkırığı yüzünden
 * ödeyen müşterinin AI'sini komple kapatmak, tavanı bir süre gevşetmekten daha
 * kötü bir arıza modudur.
 */
export async function consumeDailyAiBudget(organizationId: string): Promise<DailyBudgetVerdict> {
  // Tavan PLANA göre (Başlangıç < Pro < İşletme). Env override'ı varsa o kazanır —
  // canlı bir arıza sırasında tek yerden kısabilmek için.
  const override = dailyAiCallCapOverride();
  const cap = override ?? (await limitsForOrg(organizationId)).aiCallsPerDay;
  const verdict = await rateLimit(`ai-daily:${organizationId}`, cap, DAY_MS);
  return { ok: verdict.ok, retryAfter: verdict.retryAfter, cap };
}
