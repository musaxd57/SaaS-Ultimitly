import "server-only";

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { alertOnTransition, alertStateActive, clearAlertState } from "@/lib/alert-state";
import { isRedactedPaddlePayload, NEEDS_REVIEW_PREFIX } from "@/lib/data-retention";
import { getPaddleWebhookSecret, probePaddleRead, signPaddleWebhook } from "@/lib/payments/paddle";
import { runAsPaddleReplay } from "@/lib/payments/paddle-replay-context";
import { nextPaddleReplayAt, PADDLE_REPLAY_THRESHOLDS_MS } from "@/lib/payments/paddle-replay-schedule";
import { newCorrelationId, runWithCorrelation } from "@/lib/correlation";

// ---------------------------------------------------------------------------
// İŞLENEMEYEN PADDLE OLAYI YALNIZ PADDLE'IN TEKRARINA BIRAKILMAZ (S7, kurucu kararı 11-11).
//
// İmzası doğrulanan her olay `WebhookEvent`e yazılır; işlenemezse satır "hata" kalır ve Paddle'a 500 döner. Paddle yeniden gönderir —
// ama SINIRLI süre: denemeler bitince olay kendiliğinden bir daha gelmez (elle yeniden oynatma ister). O güne dek düzelmemiş bir arıza
// (ör. API anahtarımız reddediliyor → "kayıtlı abonelik okunamadı") abonelik değişikliğini kalıcı olarak kaybettirirdi.
//
// Bu iş, saklı olayı AYNI uç noktanın işleyicisinden yeniden geçirir: saklı ham gövde kendi webhook sırrımızla imzalanıp süreç içinde
// işleyiciye verilir. Teslim ile yeniden işleme TEK kod yoludur (kopya işleyici yok): kopya denetimi, sıra koruması (daha yeni olay
// uygulanmışsa eskisi düşer), inceleme kuralları birebir geçerlidir.
//
// Kurallar:
//  · Aday: son 14 günün abonelik / ödeme olayı; "hata" (inceleme bekleyen HARİÇ — insan kararı ister) ya da 15 dakikadan uzun "alındı"
//    (işlem sırasında süreç çöktü). Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez.
//  · Sıklık olay başına sınırlı: yaşı eşikleri (15 dk, 1 sa, 2, 4 … 256 sa) geçtikçe birer kez — 14 günde en çok 10. Hep hata veren
//    olay ötekileri bekletmez.
//  · 🚨 VADE OLAYIN KENDİ SATIRINDA (kurucu 11-18 akşam, migration 98): `nextAttemptAt` — işleyici ilk vadeyi (alınış + 15 dk) yazar,
//    işlenince / incelemeye düşünce siler; bu iş her denemeden sonra sayacı (`attemptCount`), son deneme anını (`lastAttemptAt`) ve
//    SIRADAKİ eşiği yazar (`paddle-replay-schedule.ts`; eşik kalmadıysa boş). Seçim SORGUDA: `nextAttemptAt <= şimdi`, en uzun bekleyen
//    önce (Codex 11-17 B1: "en eski N'i oku, sonra süz" yok). Eskiden vade `createdAt` + ortak "son tur" işaretinden türetiliyor, tavan
//    aşımı için ayrı bir "mantıksal tur" makinesi (dondurulmuş an + devam imleci) gerekiyordu. Artık gerek yok: denenen satır vadeden
//    çıkar, sonraki koşu kendiliğinden kalanla başlar; en uzun bekleyen önce okunduğu için hep hata veren satır ötekileri bekletmez.
//    Tavan (`PADDLE_REPLAY_MAX_PER_PASS`) ve geçiş tabanlı tavan alarmı kalır.
//  · Geçiş: vadesi BOŞ eski satır (migration öncesi yazılmış, hiç denenmemiş) her koşunun başında planlanır — eski sürümün son tur
//    işaretinden SONRA geçilecek ilk eşik (işaret yoksa ilk eşik). Planlanan satır kümeden çıkar; tavanı aşan kısım sonraki koşuya kalır
//    ve tavan alarmına girer (sessiz tavan yok).
//  · "Paddle okunamadı / API anahtarı reddedildi" sınıfı önce TEK ucuz okumayla sınanır. Okunamıyorsa o sınıftan hiçbir olay denenmez
//    (vadesi de İLERLEMEZ) ve işletmesiz TEK ortak alarm durumu açılır; düzelince ilk turda o sınıftaki bekleyenlerin HEPSİ geçirilir,
//    alarm kapanır.
// ---------------------------------------------------------------------------

