import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { outboxDeliveryPaused } from "@/lib/outbox/flag";
import { billingBlockedOrgIds, billingHeldSql } from "@/lib/outbox/billing-hold";

// ---------------------------------------------------------------------------
// KUYRUK SAĞLIĞI (yalnız operatör, sistem geneli; 10-16 kurucu: "görseldeki sistem tarzında bir sistemimiz var mı" — transactional outbox +
// yoklayıcı yayıncı). İki kalıcı kuyruk var: misafir mesajı kuyruğu (`MessageOutbox`, `DURABLE_OUTBOX_ENABLED`) ve kimlik e-postası kuyruğu
// (`EmailOutbox`, `EMAIL_OUTBOX_ENABLED`). Yoklayıcı durursa (senkron kilidi takılı, süreç ayakta değil) satırlar sessizce birikir — bu okuma
// birikmeyi GÖRÜNÜR yapar. Salt okuma; kimlik / metin / alıcı / sağlayıcı kimliği TAŞIMAZ (yalnız sayılar ve en eski bekleme süresi).
// ---------------------------------------------------------------------------

export interface QueueHealth {
  queue: "message" | "email";
  /** Durum başına satır sayısı (kapalı küme; kuyruğun kendi durumları). */
  byStatus: Record<string, number>;
  /** Vadesi gelmiş ama hâlâ `pending` duran en eski satırın bekleme süresi (ms); yoksa null. */
  oldestDueMs: number | null;
  /**
   * Son 24 saatte terminal başarısızlığa (`failed`) düşen satır sayısı. YAKLAŞIK: düşüş anı ayrı tutulmuyor, satırın son güncellenme zamanına
   * bakılır — konuşma birleştirme (`conversations-cleanup.ts` satırı yeni konuşmaya taşır) eski satırı da pencereye sokabilir (Haiku 10-16).
   */
  failed24h: number;
  /**
   * Son 24 saatte incelemeye (`review` — teslim doğrulanamadı) düşen satır sayısı; yalnız misafir mesajı kuyruğunda (e-posta kuyruğunda bu
   * durum yok → null). `review`dan otomatik çıkış yok (elle yeniden kuyruğa alma ya da KVKK / silme iptali) → toplam sayı birikir; dünkü
   * belirsiz gönderim üç ay önceki kayıtla aynı görünmesin diye pencereli ayrı sayaç (Haiku öneri turu 10-16). `failed24h` ile aynı yaklaşıklık.
   */
  review24h: number | null;
}

/** Bu süreden uzun bekleyen vadesi gelmiş satır = yoklayıcı geride / durmuş (ekranda uyarı). Yoklayıcı en geç 2 dk'da bir geçer. */
export const QUEUE_LAG_WARN_MS = 10 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

