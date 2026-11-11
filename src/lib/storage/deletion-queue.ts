import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { getStorageAdapter, type StorageAdapter } from "./adapter";
import { storageConfigured } from "./config";
import { isSafeObjectKey, keyFromPhotoUrl, orgIdFromKey, photoUrlForKey } from "./keys";

// ---------------------------------------------------------------------------
// Idempotent deletion queue for private object storage.
//
// CONTRACT: the DB operation that orphans an object (task delete, account
// erasure) writes its deletion INTENTS first/atomically and then proceeds — the
// provider is NEVER on the DB operation's critical path. A provider outage
// therefore cannot (a) block or roll back the DB delete, NOR (b) turn it into a
// silent object leak: the pending row persists, is retried with backoff by the
// scheduled drain, and stays visible until the object is truly gone.
//
// Idempotency, twice over: `objectKey @unique` + createMany(skipDuplicates)
// makes double-ENQUEUE a no-op, and the adapter treats deleting a missing
// object as success, so a re-DRAIN of an already-deleted key settles cleanly.
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// NESNENİN YAŞAM DÖNGÜSÜ TEK KİLİTTEN GEÇER (Codex 11-10 X1).
//
// Boşaltıcı "bu nesneyi gösteren görev kaydı var mı" diye BİR KEZ okuyup sonra siliyordu. Okumadan hemen sonra fotoğraf bir göreve
// bağlanırsa (yüklemeden uzun süre sonra kaydedilen form, eski bağlantıyı yeniden gönderen istemci) eski sonuçla silmeye devam ediyor,
// görev kaydı kovada OLMAYAN bir fotoğrafı gösteriyordu. "Silmeden hemen önce yeniden oku" aralığı daraltır ama kapatmaz.
//
// Kural: fotoğrafı göreve BAĞLAYAN yazım ile silmeyi SAHİPLENEN boşaltıcı, nesne anahtarı başına AYNI danışma kilidinden (işlem kapsamlı)
// geçer; sahiplenme kuyruk satırına yazılır (`deleting`):
//   · boşaltıcı kilit altında gösterimi YENİDEN okur → gösteriliyorsa kaydı iptal eder, gösterilmiyorsa satırı `deleting` yapar (commit),
//     SONRA sağlayıcıdan siler;
//   · bağlama kilit altında satıra bakar → `deleting` / `deleted` ise bağlamaz (fotoğraf yok ya da yok olmak üzere).
// Hangisi önce kilidi alırsa sonuç tutarlıdır: ya nesne kalır ve bağlanır, ya silinir ve bağlanamaz. Sağlayıcı çağrısı kilidin DIŞINDADIR
// (uzun veritabanı işlemi yok). Şema değişmedi: `status` uygulama tarafından yönetilen metindir (pending | deleting | deleted).
// ---------------------------------------------------------------------------
const STORAGE_OBJECT_LOCK_NS = 50;