export const PADDLE_REPLAY_WINDOW_MS = 14 * 86_400_000;
/**
 * İlk alınışından bu kadar sonra hâlâ "alındı"da duran olay yarıda kalmış sayılır (işleme saniyeler sürer; pay İLK teslimle yarışmamak
 * içindir). Paddle'ın sonraki tekrarıyla aynı anda işlenebilir — sorun değil: işleyiciler tekrar edilebilir (abonelik yazımı sıra
 * korumalı ve koşullu, fatura sağlayıcı kimliğinde veritabanı düzeyinde tekil).
 */
export const PADDLE_REPLAY_STUCK_MS = 15 * 60_000;
export { PADDLE_REPLAY_THRESHOLDS_MS } from "@/lib/payments/paddle-replay-schedule";
/** Tek sorguda okunan aday sayısı (sayfa boyu; en uzun bekleyen önce). */
const PADDLE_REPLAY_PAGE = 200;
/**
 * Bir koşuda okunan (ve en çok işleyiciye verilen) aday tavanı; geçiş adımında planlanan eski satır tavanı da aynı. Satırlar koşu boyunca
 * bellekte tutulur (sıra koruması: olay zamanına göre TEK sıralama, sayfalar arasında da) — tavan belleği de sınırlar.
 */
export const PADDLE_REPLAY_MAX_PER_PASS = 2_000;
/** Tavan aşıldı alarmının durumu (işletmesiz). */
export const PADDLE_REPLAY_BACKLOG_ALERT = "paddle-webhook-replay:backlog";
/**
 * Eski sürümün son turunun anı (`SystemLock.lockedUntil`). Artık YAZILMAZ; yalnız geçiş adımı okur (vadesi boş eski satırın hangi
 * eşiklerinin o sürümde zaten harcandığını bilmek için).
 */
const LEGACY_LAST_PASS_LOCK = "paddle-webhook-replay:last";
/** Eski sürümün tavan aşımı devam kaydı. Okunmaz; geçiş adımında silinir (kalan iş satır vadelerinden kendiliğinden sürer). */
const LEGACY_RESUME_LOCK = "paddle-webhook-replay:resume";
/** Ortak alarm durumunun anahtarı (işletmesiz). */
export const PADDLE_REPLAY_KEY_ALERT = "paddle-webhook-replay:api-read";
/** İşleyicinin "şu an okunamadı" hatasının kayıtta tanınan parçası (`api/webhooks/paddle/route.ts`; eşleşme testle pinli). */
export const PADDLE_UNREADABLE_MARKER = "şu an okunamadı";

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
  /** Pencerede bulunan, yeniden işlenebilir olay sayısı (vadesi gelmemişler dahil; küçültülmüş yük hariç). */
  pending: number;
  /** Bu turda işleyiciye verilen olay sayısı. */
  replayed: number;
  /** İşleyicinin 2xx döndüğü (işlendi / kopya / incelemeye alındı) olay sayısı. */
  settled: number;
  /** Anahtar okunamadığı için bu turda HİÇ denenmeyen olay sayısı. */
  heldForKey: number;
}

/**
 * Yeniden işlenebilir durum: "alındı" ya da inceleme beklemeyen "hata". Deneme sonrası vade yalnız bu durumdaki satıra yazılır (işlenen /
 * incelemeye düşen satırın vadesi boş kalır). `error` boş olabilen alan: "şununla başlamayan" koşulu boş değerli satırı da dışarıda
 * bırakırdı → boş değer açıkça kabul edilir.
 */
const PENDING_STATUS_WHERE: Prisma.WebhookEventWhereInput = {
  OR: [{ status: "received" }, { status: "error", OR: [{ error: null }, { NOT: { error: { startsWith: NEEDS_REVIEW_PREFIX } } }] }],
};

/**
 * GEÇİŞ: vadesi boş, hiç denenmemiş aday satırları (migration 98 öncesi yazılmış) planlar — eski sürümün son tur işaretinden SONRA
 * geçilecek ilk eşik; işaret yoksa ilk eşik (eşiği geçmişse hemen vadeli). Eski kuralla aynı: işarette son eşiği çoktan geçmiş satır o
 * kuralda da bir daha denenmezdi → sorguda elenir, vadesi boş kalır. Planlanan satır kümeden çıkar (tekrar çalıştırılabilir; ikinci koşu
 * hiçbir şey değiştirmez). En çok `maxRows` satır; fazlası varsa true döner (çağıran tavan alarmına katar, kalan sonraki koşuda).
 */