export async function queueHealth(now: Date = new Date()): Promise<QueueHealth[]> {
  const since = new Date(now.getTime() - DAY_MS);
  const [mGroups, mOldest, mFailed, mReview, eGroups, eOldest, eFailed] = await Promise.all([
    prisma.messageOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.messageOutbox.findFirst({
      where: { status: "pending", availableAt: { lte: now } },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    prisma.messageOutbox.count({ where: { status: "failed", updatedAt: { gte: since } } }),
    prisma.messageOutbox.count({ where: { status: "review", updatedAt: { gte: since } } }),
    prisma.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.emailOutbox.findFirst({
      where: { status: "pending", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.emailOutbox.count({ where: { status: "failed", updatedAt: { gte: since } } }),
  ]);
  const counts = (groups: readonly { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  const lag = (at: Date | null | undefined) => (at ? Math.max(0, now.getTime() - at.getTime()) : null);
  return [
    { queue: "message", byStatus: counts(mGroups), oldestDueMs: lag(mOldest?.availableAt), failed24h: mFailed, review24h: mReview },
    { queue: "email", byStatus: counts(eGroups), oldestDueMs: lag(eOldest?.nextAttemptAt), failed24h: eFailed, review24h: null },
  ];
}

// ---------------------------------------------------------------------------
// KUYRUK İLERLEMİYOR ALARMI (kurucu 10-16 O3: "uzun vadede A + B"). Panel bakılmazsa birikme fark edilmez. İki bağımsız sinyal:
//  · A — senkron geçişinin sonunda GEÇİŞ TABANLI alarm (`checkQueueStall`): kuyruk İLERLEMİYORSA e-posta + Sentry BİR KEZ, düzelince
//    temizlenir. Alarm e-postası `reportError` → doğrudan sağlayıcı (kimlik e-postası kuyruğundan GEÇMEZ) → bozuk kuyruğa bağlı değil.
//  · B — `/api/health?strict=1` aynı ölçütle 503 `queue_stalled` (ikinci izleyici için). Döngü ölürse A susar, B yine görür; döngü canlı
//    ama satır ilerlemiyorsa ikisi de görür. Normal `/api/health` (Railway hazır olma yoklaması) DEĞİŞMEZ → yeniden başlatma döngüsü yok.
// "İlerlemiyor" (Haiku 10-16 sahte alarm bulguları üzerine): (1) İŞÇİNİN ALABİLECEĞİ vadesi gelmiş satır 15 dk'dır bekliyor — genel otomatik
// mesaj anahtarı kapalıyken bilerek bekleyen otomatik şablonlar ve aynı konuşmada önceki satırın arkasında sıra bekleyen satır (konuşma
// sırası; önceki satır yeniden deneme beklemesinde olabilir) SAYILMAZ, işçinin talep sorgusuyla (`worker.ts` claimBatchLocked) BİREBİR aynı
// süzgeç (uzlaştırma bekleyen `ambiguous` dahil; Haiku 10-16 ikinci tur); VE (2) son 15 dk'da kuyrukta hiç
// ilerleme yok (sahiplenme / gönderim). Büyük birikim (her geçiş 20 satır) ilerlediği sürece alarm değildir.
// ---------------------------------------------------------------------------

/** Vadesi gelmiş satır bu kadar bekledi ve bu süredir ilerleme yok → kuyruk ilerlemiyor. Yoklayıcı en geç 2 dk'da bir geçer. */
export const QUEUE_STALL_MS = 15 * 60_000;

export class QueueStalledError extends Error {
  /** Hata SINIFI için (`errorClassOf` → "QueueStalled:message"); metin ve kimlik taşımaz. */
  readonly code: "message" | "email";
  constructor(queue: "message" | "email", lagMs: number, note = "") {
    super(
      `${queue === "message" ? "Misafir mesajı" : "Kimlik e-postası"} kuyruğu ilerlemiyor: gönderilebilir en eski satır ${Math.round(lagMs / 60_000)} ` +
        `dakikadır bekliyor ve son ${Math.round(QUEUE_STALL_MS / 60_000)} dakikada hiçbir satır gönderilmedi.${note}`,
    );
    this.name = "QueueStalled";
    this.code = queue;
  }
}

/** Bilerek duraklatma bildirimi (arıza değil) — hata sınıfı "QueuePaused:message". */
export class QueuePausedError extends Error {
  readonly code = "message";
  constructor() {
    super(
      "Misafir mesajı gönderimi duraklatıldı (OUTBOX_DELIVERY_PAUSED=1): kuyruktaki mesajlar bilerek gönderilmiyor, kaybolmuyor. " +
        "Anahtarı kaldırınca kaldığı yerden gider. Gönderimi başlamış mesaj geri alınmaz; sonucu belirsiz mesajlar yeniden gönderilmez, incelemeye alınır.",
    );
    this.name = "QueuePaused";
  }
}

export interface QueueStallState {
  /** İşçinin alabileceği vadesi gelmiş en eski satırın bekleme süresi (ms); yoksa null. */
  lagMs: number | null;
  /** Son `QUEUE_STALL_MS` içinde sahiplenme / gönderim oldu mu. */
  progressing: boolean;
  /** Bekleyen gönderimler BİLEREK duraklatılmışken (`OUTBOX_DELIVERY_PAUSED`) vadesi gelmiş gönderilecek satır var mı (yalnız mesaj kuyruğu). */
  pausedWaiting?: boolean;
}

/** İki kuyruğun durumu — misafir mesajında işçinin seçim kuralıyla (genel anahtar + konuşma sırası) aynı süzgeç. */
export async function queueStallStates(now: Date = new Date()): Promise<{ message: QueueStallState; email: QueueStallState }> {
  const since = new Date(now.getTime() - QUEUE_STALL_MS);
  const autoAllowed = process.env.AUTO_REPLY_ENABLED === "1";
  const paused = outboxDeliveryPaused();
  // Abonelik erişimi kapalı işletmenin bekletilen otomatik satırı "takılı" sayılmaz (işçinin talep süzgeciyle aynı kural, Haiku 10-16).
  const billingBlocked = await billingBlockedOrgIds();
  const [mRows, mProgress, eOldest, eProgress, mPaused] = await Promise.all([
    prisma.$queryRaw<{ at: Date | null }[]>(Prisma.sql`
      SELECT MIN(s."availableAt") AS at
      FROM "MessageOutbox" s
      WHERE s."status" IN ('pending', 'ambiguous')
        AND (NOT ${paused}::boolean OR s."status" = 'ambiguous')
        AND s."availableAt" <= ${now}
        AND (s."claimExpiresAt" IS NULL OR s."claimExpiresAt" <= ${now})
        AND (${autoAllowed}::boolean OR s."status" = 'ambiguous' OR s."messageType" IS NULL OR s."messageType" IN ('manual', 'ai', 'holding_ack'))
        AND NOT ${billingHeldSql("s", billingBlocked)}
        AND NOT EXISTS (
          SELECT 1 FROM "MessageOutbox" e
          WHERE e."conversationId" = s."conversationId"
            AND e."id" <> s."id"
            AND e."status" IN ('pending', 'sending', 'ambiguous', 'reconciling')
            AND NOT (NOT ${autoAllowed}::boolean AND e."status" = 'pending' AND e."messageType" IS NOT NULL AND e."messageType" <> 'manual')
            AND NOT ${billingHeldSql("e", billingBlocked)}
            AND (e."status" IN ('sending', 'reconciling') OR (e."createdAt", e."id") < (s."createdAt", s."id"))
        )`),
    prisma.messageOutbox.findFirst({
      where: { OR: [{ claimedAt: { gte: since } }, { sentAt: { gte: since } }] },
      select: { id: true },
    }),
    prisma.emailOutbox.findFirst({
      where: { status: "pending", nextAttemptAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.emailOutbox.findFirst({
      where: { OR: [{ sentAt: { gte: since } }, { status: { in: ["claimed", "failed"] }, updatedAt: { gte: since } }] },
      select: { id: true },
    }),
    paused
      ? prisma.messageOutbox.findFirst({ where: { status: "pending", availableAt: { lte: now } }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  const lag = (at: Date | null | undefined) => (at ? Math.max(0, now.getTime() - new Date(at).getTime()) : null);
  return {
    message: { lagMs: lag(mRows[0]?.at), progressing: mProgress !== null, pausedWaiting: mPaused !== null },
    email: { lagMs: lag(eOldest?.nextAttemptAt), progressing: eProgress !== null },
  };
}

export function isStalled(q: QueueStallState): boolean {
  return q.lagMs !== null && q.lagMs >= QUEUE_STALL_MS && !q.progressing;
}

/** A — senkron geçişinin sonunda. Okuma düşerse sessiz (senkron geçişini düşürmez; B yine görür). İki kuyruk AYRI başlıkla (e-posta
 *  kısıtı başlık başına — biri ötekinin alarmını geciktirmesin). */
export async function checkQueueStall(
  tracker: { fail(key: string, context: string, err: unknown): Promise<unknown>; ok(key: string): Promise<void> },
  now: Date = new Date(),
): Promise<void> {
  let states: { message: QueueStallState; email: QueueStallState };
  try {
    states = await queueStallStates(now);
  } catch {
    return;
  }
  for (const queue of ["message", "email"] as const) {
    const st = states[queue];
    // Bekleyen gönderimler BİLEREK duraklatıldıysa (`OUTBOX_DELIVERY_PAUSED`) bekleyen `pending` arıza değildir (talep süzgeci onu zaten
    // saymaz) → "ilerlemiyor" yerine bir kez (24 saatte bir hatırlatmalı) "duraklatıldı" bildirimi: anahtarın unutulması fark edilsin.
    // Uzlaştırma (`ambiguous`) duraklatmada da sürer → onun takılması yine "ilerlemiyor" alarmıdır.
    if (queue === "message") {
      if (st.pausedWaiting) {
        await tracker.fail(
          "queue-paused:message",
          "Misafir mesajı gönderimi DURAKLATILDI",
          new QueuePausedError(),
        );
      } else await tracker.ok("queue-paused:message");
    }
    if (isStalled(st)) {
      const note =
        queue === "email" && process.env.EMAIL_OUTBOX_ENABLED !== "1"
          ? " EMAIL_OUTBOX_ENABLED kapalı: bu kuyruk hiç gönderilmiyor (şifre sıfırlama / doğrulama e-postaları gitmez)."
          : "";
      await tracker.fail(
        `queue-stalled:${queue}`,
        queue === "message" ? "Kuyruk ilerlemiyor (misafir mesajı)" : "Kuyruk ilerlemiyor (kimlik e-postası)",
        new QueueStalledError(queue, st.lagMs ?? 0, note),
      );
    } else await tracker.ok(`queue-stalled:${queue}`);
  }
}

// B — `/api/health?strict=1` için. Kuyruk okuması herkese açık uçta: kısa süreli bellek içi sonuç → yoğun yoklama veritabanına yük
// bindirmez. Okunamazsa "unknown" (sayfalamaz — kuyruk okuma hatası ayrı bir arıza değildir; DB arızasını yoklama zaten görür).
const QUEUE_PROBE_TTL_MS = 30_000;
let queueProbe: { at: number; state: "ok" | "stalled" | "unknown" } | null = null;
// Süren yoklama PAYLAŞILIR (Codex 10-16, ölçüldü: önbellek boşken 100 eşzamanlı istek 400 veritabanı okuması başlatıyordu). Yoklama bitince
// (başarı ya da hata) boşalır → sonraki istek yeniden dener; hata sonucu da TTL boyunca önbellekte durur (bugünkü davranış).
let queueProbeInFlight: Promise<"ok" | "stalled" | "unknown"> | null = null;
/** Sıfırlama kuşağı: sıfırlamadan önce başlamış yoklamanın sonucu önbelleğe yazılmaz (yalnız test yardımcısı için, Haiku 10-16). */
let queueProbeGeneration = 0;

async function probeQueueState(now: number): Promise<"ok" | "stalled" | "unknown"> {
  const generation = queueProbeGeneration;
  let state: "ok" | "stalled" | "unknown";
  try {
    const st = await queueStallStates(new Date(now));
    // Bilerek duraklatılmış gönderim izleyiciyi sayfalamaz: talep süzgeci duraklatmada `pending` saymaz (uzlaştırma takılması yine sayfalar).
    state = isStalled(st.message) || isStalled(st.email) ? "stalled" : "ok";
  } catch {
    state = "unknown";
  }
  if (generation === queueProbeGeneration) queueProbe = { at: now, state };
  return state;
}

export async function strictQueueState(): Promise<"ok" | "stalled" | "unknown"> {
  const now = Date.now();
  if (queueProbe && now - queueProbe.at < QUEUE_PROBE_TTL_MS) return queueProbe.state;
  if (queueProbeInFlight) return queueProbeInFlight;
  const probe = probeQueueState(now).finally(() => {
    if (queueProbeInFlight === probe) queueProbeInFlight = null;
  });
  queueProbeInFlight = probe;
  return probe;
}

/** Test yardımcısı: kuyruk yoklamasının bellek içi sonucunu sıfırla. */
export function __resetStrictQueueState(): void {
  queueProbe = null;
  queueProbeInFlight = null;
  queueProbeGeneration += 1;
}
