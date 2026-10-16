import "server-only";
import { prisma } from "@/lib/db";

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
//  · A — senkron geçişinin sonunda GEÇİŞ TABANLI alarm (`checkQueueStall`): vadesi gelmiş satır 15 dk bekliyorsa e-posta + Sentry BİR KEZ,
//    düzelince temizlenir. Alarm e-postası `reportError` → doğrudan sağlayıcı (kimlik e-postası kuyruğundan GEÇMEZ) → bozuk kuyruğa bağlı değil.
//  · B — `/api/health?strict=1` aynı ölçütle 503 `queue_stalled` (ikinci izleyici için). Döngü ölürse A susar, B yine görür; döngü canlı
//    ama satır ilerlemiyorsa ikisi de görür. Normal `/api/health` (Railway hazır olma yoklaması) DEĞİŞMEZ → yeniden başlatma döngüsü yok.
// ---------------------------------------------------------------------------

/** Vadesi gelmiş satır bu kadar bekledi → kuyruk ilerlemiyor. Yoklayıcı en geç 2 dk'da bir geçer; 15 dk = yedi geçiş kaçtı. */
export const QUEUE_STALL_MS = 15 * 60_000;

export class QueueStalledError extends Error {
  /** Hata SINIFI için (`errorClassOf` → "QueueStalled:message"); metin ve kimlik taşımaz. */
  readonly code: "message" | "email";
  constructor(queue: "message" | "email", lagMs: number) {
    super(`${queue === "message" ? "Misafir mesajı" : "Kimlik e-postası"} kuyruğu ilerlemiyor: vadesi gelmiş en eski satır ${Math.round(lagMs / 60_000)} dakikadır bekliyor.`);
    this.name = "QueueStalled";
    this.code = queue;
  }
}

/** İki kuyruğun vadesi gelmiş en eski `pending` satırının bekleme süresi (ms; satır yoksa null). İki dizinli okuma. */
export async function oldestDueLagMs(now: Date = new Date()): Promise<{ message: number | null; email: number | null }> {
  const [m, e] = await Promise.all([
    prisma.messageOutbox.findFirst({
      where: { status: "pending", availableAt: { lte: now } },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    prisma.emailOutbox.findFirst({
      where: { status: "pending", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
  ]);
  const lag = (at: Date | null | undefined) => (at ? Math.max(0, now.getTime() - at.getTime()) : null);
  return { message: lag(m?.availableAt), email: lag(e?.nextAttemptAt) };
}

/** A — senkron geçişinin sonunda. Okuma düşerse sessiz (senkron geçişini düşürmez; B yine görür). */
export async function checkQueueStall(
  tracker: { fail(key: string, context: string, err: unknown): Promise<unknown>; ok(key: string): Promise<void> },
  now: Date = new Date(),
): Promise<void> {
  let lags: { message: number | null; email: number | null };
  try {
    lags = await oldestDueLagMs(now);
  } catch {
    return;
  }
  for (const queue of ["message", "email"] as const) {
    const lag = lags[queue];
    if (lag !== null && lag >= QUEUE_STALL_MS) await tracker.fail(`queue-stalled:${queue}`, "Kuyruk ilerlemiyor", new QueueStalledError(queue, lag));
    else await tracker.ok(`queue-stalled:${queue}`);
  }
}

// B — `/api/health?strict=1` için. Kuyruk okuması (iki dizinli sorgu) herkese açık uçta: kısa süreli bellek içi sonuç → yoğun yoklama
// veritabanına yük bindirmez. Okunamazsa "unknown" (sayfalamaz — kuyruk okuma hatası ayrı bir arıza değildir; DB arızasını yoklama zaten görür).
const QUEUE_PROBE_TTL_MS = 30_000;
let queueProbe: { at: number; state: "ok" | "stalled" | "unknown" } | null = null;

export async function strictQueueState(): Promise<"ok" | "stalled" | "unknown"> {
  const now = Date.now();
  if (queueProbe && now - queueProbe.at < QUEUE_PROBE_TTL_MS) return queueProbe.state;
  let state: "ok" | "stalled" | "unknown";
  try {
    const lags = await oldestDueLagMs(new Date(now));
    state = [lags.message, lags.email].some((l) => l !== null && l >= QUEUE_STALL_MS) ? "stalled" : "ok";
  } catch {
    state = "unknown";
  }
  queueProbe = { at: now, state };
  return state;
}

/** Test yardımcısı: kuyruk yoklamasının bellek içi sonucunu sıfırla. */
export function __resetStrictQueueState(): void {
  queueProbe = null;
}
