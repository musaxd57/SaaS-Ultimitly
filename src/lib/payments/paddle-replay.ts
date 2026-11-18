import "server-only";

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { alertOnTransition, alertStateActive, clearAlertState } from "@/lib/alert-state";
import { isRedactedPaddlePayload, NEEDS_REVIEW_PREFIX } from "@/lib/data-retention";
import { getPaddleWebhookSecret, probePaddleRead, signPaddleWebhook } from "@/lib/payments/paddle";
import { runAsPaddleReplay } from "@/lib/payments/paddle-replay-context";
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
// uygulanmışsa eskisi düşer), inceleme kuralları birebir geçerlidir. Yeni tablo / sütun yok.
//
// Kurallar:
//  · Aday: son 14 günün abonelik / ödeme olayı; "hata" (inceleme bekleyen HARİÇ — insan kararı ister) ya da 15 dakikadan uzun "alındı"
//    (işlem sırasında süreç çöktü). Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez.
//  · Sıklık olay başına sınırlı: yaşı eşikleri (15 dk, 1 sa, 2, 4 … 256 sa) geçtikçe birer kez — 14 günde en çok 10. Hep hata veren
//    olay ötekileri bekletmez.
//  · "Paddle okunamadı / API anahtarı reddedildi" sınıfı önce TEK ucuz okumayla sınanır. Okunamıyorsa o sınıftan hiçbir olay denenmez
//    ve işletmesiz TEK ortak alarm durumu açılır; düzelince ilk turda o sınıftaki bekleyenlerin HEPSİ geçirilir, alarm kapanır.
//  · 🚨 Vadesi gelen olay SORGUDA seçilir (Codex 11-17 B1): eskiden en eski 200 aday okunup "vadesi geldi mi" bellekte süzülüyordu ve tur
//    işareti koşulsuz ilerliyordu → vadesi gelmemiş 200 eski adayın arkasındaki olay o turda hiç okunmuyor, geçtiği eşik de "harcanıyordu"
//    (en erken bir sonraki eşikte, o da ilk 200'e girerse denenirdi). Artık vade koşulu `where`dedir (`paddleReplayDueWhere`), vadesi gelenler
//    sayfa sayfa okunur. Tavanı aşan tur birkaç koşuya yayılan TEK MANTIKSAL TURDUR (ana oturum incelemesi, 2. tur): tavanda imleç ve turun
//    DONDURULMUŞ anı kalıcı yazılır, tur işareti ilerlemez; sonraki koşu AYNI pencereyle (aynı son tur, dondurulmuş an) imleçten sonrasını
//    okur. Böylece baştaki satırlar kalıcı hata verse de arkadakiler sırayla gelir ve hiçbir satır bir mantıksal turda iki kez denenmez.
//    Tur bitince tur işareti dondurulmuş ana ilerler (aradaki sürede eşik geçenler sonraki olağan turda bir kez gelir). Tavan aşılınca
//    operatöre geçiş tabanlı alarm; tur bitince kapanır.
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
/** Tek sorguda okunan aday sayısı (sayfa boyu; en eskiler önce). */
const PADDLE_REPLAY_PAGE = 200;
/**
 * Bir turda okunan (ve en çok işleyiciye verilen) aday tavanı. Aşılırsa tur işareti ilerlemez. Satırlar tüm tur boyunca bellekte tutulur
 * (sıra koruması: olay zamanına göre TEK sıralama, sayfalar arasında da) — tavan belleği de sınırlar.
 */
export const PADDLE_REPLAY_MAX_PER_PASS = 2_000;
/**
 * Tavanı aşan mantıksal turun devam kaydı (`SystemLock`; şema değişikliği yok, `LAST_PASS_LOCK` emsali): `lockedUntil` = turun DONDURULMUŞ
 * anı, `holder` = son verilen satırın imleci (`{"at": ISO, "id": …}`).
 */