async function planUnscheduledRows(base: Prisma.WebhookEventWhereInput, maxRows: number): Promise<boolean> {
  // Eski sürümün tavan aşımı devam kaydı artık okunmaz: o turun kalanı da vadesi boş eski satırdır ve burada planlanır.
  await prisma.systemLock.deleteMany({ where: { name: LEGACY_RESUME_LOCK } }).catch(() => {});
  const marker =
    (await prisma.systemLock.findUnique({ where: { name: LEGACY_LAST_PASS_LOCK }, select: { lockedUntil: true } }).catch(() => null))?.lockedUntil ?? null;
  const lastThreshold = PADDLE_REPLAY_THRESHOLDS_MS[PADDLE_REPLAY_THRESHOLDS_MS.length - 1];
  const where: Prisma.WebhookEventWhereInput = {
    AND: [base, { nextAttemptAt: null, attemptCount: 0 }, ...(marker ? [{ createdAt: { gt: new Date(marker.getTime() - lastThreshold) } }] : [])],
  };
  // İmleç: planlanan satır zaten kümeden çıkar; imleç yalnız yazımı başarısız olan satırın aynı koşuda yeniden okunmaması içindir.
  let cursor: { createdAt: Date; id: string } | null = null;
  let read = 0;
  const after = (c: typeof cursor): Prisma.WebhookEventWhereInput =>
    c ? { AND: [where, { OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] }] } : where;
  for (;;) {
    const take = Math.min(PADDLE_REPLAY_PAGE, maxRows - read);
    const page: { id: string; createdAt: Date }[] = await prisma.webhookEvent.findMany({ where: after(cursor), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take, select: { id: true, createdAt: true } });
    for (const r of page) {
      const next = nextPaddleReplayAt(r.createdAt, marker);
      // Koşullu: okuma ile yazma arasında işleyici satırı planladıysa (Paddle'ın tekrarı) onun vadesi ezilmez.
      if (next) await prisma.webhookEvent.updateMany({ where: { id: r.id, nextAttemptAt: null }, data: { nextAttemptAt: next } }).catch(() => {});
    }
    read += page.length;
    if (page.length < take) return false;
    cursor = page[page.length - 1];
    if (read >= maxRows) return (await prisma.webhookEvent.findFirst({ where: after(cursor), select: { id: true } })) !== null;
  }
}

/**
 * Deneme kaydı: sayaç +1, son deneme = koşunun anı. Satır hâlâ yeniden işlenebilir durumdaysa vade = şimdiki yaştan büyük ilk eşik
 * (eşik kalmadıysa boş — eski kuralın "son eşikten sonra yok"u); işlendi / incelemeye düştüyse boş.
 */
async function recordAttempt(row: { id: string; createdAt: Date }, now: Date): Promise<void> {
  const counted = { attemptCount: { increment: 1 }, lastAttemptAt: now };
  // İki koşullu yazım: durum her ikisinde de WHERE'de — arada Paddle'ın tekrarı satırı yeniden "alındı"ya çektiyse (işleyici vadeyi yazdı)
  // vade boşaltılmaz (boş vade + aday = kalıcı kayıp). Satır iki yazım arasında yine durum değiştirdiyse bir kez daha denenir.
  for (let i = 0; i < 2; i++) {
    const pending = await prisma.webhookEvent.updateMany({
      where: { AND: [{ id: row.id }, PENDING_STATUS_WHERE] },
      data: { ...counted, nextAttemptAt: nextPaddleReplayAt(row.createdAt, now) },
    });
    if (pending.count > 0) return;
    const settled = await prisma.webhookEvent.updateMany({
      where: { AND: [{ id: row.id }, { NOT: PENDING_STATUS_WHERE }] },
      data: { ...counted, nextAttemptAt: null },
    });
    if (settled.count > 0) return;
  }
}

/**
 * Bekleyen Paddle olaylarını yeniden işler (saatlik zamanlanmış iş çağırır). Asla fırlatmaz — tek olayın hatası ötekileri durdurmaz.
 * Webhook sırrı yoksa (ödeme kurulmamış) hiçbir şey yapmaz.
 */
