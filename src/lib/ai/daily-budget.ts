import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
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

/**
 * Kotayı TÜKETMEDEN "yer var mı" diye bak.
 *
 * ⚠️ NEDEN GEREKLİ (denetim, 08-01): oto-yanıt yolunda kota model çağrısının
 * ÖNÜNDE tüketiliyordu. OpenAI 30 dakika düşerse `suggestReply` deterministik
 * fallback'e döner (`source:"fallback"`), kapı reddeder, konuşma damgalanmaz ve
 * 2 dakika sonra AYNI şey tekrarlanır — her denemede bir birim yanarak. SIFIR
 * lira harcanmış olmasına rağmen Başlangıç planının 150 birimi ~1 saatte
 * tükenir ve servis geri dönse bile 24 saatlik pencere kapanana kadar org'un
 * TÜM oto-yanıtı durur. Geçici bir sağlayıcı arızası, kalıcı bir gün kaybına
 * dönüşüyordu.
 *
 * Çözüm: cron yolunda ÖNCE bak (tavanı uygula), model çağrısı GERÇEKTEN
 * yapıldıysa SONRA tüket. Yarış riski yok — o yol global senkron kilidi altında
 * koşuyor, aynı org için iki geçiş üst üste binmiyor.
 *
 * İnteraktif rotalar (panel düğmeleri) BU FONKSİYONU KULLANMAZ: orada isteği
 * yapan kullanıcıdır ve suistimal kapısı "önce tüket" olmak zorundadır.
 */
export async function peekDailyAiBudget(organizationId: string): Promise<DailyBudgetVerdict> {
  const override = dailyAiCallCapOverride();
  const cap =
    override ??
    // `limitsForOrg` artık kendi içinde fail-open (plan-limits.ts) — burada
    // ikinci bir catch'e gerek yok, ama zararsız olduğu için bırakılmadı:
    // tek kaynak tek yerde kalsın.
    (await limitsForOrg(organizationId)).aiCallsPerDay;
  try {
    const row = await prisma.rateLimitCounter.findUnique({
      where: { key: `ai-daily:${organizationId}` },
      select: { count: true, resetAt: true },
    });
    // Satır yok ya da pencere dolmuş → sayaç bir sonraki tüketimde sıfırlanır.
    if (!row || row.resetAt <= new Date()) return { ok: true, retryAfter: 0, cap };
    const retryAfter = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
    return { ok: row.count < cap, retryAfter, cap };
  } catch {
    // Okuma başarısızsa KULLANIM kapısı fail-OPEN: bir DB hıçkırığı yüzünden
    // misafirleri cevapsız bırakmak, tavanı bir tur gevşetmekten kötüdür.
    // Gerçek tüketim adımı zaten kendi korumasını taşıyor.
    return { ok: true, retryAfter: 0, cap };
  }
}

/**
 * QR'IN PAYI — kimliksiz yüzey org'un bütçesini TEK BAŞINA bitiremesin (08-05).
 *
 * 🚨 SORUN: `chat/[token]` kimlik doğrulaması OLMAYAN tek AI yüzeyi ve `chatToken`
 * daire başına KALICI bir sır (fiziksel QR etiketi olarak dairede asılı; rezervasyon
 * başına dönmüyor). Tek sızmış token → org'un günlük AI tavanı tükenir → o gün
 * TÜM dairelerdeki GERÇEK Airbnb misafirlerinin oto-yanıtı kapanır.
 *
 * ⚠️ İLK TASARIM YANLIŞTI, SQL OKUNARAK YAKALANDI: "aynı anahtara daha düşük limit
 * ver" önerisi KORUMA SAĞLAMIYOR. `rateLimit` sayacı KOŞULSUZ artırıyor
 * (`rate-limit.ts`: `"count" = r."count" + 1`), karşılaştırma ondan SONRA JS'te
 * yapılıyor. Yani limiti aşan QR çağrıları modele gitmez ama PAYLAŞILAN SAYACI
 * YAKMAYA DEVAM EDER — 25 daire × 200 daire-tavanı = 5.000 artış, org tavanı 1.500,
 * inbox yine kilitlenir. Tasarımı körü körüne uygulasaydım koruma KURGUSAL olurdu.
 *
 * DOĞRU ŞEKİL — İKİ KOVA, SIRA ÖNEMLİ:
 *   1. QR'ın KENDİ kovası (`ai-daily-qr:{org}`, tavan = payı). Taşarsa ERKEN DÖN —
 *      paylaşılan sayaca DOKUNMADAN. Kritik olan bu: taşan QR trafiği inbox'ın
 *      hakkını yiyemez.
 *   2. Geçerse org'un ORTAK tavanı da uygulanır (`ai-daily:{org}`, tavan = cap) —
 *      böylece TOPLAM harcama `cap`'i ASLA aşmaz, yani org'un faturası korunur.
 *
 * Sonuç üç garanti birden: QR ≤ pay · toplam ≤ cap · inbox'a her zaman en az
 * (cap − pay) kalır. Ve QR sessizken inbox tavanın TAMAMINI kullanabilir (ayrı
 * "carve-out" tasarımının israfı yok).
 *
 * ⚠️ Migration YOK: `RateLimitCounter` jenerik key-value, yeni anahtar yeter.
 */
const QR_SHARE_DEFAULT = 0.3;

/** Env override — `AI_DAILY_CALL_CAP` ile aynı sıkı doğrulama deseni. */
export function dailyAiQrSharePercent(): number {
  const raw = process.env.AI_DAILY_QR_SHARE_PERCENT?.trim();
  if (!raw || !/^\d{1,3}$/.test(raw)) return QR_SHARE_DEFAULT * 100;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? n : QR_SHARE_DEFAULT * 100;
}

export async function consumeDailyAiBudgetForQr(organizationId: string): Promise<DailyBudgetVerdict> {
  const override = dailyAiCallCapOverride();
  const cap = override ?? (await limitsForOrg(organizationId)).aiCallsPerDay;
  const qrCeiling = Math.max(1, Math.floor((cap * dailyAiQrSharePercent()) / 100));

  // 1) QR'ın kendi payı. Taşarsa paylaşılan sayaca DOKUNMADAN dön.
  const own = await rateLimit(`ai-daily-qr:${organizationId}`, qrCeiling, DAY_MS);
  if (!own.ok) return { ok: false, retryAfter: own.retryAfter, cap: qrCeiling };

  // 2) Org'un ortak tavanı — toplam harcama `cap`'i aşmasın.
  const shared = await rateLimit(`ai-daily:${organizationId}`, cap, DAY_MS);
  return { ok: shared.ok, retryAfter: shared.retryAfter, cap: qrCeiling };
}

export async function consumeDailyAiBudget(organizationId: string): Promise<DailyBudgetVerdict> {
  // Tavan PLANA göre (Başlangıç < Pro < İşletme). Env override'ı varsa o kazanır —
  // canlı bir arıza sırasında tek yerden kısabilmek için.
  const override = dailyAiCallCapOverride();
  const cap =
    override ??
    (await limitsForOrg(organizationId)).aiCallsPerDay;
  const verdict = await rateLimit(`ai-daily:${organizationId}`, cap, DAY_MS);
  return { ok: verdict.ok, retryAfter: verdict.retryAfter, cap };
}