const RESUME_LOCK = "paddle-webhook-replay:resume";
/** Tavan aşıldı alarmının durumu (işletmesiz). */
export const PADDLE_REPLAY_BACKLOG_ALERT = "paddle-webhook-replay:backlog";
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

/**
 * `paddleReplayDue`un sorgu karşılığı: her eşik `t` için `ageLast < t <= ageNow` ⟺ `lastPassAt − t < createdAt <= now − t` (son tur
 * bilinmiyorsa alt sınır yok). Eşdeğerlik birim testte kâhinle (sınır eşitlikleri dahil) ve veritabanında pinli.
 */
export function paddleReplayDueWhere(lastPassAt: Date | null, now: Date): Prisma.WebhookEventWhereInput {
  return {
    OR: PADDLE_REPLAY_THRESHOLDS_MS.map((t) => ({
      createdAt: lastPassAt
        ? { gt: new Date(lastPassAt.getTime() - t), lte: new Date(now.getTime() - t) }
        : { lte: new Date(now.getTime() - t) },
    })),
  };
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
 * Bekleyen Paddle olaylarını yeniden işler (saatlik zamanlanmış iş çağırır). Asla fırlatmaz — tek olayın hatası ötekileri durdurmaz.
 * Webhook sırrı yoksa (ödeme kurulmamış) hiçbir şey yapmaz.
 */
type ReplayCursor = { createdAt: Date; id: string };

/**
 * Süren mantıksal turun devam kaydı. Bozuk (imleç okunamıyor), bayat (dondurulmuş an 14 günlük pencereden eski) ya da geleceğe yazılmış
 * kayıt yok sayılır ve silinir — iş takılı kalmaz; o kaydın açtığı tavan alarmı da kapanır (yeni taşma yeniden bildirilir).
 */
async function readReplayResume(realNow: Date): Promise<{ frozenNow: Date; cursor: ReplayCursor } | null> {
  const row = await prisma.systemLock.findUnique({ where: { name: RESUME_LOCK } }).catch(() => null);
  if (!row) return null;
  let cursor: ReplayCursor | null = null;
  try {
    const h = JSON.parse(row.holder ?? "") as { at?: unknown; id?: unknown };
    const at = typeof h.at === "string" ? new Date(h.at) : null;
    if (at && !Number.isNaN(at.getTime()) && typeof h.id === "string" && h.id) cursor = { createdAt: at, id: h.id };
  } catch {
    cursor = null;
  }
  const frozen = row.lockedUntil.getTime();
  if (cursor && frozen <= realNow.getTime() && frozen >= realNow.getTime() - PADDLE_REPLAY_WINDOW_MS) return { frozenNow: row.lockedUntil, cursor };
  await prisma.systemLock.deleteMany({ where: { name: RESUME_LOCK } }).catch(() => {});
  await clearAlertState(PADDLE_REPLAY_BACKLOG_ALERT);
  return null;
}

export async function replayPendingPaddleEvents(
  opts: { now?: Date; deliver?: PaddleRedeliver; /** Yalnız test: tur tavanı (üretimde sabit). */ maxPerPass?: number } = {},
): Promise<PaddleReplayResult> {
  const result: PaddleReplayResult = { pending: 0, replayed: 0, settled: 0, heldForKey: 0 };
  const secret = getPaddleWebhookSecret();
  if (!secret) return result;
  const realNow = opts.now ?? new Date();
  const deliver = opts.deliver ?? deliverToRoute;
  const maxPerPass = opts.maxPerPass ?? PADDLE_REPLAY_MAX_PER_PASS;
  // Süren bir mantıksal tur varsa AYNI pencere: turun dondurulmuş anı (pencere, "takılı alındı" eşiği, vade aralıkları ona göre) + imleç.
  const resume = await readReplayResume(realNow);
  const now = resume?.frozenNow ?? realNow;

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

  const lastPass = await prisma.systemLock.findUnique({ where: { name: LAST_PASS_LOCK }, select: { lockedUntil: true } }).catch(() => null);
  const lastPassAt = lastPass?.lockedUntil ?? null;
  const dueWhere = paddleReplayDueWhere(lastPassAt, now);

  // Seçim: olağan durumda vadesi gelen her aday (anahtar sınıfı da olağan sıklıkta). Anahtar okunamıyorsa o sınıf hiç seçilmez; az önce
  // düzeldiyse o sınıfın HEPSİ (yaş eşiği beklenmez).
  let selection: Prisma.WebhookEventWhereInput = dueWhere;
  let probeOk = false;
  let keyHealed = false;
  if (keyPending > 0) {
    if ((await probePaddleRead()) === "ok") {
      probeOk = true;
      // Anahtar az önce düzeldiyse bekleyenlerin HEPSİ (yaş eşiği beklenmez); zaten sağlamsa olağan sıklık.
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

  // Seçilenler sayfa sayfa (alınma zamanı + kimlik imleci; sayfa sınırında aynı anda alınmış iki satır atlanmaz / tekrarlanmaz).
  // Küçültülmüş yük bellekte elenir — sayfa dolu geldikçe okumaya devam edildiği için yer kaplasa da arkasındakileri gizleyemez.
  type Candidate = { id: string; payloadJson: string; createdAt: Date };
  const chosen: Candidate[] = [];
  let read = 0;
  let cursor: ReplayCursor | null = resume?.cursor ?? null;
  let truncated = false;
  const afterCursor = (c: ReplayCursor | null): Prisma.WebhookEventWhereInput => ({
    AND: [base, selection, ...(c ? [{ OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] }] : [])],
  });
  for (;;) {
    const take = Math.min(PADDLE_REPLAY_PAGE, maxPerPass - read);
    const page: Candidate[] = await prisma.webhookEvent.findMany({
      where: afterCursor(cursor),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      select: { id: true, payloadJson: true, createdAt: true },
    });
    read += page.length;
    for (const r of page) if (!isRedactedPaddlePayload(r.payloadJson)) chosen.push(r);
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
  }

  if (truncated && cursor) {
    // Tavan aşıldı: tur işareti İLERLETİLMEZ (ilerleseydi kalanın bu turda geçtiği eşik harcanırdı); kaldığımız yer + dondurulmuş an yazılır,
    // sonraki koşu oradan sürer. Teslimden SONRA yazılır: süreç teslim sırasında çökerse en kötü bu dilim bir kez daha denenir.
    const holder = JSON.stringify({ at: cursor.createdAt.toISOString(), id: cursor.id });
    await prisma.systemLock
      .upsert({ where: { name: RESUME_LOCK }, create: { name: RESUME_LOCK, lockedUntil: now, holder }, update: { lockedUntil: now, holder } })
      .catch(() => {});
    await alertOnTransition(
      PADDLE_REPLAY_BACKLOG_ALERT,
      "paddle-webhook-replay-backlog",
      new Error(
        `${maxPerPass}'den fazla ödeme olayı yeniden işlenmeyi bekliyor — yeniden işleme birkaç saatlik koşuya bölündü (her koşuda en çok ${maxPerPass}). Uzun süren bir genel arıza olabilir; ödeme olayı kayıtlarındaki hataları kontrol edin.`,
      ),
      { now: realNow },
    );
  } else {
    // Mantıksal tur bitti: tur işareti turun DONDURULMUŞ anına (devam koşusunda gerçek ana değil — aradaki sürede eşik geçenler sonraki
    // olağan turda bir kez gelsin), devam kaydı silinir, tavan alarmı kapanır.
    await prisma.systemLock
      .upsert({ where: { name: LAST_PASS_LOCK }, create: { name: LAST_PASS_LOCK, lockedUntil: now }, update: { lockedUntil: now } })
      .catch(() => {});
    if (resume) {
      await prisma.systemLock.deleteMany({ where: { name: RESUME_LOCK } }).catch(() => {});
      await clearAlertState(PADDLE_REPLAY_BACKLOG_ALERT);
    }
  }
  return result;
}