export async function replayPendingPaddleEvents(
  opts: { now?: Date; deliver?: PaddleRedeliver; /** Yalnız test: koşu tavanı (üretimde sabit). */ maxPerPass?: number } = {},
): Promise<PaddleReplayResult> {
  const result: PaddleReplayResult = { pending: 0, replayed: 0, settled: 0, heldForKey: 0 };
  const secret = getPaddleWebhookSecret();
  if (!secret) return result;
  const now = opts.now ?? new Date();
  const deliver = opts.deliver ?? deliverToRoute;
  const maxPerPass = opts.maxPerPass ?? PADDLE_REPLAY_MAX_PER_PASS;

  const base: Prisma.WebhookEventWhereInput = {
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
  };
  // "Paddle okunamadı" sınıfı (`isPaddleUnreadableError` ile aynı koşul) ve tümleyeni. `error` boş olabilir: boş değerli "hata" satırı
  // tümleyene girer (nullable `NOT` dersi: `NOT contains` NULL'u da dışarıda bırakırdı).
  const keyWhere: Prisma.WebhookEventWhereInput = { status: "error", error: { contains: PADDLE_UNREADABLE_MARKER } };
  const notKeyWhere: Prisma.WebhookEventWhereInput = {
    OR: [{ status: { not: "error" } }, { error: null }, { NOT: { error: { contains: PADDLE_UNREADABLE_MARKER } } }],
  };

  // İşin başında: vadesi boş eski satırlar planlanır (seçim aşağıda yalnız vadeye bakar).
  const planTruncated = await planUnscheduledRows(base, maxPerPass);

  // Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez ve bekleyen sayılmaz — gövdenin içeriğine bakar, sorguda tam süzülemez.
  // Sayılar (bekleyen / anahtar yüzünden bekleyen) için yalnız gövdesinde "redactedAt" geçen satırlar okunup bellekte tanınır (pratikte boş
  // küme: kurum silme küçültmesi inceleme önekiyle yazılır, KVKK silme satırı "işlendi" yapar). Seçimin kendisi bu ön süzgece DAYANMAZ.
  const redacted = (
    await prisma.webhookEvent.findMany({
      where: { AND: [base, { payloadJson: { contains: "redactedAt" } }] },
      take: maxPerPass,
      select: { status: true, error: true, payloadJson: true },
    })
  ).filter((r) => isRedactedPaddlePayload(r.payloadJson));
  const isKeyRow = (r: { status: string; error: string | null }) => r.status === "error" && isPaddleUnreadableError(r.error);
  result.pending = (await prisma.webhookEvent.count({ where: base })) - redacted.length;
  const keyPending = (await prisma.webhookEvent.count({ where: { AND: [base, keyWhere] } })) - redacted.filter(isKeyRow).length;

  const dueWhere: Prisma.WebhookEventWhereInput = { nextAttemptAt: { lte: now } };

  // Seçim: olağan durumda vadesi gelen her aday (anahtar sınıfı da olağan sıklıkta). Anahtar okunamıyorsa o sınıf hiç seçilmez (vadesi
  // de ilerlemez — denenmediği için yazılmaz); az önce düzeldiyse o sınıfın HEPSİ (vade beklenmez).
  let selection: Prisma.WebhookEventWhereInput = dueWhere;
  let probeOk = false;
  let keyHealed = false;
  if (keyPending > 0) {
    if ((await probePaddleRead()) === "ok") {
      probeOk = true;
      // Anahtar az önce düzeldiyse bekleyenlerin HEPSİ (vade beklenmez); zaten sağlamsa olağan sıklık.
      keyHealed = await alertStateActive(PADDLE_REPLAY_KEY_ALERT);
      if (keyHealed) selection = { OR: [dueWhere, keyWhere] };
    } else {
      result.heldForKey = keyPending;
      selection = { AND: [dueWhere, notKeyWhere] };
      await alertOnTransition(
        PADDLE_REPLAY_KEY_ALERT,
        "paddle-api-read-unavailable",
        new Error(
          `Paddle API şu an okunamıyor ya da API anahtarımız reddediliyor — ${keyPending} ödeme olayı bekliyor (abonelikler olduğu gibi korunuyor). Anahtar düzelince olaylar kendiliğinden yeniden işlenir; Railway'deki PADDLE_API_KEY değerini kontrol edin.`,
        ),
        { now },
      );
    }
  } else if (await alertStateActive(PADDLE_REPLAY_KEY_ALERT)) {
    // Bekleyen kalmadı (Paddle'ın kendi tekrarı işledi ya da pencere doldu) → durum kapanır; yeni bir arıza yeniden bildirilir.
    await clearAlertState(PADDLE_REPLAY_KEY_ALERT);
  }

  // Seçilenler sayfa sayfa, EN UZUN BEKLEYEN ÖNCE (vade, sonra kimlik; düzelme turunda vadesi boş — eşikleri tükenmiş — anahtar satırı da
  // seçilir, boşlar en önde). Denenen satır vadeden çıktığı için tavanı aşan kısım sonraki koşunun başında gelir; hep hata veren satır
  // yeni eşiği geçse bile kendisinden uzun bekleyenin önüne geçemez. Küçültülmüş yük bellekte elenir (vadesi yine ilerletilir, aşağıda).
  type Candidate = { id: string; payloadJson: string; createdAt: Date; nextAttemptAt: Date | null };
  type Cursor = { nextAttemptAt: Date | null; id: string };
  const chosen: Candidate[] = [];
  const skipped: Candidate[] = [];
  let read = 0;
  let cursor: Cursor | null = null;
  let truncated = false;
  const afterCursor = (c: Cursor | null): Prisma.WebhookEventWhereInput => ({
    AND: [
      base,
      selection,
      ...(c
        ? [
            c.nextAttemptAt
              ? { OR: [{ nextAttemptAt: { gt: c.nextAttemptAt } }, { nextAttemptAt: c.nextAttemptAt, id: { gt: c.id } }] }
              : { OR: [{ nextAttemptAt: null, id: { gt: c.id } }, { nextAttemptAt: { not: null } }] },
          ]
        : []),
    ],
  });
  for (;;) {
    const take = Math.min(PADDLE_REPLAY_PAGE, maxPerPass - read);
    const page: Candidate[] = await prisma.webhookEvent.findMany({
      where: afterCursor(cursor),
      orderBy: [{ nextAttemptAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take,
      select: { id: true, payloadJson: true, createdAt: true, nextAttemptAt: true },
    });
    read += page.length;
    for (const r of page) (isRedactedPaddlePayload(r.payloadJson) ? skipped : chosen).push(r);
    if (page.length < take) break;
    cursor = page[page.length - 1];
    if (read >= maxPerPass) {
      truncated = (await prisma.webhookEvent.findFirst({ where: afterCursor(cursor), select: { id: true } })) !== null;
      break;
    }
  }
  // Anahtar okunabiliyor → durum kapanır. İstisna: düzelme turunda tavan aşıldıysa durum AÇIK kalır — kapansaydı kalan bekleyenler olağan
  // sıklığa düşerdi; açık kalınca sonraki turda da vade beklemeden geçerler.
  if (probeOk && !(keyHealed && truncated)) await clearAlertState(PADDLE_REPLAY_KEY_ALERT);

  // Küçültülmüş yük denenmez ve sayılmaz; vadesi yine sıradaki eşiğe ilerler — yoksa her koşuda en önde okunur, tavanı doldururdu.
  for (const row of skipped) {
    await prisma.webhookEvent
      .updateMany({ where: { id: row.id, nextAttemptAt: row.nextAttemptAt }, data: { nextAttemptAt: nextPaddleReplayAt(row.createdAt, now) } })
      .catch(() => {});
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
      // Her olay KENDİ takip bağlamında (sızma testi 11-14, F-1): işleyici açık bir bağlam bulursa yenisini açmaz ve onay zincirine
      // bağlanınca numarayı YERİNDE değiştirir (`adoptCorrelation`) — eskiden A işletmesinin onay numarası senkron geçişinin kalanına ve
      // B işletmesinin ödeme olaylarına yazılıyordu (destek ekranında yanlış zincir).
      const res = await runWithCorrelation({ id: newCorrelationId(), organizationId: null }, () => runAsPaddleReplay(() => deliver(request)));
      if (res.status >= 200 && res.status < 300) result.settled++;
    } catch {
      // İşleyici fırlatmaz (kendi hatasını kayda yazar); yine de tek olay turu düşürmesin.
    }
    // Teslimden SONRA (fırlatsa da): süreç teslim sırasında çökerse satır vadeli kalır, sonraki koşuda bir kez daha denenir — kayıp yok.
    // Yazım düşerse de aynı: satır vadeli kalır.
    await recordAttempt(row, now).catch(() => {});
  }

  if (truncated || planTruncated) {
    await alertOnTransition(
      PADDLE_REPLAY_BACKLOG_ALERT,
      "paddle-webhook-replay-backlog",
      new Error(
        `${maxPerPass}'den fazla ödeme olayı yeniden işlenmeyi bekliyor — yeniden işleme birkaç saatlik koşuya bölündü (her koşuda en çok ${maxPerPass}). Uzun süren bir genel arıza olabilir; ödeme olayı kayıtlarındaki hataları kontrol edin.`,
      ),
      { now },
    );
  } else {
    await clearAlertState(PADDLE_REPLAY_BACKLOG_ALERT);
  }
  return result;
}