/** Nesne anahtarı başına danışma kilidi (işlem bitince bırakılır). */
export async function lockStorageObject(tx: Prisma.TransactionClient, objectKey: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${STORAGE_OBJECT_LOCK_NS}::int4, hashtext(${objectKey}))`);
}

/** Hâlâ işlenecek kuyruk durumları: bekleyen + silmesi sahiplenilmiş (sağlayıcı silmesi henüz doğrulanmamış). */
const OPEN_STATUSES = ["pending", "deleting"];

/**
 * BAĞLAMA KAPISI — görev kaydına fotoğraf yazan işlemin İÇİNDE, yazımdan ÖNCE çağrılır. `false` → nesnenin silinmesi sahiplenilmiş ya da
 * tamamlanmış: bağlanmaz (çağıran isteği reddeder; kullanıcı fotoğrafı yeniden yükler). Depo dışı (eski `/uploads`) adresler bu kapının
 * konusu değildir → `true`.
 */
export async function photoStillAttachable(tx: Prisma.TransactionClient, photoUrl: string): Promise<boolean> {
  const key = keyFromPhotoUrl(photoUrl);
  if (!key) return true;
  await lockStorageObject(tx, key);
  const row = await tx.storageDeletion.findUnique({ where: { objectKey: key }, select: { status: true } });
  return !row || row.status === "pending";
}

const DRAIN_BATCH = 25;
const BACKOFF_BASE_MS = 5 * 60_000; // 5 min, doubling
const BACKOFF_CAP_MS = 6 * 60 * 60_000; // 6 h ceiling

function backoffMs(attemptCount: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

/** Status-code-only error string (never a provider body / credential). */
function errorCode(err: unknown): string {
  const m = err instanceof Error ? err.message.match(/HTTP \d{3}/) : null;
  return m ? m[0] : "provider_error";
}

/**
 * Record deletion intents for the given object keys. Accepts the transaction
 * client so the intent commits ATOMICALLY with the DB delete that orphans the
 * objects. Returns the number of NEW intents written.
 *
 * TENANT CHOKE POINT: a key is enqueued ONLY when it is well-shaped AND its org
 * segment equals `organizationId`. `photoUrl` is client-settable (the task PATCH
 * route stores it verbatim), so a poisoned value pointing at ANOTHER org's key
 * could otherwise reach here (via task DELETE / account erasure) and delete a
 * different tenant's object from the shared bucket. The org-segment check — the
 * same boundary the serve route enforces at read time — closes that at the one
 * place every deletion flows through. Unsafe/foreign keys are silently dropped;
 * duplicates are a clean no-op.
 */
export async function enqueueStorageDeletions(db: Db, organizationId: string, objectKeys: string[]): Promise<number> {
  const keys = Array.from(
    new Set(objectKeys.filter((k) => isSafeObjectKey(k) && orgIdFromKey(k) === organizationId)),
  );
  if (keys.length === 0) return 0;
  // 🚨 Vade kapısı TEK SAAT (CLAUDE.md, CI #1170/#1240 deseni): boşaltıcı `availableAt`i UYGULAMA saatiyle kıyaslar; şema
  // varsayılanı veritabanı saatidir (inceleme b1, 09-30). Aynı saatle yazılır.
  const availableAt = new Date();
  const res = await db.storageDeletion.createMany({
    data: keys.map((objectKey) => ({ objectKey, organizationId, availableAt })),
    skipDuplicates: true, // objectKey @unique → double-enqueue = dedupe-hit
  });
  // Gece-4 (Haiku, S7-01): aynı anahtarın BEKLEYEN kaydı (ör. 24 saat vadeli yükleme sahipsizlik kaydı) varsa silme niyeti yutulmasın — vade
  // şimdiye çekilir. Vade değişikliği aynı zamanda boşaltıcının "gösteriliyor → iptal" kararını geçersiz kılar (iptal vade karşılaştırmalı).
  if (res.count < keys.length) {
    await db.storageDeletion.updateMany({
      where: { objectKey: { in: keys }, organizationId, status: "pending", NOT: { availableAt } },
      data: { availableAt },
    });
  }
  return res.count;
}

/**
 * Silinen satırların gösterdiği fotoğraflardan YALNIZ artık bu org'da HİÇBİR görev güncellemesinin göstermediklerinin silme
 * niyetini yazar (inceleme b1, 09-30): bağlama kuralından önceki eski satırlar aynı nesneyi başka bir görevde de gösterebilir —
 * A mülkü silinince B'nin görevindeki fotoğraf kovadan gidiyordu. Silmeyle AYNI işlemde ve silmeden SONRA çağrılır (kalan
 * gösterenler o an kesinleşmiştir). Eski `/uploads` ve yabancı / bozuk anahtarlar `enqueueStorageDeletions` kapısında düşer.
 */
export async function enqueueUnreferencedPhotoDeletions(db: Db, organizationId: string, photoUrls: readonly (string | null)[]): Promise<number> {
  const urls = [...new Set(photoUrls.filter((u): u is string => keyFromPhotoUrl(u) !== null))];
  if (urls.length === 0) return 0;
  const still = await db.taskUpdate.findMany({
    where: { photoUrl: { in: urls }, task: { property: { organizationId } } },
    select: { photoUrl: true },
  });
  const shown = new Set(still.map((r) => r.photoUrl));
  const keys = urls.filter((u) => !shown.has(u)).map((u) => keyFromPhotoUrl(u) as string);
  return enqueueStorageDeletions(db, organizationId, keys);
}

/**
 * Gece-4 S7-01: yüklenen fotoğrafın ERTELİ sahipsizlik kaydı. Yükleme (POST /api/upload) nesneyi kovaya yazar; nesneyi gösteren satır ancak
 * istemci ardından görevi güncelleyince doğar — o istek hiç gelmezse (bağlantı koptu, ekran kapandı) nesneyi hiçbir satır göstermez ve
 * görev / mülk / hesap silmeleri onu bulamaz (adaptörde listeleme yok) → kovada süresiz (fotoğrafta misafir / daire içi görüntü olabilir).
 * Yüklemeden ÖNCE bu kuyruğa `delayMs` sonra vadeli bir kayıt yazılır; boşaltıcı vadesinde nesne KENDİ işletmesinin bir görev güncellemesince
 * gösteriliyorsa kaydı iptal eder (nesne kalır, görev silinince normal yoldan gider), gösterilmiyorsa siler.
 */
export const UPLOAD_ORPHAN_CHECK_DELAY_MS = 24 * 60 * 60_000;
export async function enqueueUploadOrphanCheck(
  db: Db,
  organizationId: string,
  objectKey: string,
  delayMs: number = UPLOAD_ORPHAN_CHECK_DELAY_MS,
): Promise<number> {
  if (!isSafeObjectKey(objectKey) || orgIdFromKey(objectKey) !== organizationId) return 0;
  const res = await db.storageDeletion.createMany({
    data: [{ objectKey, organizationId, availableAt: new Date(Date.now() + delayMs) }],
    skipDuplicates: true,
  });
  return res.count;
}

/** Cheap indexed check — lets the scheduler skip the drain entirely when idle. */
export async function hasPendingStorageDeletions(): Promise<boolean> {
  const n = await prisma.storageDeletion.count({ where: { status: { in: OPEN_STATUSES } } });
  return n > 0;
}

export interface StorageDrainResult {
  /** True when no adapter is configured — rows stay pending and WAIT (documented). */
  skipped: boolean;
  deleted: number;
  failed: number;
}

/**
 * Drain due pending deletions: one provider DELETE per row. On success the row
 * is marked `deleted` (kept as an audit/idempotency anchor); on provider error
 * it stays `pending` with attemptCount+1 and a bounded backoff — NEVER marked
 * done on a failure (no fake success). Unconfigured storage ⇒ skip quietly
 * (rows wait for the env to come back; a flag-off rollback keeps draining as
 * long as the credentials remain). Never throws.
 */
/**
 * Parti başına duvar saati bütçesi (15 ajan A11): silme kuyruğu genel senkron geçişinin içinde koşar; sağlayıcı yavaşlarsa parti
 * bütçeyi aşınca KALAN satırlar dokunulmadan bir sonraki geçişe kalır (başarısız SAYILMAZ, deneme sayısı artmaz).
 */
export const DRAIN_BUDGET_MS = 45_000;

/** Test kancası (yarış testi): gösterim okunduktan SONRA, iptal / sahiplenme kararından ÖNCE (kilit altında). Üretimde null. */
export const __storageDrainHooks: { afterShownRead: null | (() => Promise<void>) } = { afterShownRead: null };

type DueRow = { id: string; objectKey: string; attemptCount: number; availableAt: Date; status: string };

/**
 * Silmeyi SAHİPLEN (kilit altında): `claimed` → çağıran sağlayıcıdan siler · `attached` → nesne gösteriliyor, kayıt iptal edildi (ya da
 * araya giren silme niyeti yüzünden bir sonraki geçişe bırakıldı) · `gone` → satır artık işlenecek durumda değil.
 */
async function claimDeletion(row: DueRow): Promise<"claimed" | "attached" | "gone"> {
  return prisma.$transaction(async (tx) => {
    await lockStorageObject(tx, row.objectKey);
    const cur = await tx.storageDeletion.findUnique({ where: { id: row.id }, select: { status: true } });
    if (!cur) return "gone";
    // Önceki geçişte sahiplenilmiş, sağlayıcı silmesi başarısız kalmış: bağlama zaten kapalı — gösterim yeniden okunmaz.
    if (cur.status === "deleting") return "claimed";
    if (cur.status !== "pending") return "gone";
    // S7-01: nesne hâlâ KENDİ işletmesinin bir görev güncellemesince gösteriliyorsa silinmez — kayıt iptal edilir (yükleme kaydı göreve
    // bağlandı; normal silme niyetleri zaten gösterilmeyen nesneler için yazılır). İşletme kapsamı şart: başka kiracının satırı (istemcinin
    // yazabildiği `photoUrl`) silinmiş bir işletmenin fotoğrafını kovada TUTAMAZ.
    const organizationId = orgIdFromKey(row.objectKey);
    const shown = organizationId
      ? await tx.taskUpdate.findFirst({
          where: { photoUrl: photoUrlForKey(row.objectKey), task: { property: { organizationId } } },
          select: { id: true },
        })
      : null;
    if (__storageDrainHooks.afterShownRead) await __storageDrainHooks.afterShownRead();
    if (shown) {
      // Karşılaştır-ve-sil (Haiku gece-4): gösterim okunduktan SONRA görev silinip aynı anahtarın silme niyeti yazıldıysa (vade şimdiye
      // çekildi ↑) iptal etmez — niyet yutulup nesne süresiz kalmasın; sonraki geçiş siler. (Görev silme bu kilidi almaz.)
      await tx.storageDeletion.deleteMany({ where: { id: row.id, status: "pending", availableAt: row.availableAt } });
      return "attached";
    }
    const claimed = await tx.storageDeletion.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "deleting" } });
    return claimed.count === 1 ? "claimed" : "gone";
  });
}

export async function drainStorageDeletions(
  deps: { adapter?: StorageAdapter | null; now?: () => Date; batchSize?: number; budgetMs?: number; clock?: () => number } = {},
): Promise<StorageDrainResult> {
  const adapter = deps.adapter !== undefined ? deps.adapter : storageConfigured() ? getStorageAdapter() : null;
  if (!adapter) return { skipped: true, deleted: 0, failed: 0 };
  const now = deps.now ?? (() => new Date());

  const due: DueRow[] = await prisma.storageDeletion.findMany({
    where: { status: { in: OPEN_STATUSES }, availableAt: { lte: now() } },
    orderBy: { availableAt: "asc" },
    take: deps.batchSize ?? DRAIN_BATCH,
    select: { id: true, objectKey: true, attemptCount: true, availableAt: true, status: true },
  });

  let deleted = 0;
  let failed = 0;
  const clock = deps.clock ?? (() => Date.now());
  const startedAt = clock();
  const budget = deps.budgetMs ?? DRAIN_BUDGET_MS;
  for (const row of due) {
    if (clock() - startedAt >= budget) break;
    // SAHİPLENME (↑ başlık): gösterim kilit altında yeniden okunur; sahiplenilmeyen nesne silinmez. Sahiplenme yazılamazsa (veritabanı
    // arızası) satıra dokunulmaz — sonraki geçiş yeniden dener; "asla fırlatmaz" sözleşmesi korunur.
    let claim: "claimed" | "attached" | "gone";
    try {
      claim = await claimDeletion(row);
    } catch (e) {
      void reportError("storage-deletion-claim", e);
      continue;
    }
    if (claim !== "claimed") continue;
    try {
      await adapter.delete(row.objectKey);
      // Başarı yazması da fırlatmamalı: JSDoc "Never throws" diyor ve tek çağıran
      // (`scheduled-sync`) bunu try/catch'e sarsa bile parti yarıda kesilirdi.
      // Yazma düşerse obje SİLİNMİŞ ama satır açık kalır → sonraki geçiş aynı
      // anahtarı yeniden siler (adapter eksik objeyi başarı sayar = zararsız).
      await prisma.storageDeletion
        .updateMany({
          where: { id: row.id, status: { in: OPEN_STATUSES } },
          data: { status: "deleted", deletedAt: now(), lastError: null },
        })
        .catch((e) => void reportError("storage-deletion-complete-write", e));
      deleted++;
    } catch (err) {
      failed++;
      // Satır `deleting` KALIR (sahiplenme geri alınmaz): sağlayıcı hatası belirsizdir — nesne silinmiş olabilir. Bağlama kapalı kalır,
      // silme geri çekilmeyle yeniden denenir. Asla `deleted` yazılmaz (sahte başarı yok).
      await prisma.storageDeletion
        .updateMany({
          where: { id: row.id, status: { in: OPEN_STATUSES } },
          data: {
            attemptCount: { increment: 1 },
            availableAt: new Date(now().getTime() + backoffMs(row.attemptCount + 1)),
            lastError: errorCode(err), // status code only — never a body/secret
          },
        })
        // ⚠️ SESSİZ DEĞİL (denetim, 08-01 — dördüncü tur, ajan bulgusu). Bu yazma
        // düşerse `attemptCount` ARTMAZ ve `availableAt` GEÇMİŞTE kalır → aynı
        // satırlar her geçişte (2 dk) yeniden denenir ve backoff HİÇ BÜYÜMEZ:
        // 30 geçiş/saat × parti başına 25 satır = saatte 750 sağlayıcı DELETE.
        // Aşağıdaki toplu alarm "silme başarısız" der ama "backoff da yazılamadı"
        // demez — ikisi farklı arızalar ve ikincisi sınırsız tekrar üretir.
        .catch((e) => void reportError("storage-deletion-backoff-write", e));
    }
  }
  // Başarısız satır sayısı ÇAĞIRANA döner; alarm geçiş tabanlıdır (`scheduled-sync` `opsAlarm.fail("storage-deletions")`): eskiden
  // her başarısız geçişte doğrudan `reportError` → kalıcı sağlayıcı arızasında günde ~144 e-posta (15 ajan A11; CLAUDE.md periyodik
  // alarm kuralı).
  return { skipped: false, deleted, failed };
}
