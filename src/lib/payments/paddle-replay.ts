import "server-only";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { alertOnTransition, alertStateActive, clearAlertState } from "@/lib/alert-state";
import { isRedactedPaddlePayload, NEEDS_REVIEW_PREFIX } from "@/lib/data-retention";
import { getPaddleWebhookSecret, probePaddleRead, signPaddleWebhook } from "@/lib/payments/paddle";
import { runAsPaddleReplay } from "@/lib/payments/paddle-replay-context";

// ---------------------------------------------------------------------------
// İŞLENEMEYEN PADDLE OLAYI YALNIZ PADDLE'IN TEKRARINA BIRAKILMAZ (S7, kurucu kararı 11-11).
//
// İmzası doğrulanan her olay `WebhookEvent`e yazılır; işlenemezse satır "hata" kalır ve Paddle'a 500 döner. Paddle yeniden gönderir —
// ama SINIRLI süre: denemeler bitince olay kendiliğinden bir daha gelmez (elle yeniden oynatma ister). O güne dek düzelmemiş bir arıza
// (ör. API anahtarımız reddediliyor → "kayıtlı abonelik okunamadı") abonelik değişikliğini kalıcı olarak kaybettirirdi.
//
// Bu iş, saklı olayı AYNI uç noktanın işleyicisinden yeniden geçirir: saklı ham gövde kendi webhook sırrımızla imzalanıp süreç içinde
// işleyiciye verilir. Teslim ile yeniden işleme TEK kod yoludur (kopya işleyici yok): kopya denetimi, sıra koruması (daha yeni olay
// uygulanmışsa eskisi düşer), inceleme kuralları birebir geçerlidir. Yeni tablo / sütun yok.
//
// Kurallar:
//  · Aday: son 14 günün abonelik / ödeme olayı; "hata" (inceleme bekleyen HARİÇ — insan kararı ister) ya da 15 dakikadan uzun "alındı"
//    (işlem sırasında süreç çöktü). Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez.
//  · Sıklık olay başına sınırlı: yaşı eşikleri (15 dk, 1 sa, 2, 4 … 256 sa) geçtikçe birer kez — 14 günde en çok 10. Hep hata veren
//    olay ötekileri bekletmez.
//  · "Paddle okunamadı / API anahtarı reddedildi" sınıfı önce TEK ucuz okumayla sınanır. Okunamıyorsa o sınıftan hiçbir olay denenmez
//    ve işletmesiz TEK ortak alarm durumu açılır; düzelince ilk turda o sınıftaki bekleyenlerin HEPSİ geçirilir, alarm kapanır.
// ---------------------------------------------------------------------------

export const PADDLE_REPLAY_WINDOW_MS = 14 * 86_400_000;
/**
 * İlk alınışından bu kadar sonra hâlâ "alındı"da duran olay yarıda kalmış sayılır (işleme saniyeler sürer; pay İLK teslimle yarışmamak
 * içindir). Paddle'ın sonraki tekrarıyla aynı anda işlenebilir — satırda "son güncelleme" anı yok; sorun değil: işleyiciler tekrar
 * edilebilir (abonelik yazımı sıra korumalı ve koşullu, fatura sağlayıcı kimliğinde veritabanı düzeyinde tekil).
 */
export const PADDLE_REPLAY_STUCK_MS = 15 * 60_000;
const HOUR = 3_600_000;
/** Olayın yaşı bu eşikleri geçtikçe birer kez yeniden işlenir. */
export const PADDLE_REPLAY_THRESHOLDS_MS: readonly number[] = [15 * 60_000, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 16 * HOUR, 32 * HOUR, 64 * HOUR, 128 * HOUR, 256 * HOUR];
/** Bir turda okunan en çok aday (en eskiler önce). */
const PADDLE_REPLAY_BATCH = 200;
/** Son turun anı (`SystemLock.lockedUntil`) — hangi eşiklerin bu turda geçildiğini bilmek için. */
const LAST_PASS_LOCK = "paddle-webhook-replay:last";
/** Ortak alarm durumunun anahtarı (işletmesiz). */
export const PADDLE_REPLAY_KEY_ALERT = "paddle-webhook-replay:api-read";
/** İşleyicinin "şu an okunamadı" hatasının kayıtta tanınan parçası (`api/webhooks/paddle/route.ts`; eşleşme testle pinli). */
export const PADDLE_UNREADABLE_MARKER = "şu an okunamadı";

/**
 * Bu olay bu turda yeniden işlenmeli mi: yaşı, son turdan bu yana bir eşiği geçti mi. Son tur bilinmiyorsa (ilk tur) ilk eşiği geçmiş
 * her olay bir kez işlenir. Uzun bir aradan sonra geçilen birden çok eşik TEK işlemeye iner.
 */
export function paddleReplayDue(createdAt: Date, lastPassAt: Date | null, now: Date): boolean {
  const ageNow = now.getTime() - createdAt.getTime();
  const ageLast = lastPassAt ? lastPassAt.getTime() - createdAt.getTime() : Number.NEGATIVE_INFINITY;
  return PADDLE_REPLAY_THRESHOLDS_MS.some((t) => ageLast < t && t <= ageNow);
}

/** Kayıttaki hata "Paddle şu an okunamadı / anahtar reddedildi" sınıfı mı. */
export function isPaddleUnreadableError(error: string | null | undefined): boolean {
  return typeof error === "string" && error.includes(PADDLE_UNREADABLE_MARKER);
}

/** Saklı gövdeden olay zamanı (sıralama için); okunamazsa null. */
function occurredAtOf(payloadJson: string): number | null {
  try {
    const at = new Date((JSON.parse(payloadJson) as { occurred_at?: string }).occurred_at ?? "").getTime();
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}

export type PaddleRedeliver = (req: NextRequest) => Promise<Response>;

/** Varsayılan teslim: uç noktanın kendi işleyicisi (süreç içi; ağ yok). */
const deliverToRoute: PaddleRedeliver = async (req) => (await import("@/app/api/webhooks/paddle/route")).POST(req);

export interface PaddleReplayResult {
  /** Pencerede bulunan, yeniden işlenebilir olay sayısı. */
  pending: number;
  /** Bu turda işleyiciye verilen olay sayısı. */
  replayed: number;
  /** İşleyicinin 2xx döndüğü (işlendi / kopya / incelemeye alındı) olay sayısı. */
  settled: number;
  /** Anahtar okunamadığı için bu turda HİÇ denenmeyen olay sayısı. */
  heldForKey: number;
}

/**
 * Bekleyen Paddle olaylarını yeniden işler (saatlik zamanlanmış iş çağırır). Asla fırlatmaz — tek olayın hatası ötekileri durdurmaz.
 * Webhook sırrı yoksa (ödeme kurulmamış) hiçbir şey yapmaz.
 */
export async function replayPendingPaddleEvents(opts: { now?: Date; deliver?: PaddleRedeliver } = {}): Promise<PaddleReplayResult> {
  const result: PaddleReplayResult = { pending: 0, replayed: 0, settled: 0, heldForKey: 0 };
  const secret = getPaddleWebhookSecret();
  if (!secret) return result;
  const now = opts.now ?? new Date();
  const deliver = opts.deliver ?? deliverToRoute;

  const rows = await prisma.webhookEvent.findMany({
    where: {
      provider: "paddle",
      providerEventId: { not: null },
      createdAt: { gte: new Date(now.getTime() - PADDLE_REPLAY_WINDOW_MS) },
      AND: [
        { OR: [{ status: "error" }, { status: "received", createdAt: { lte: new Date(now.getTime() - PADDLE_REPLAY_STUCK_MS) } }] },
        // İşleyicisi olan türler + inceleme bekleyen HARİÇ — SORGUDA (Opus incelemesi 11-11): bellekte süzülseydi inceleme bekleyen
        // 200 eski satır okunan dilimi doldurur, yeni hatalar hiç görülmezdi. `error` boş olabilen alan: "şununla başlamayan" koşulu
        // boş değerli satırı da dışarıda bırakırdı → boş değer açıkça kabul edilir.
        { OR: [{ eventType: { startsWith: "subscription." } }, { eventType: { startsWith: "transaction." } }] },
        { OR: [{ error: null }, { NOT: { error: { startsWith: NEEDS_REVIEW_PREFIX } } }] },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PADDLE_REPLAY_BATCH,
    select: { id: true, providerEventId: true, eventType: true, status: true, error: true, payloadJson: true, createdAt: true },
  });
  // Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez — gövdenin içeriğine bakar, sorguda süzülemez.
  const candidates = rows.filter((r) => !isRedactedPaddlePayload(r.payloadJson));
  result.pending = candidates.length;

  const lastPass = await prisma.systemLock.findUnique({ where: { name: LAST_PASS_LOCK }, select: { lockedUntil: true } }).catch(() => null);
  const lastPassAt = lastPass?.lockedUntil ?? null;

  const keyClass = candidates.filter((r) => r.status === "error" && isPaddleUnreadableError(r.error));
  const others = candidates.filter((r) => !keyClass.includes(r));
  let chosen = others.filter((r) => paddleReplayDue(r.createdAt, lastPassAt, now));

  if (keyClass.length > 0) {
    if ((await probePaddleRead()) === "ok") {
      // Anahtar az önce düzeldiyse bekleyenlerin HEPSİ (yaş eşiği beklenmez); zaten sağlamsa olağan sıklık.
      const healed = await alertStateActive(PADDLE_REPLAY_KEY_ALERT);
      chosen = chosen.concat(healed ? keyClass : keyClass.filter((r) => paddleReplayDue(r.createdAt, lastPassAt, now)));
      await clearAlertState(PADDLE_REPLAY_KEY_ALERT);
    } else {
      result.heldForKey = keyClass.length;
      await alertOnTransition(
        PADDLE_REPLAY_KEY_ALERT,
        "paddle-api-read-unavailable",
        new Error(
          `Paddle API şu an okunamıyor ya da API anahtarımız reddediliyor — ${keyClass.length} ödeme olayı bekliyor (abonelikler olduğu gibi korunuyor). Anahtar düzelince olaylar kendiliğinden yeniden işlenir; Railway'deki PADDLE_API_KEY değerini kontrol edin.`,
        ),
        { now },
      );
    }
  } else if (await alertStateActive(PADDLE_REPLAY_KEY_ALERT)) {
    // Bekleyen kalmadı (Paddle'ın kendi tekrarı işledi ya da pencere doldu) → durum kapanır; yeni bir arıza yeniden bildirilir.
    await clearAlertState(PADDLE_REPLAY_KEY_ALERT);
  }

  // Olay zamanına göre sırayla (bilinmiyorsa alınma zamanı): eski olay yenisinden sonra uygulanmaya çalışılmasın.
  chosen.sort((a, b) => (occurredAtOf(a.payloadJson) ?? a.createdAt.getTime()) - (occurredAtOf(b.payloadJson) ?? b.createdAt.getTime()));
  for (const row of chosen) {
    result.replayed++;
    try {
      const request = new NextRequest("http://internal.invalid/api/webhooks/paddle", {
        method: "POST",
        headers: { "content-type": "application/json", "paddle-signature": signPaddleWebhook(row.payloadJson, secret, Math.floor(Date.now() / 1000)) },
        body: row.payloadJson,
      });
      // Süreç içi işaret: işleyici bu teslimi "Paddle'dan geldi, sır doğru" kanıtı saymaz (`paddle-replay-context.ts`).
      const res = await runAsPaddleReplay(() => deliver(request));
      if (res.status >= 200 && res.status < 300) result.settled++;
    } catch {
      // İşleyici fırlatmaz (kendi hatasını kayda yazar); yine de tek olay turu düşürmesin.
    }
  }

  await prisma.systemLock
    .upsert({ where: { name: LAST_PASS_LOCK }, create: { name: LAST_PASS_LOCK, lockedUntil: now }, update: { lockedUntil: now } })
    .catch(() => {});
  return result;
}
