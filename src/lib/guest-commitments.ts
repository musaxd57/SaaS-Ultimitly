import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { commitmentLabel, commitmentTopicsCompatible, isCommitmentTopic, type CommitmentKind, type CommitmentTopic } from "@/lib/guest-commitments-core";

// ---------------------------------------------------------------------------
// AÇIK TAAHHÜT HAFIZASI A (kurucu kararı 10-10; migration 62; tasarım `docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md`).
//
// Misafire verilen söz ("havlular 18:00'e kadar") YALNIZ ev sahibinin AÇIK işaretinden doğar — yapay zekâ / metin yorumu YOK. METİN
// SAKLANMAZ: tür kapalı küme + son an. Söz oluşurken bir GÖREV açılır (aynı işlemde); görev `done` olunca söz kapanır, görev geri
// açılırsa söz de açılır, görev silinirse söz iptal olur. Açık söz "Dikkat Gerektirenler"de kalan / geçen süreyle görünür.
// Yapay zekâ cevabına girdi olarak verilmesi AYRI karar (müşteriye giden metni etkiler) — bu modül istem kurmaz.
// ---------------------------------------------------------------------------

export {
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUSES,
  commitmentDueAt,
  isCommitmentKind,
  isCommitmentTopic,
  type CommitmentKind,
  type CommitmentStatus,
} from "@/lib/guest-commitments-core";

/** Sözün açtığı görevin türü (`TASK_TYPE` kapalı kümesinden). */
const TASK_TYPE_FOR: Record<CommitmentKind, string> = {
  towels: "laundry",
  supplies: "restock",
  cleaning: "cleaning",
  maintenance: "maintenance",
};

type Tx = Prisma.TransactionClient | PrismaClient;

/** Söz ekleme kilidi ad alanı (diğerleri: 23 · 40–45). Konuşma başına. */
const COMMITMENT_LOCK_NS = 46;

/** Yalnız testler: kilitli bölgede "aynı söz var mı?" okumasından SONRA bekleme noktası (Opus 10-15 B8). */
export const __commitmentHooks: { afterSameCheck: null | (() => Promise<void>) } = { afterSameCheck: null };

/** Aynı istek kimliği FARKLI içerikle (tür / saat) geldi — eski kayıt sessizce dönmez (kurucu D3, 10-15). Rota 409'a çevirir. */
export class CommitmentRequestConflictError extends Error {
  constructor(readonly reason: "different_content" | "task_deleted" = "different_content") {
    super("commitment_request_conflict");
  }
}

/** Ekranda gösterilen uyuşmazlık metni (bilgi tabanı formuyla aynı kalıp). */
export const COMMITMENT_CONFLICT_MESSAGE = "Bu söz az önce farklı bilgilerle kaydedildi. Sayfayı yenileyip kontrol edin.";
/** Aynı işlemin sözü kaydedilmiş ama görevi sonradan silinmiş (Opus O11: "farklı bilgilerle" demek yanlıştı). */
export const COMMITMENT_TASK_DELETED_MESSAGE = "Bu söz daha önce kaydedildi, görevi ise silinmiş. Sayfayı yenileyip yeniden kaydedin.";

/**
 * Aynı işlemin yeniden denemesi mi? Tür + an BİREBİR. 24 saat farkı "gece yarısını geçen yeniden deneme" sayan esneklik (Opus O11) GERİ
 * ALINDI (Haiku 10-15): cevabı kaybolan "bugün 18:00" formu "yarın 18:00" yapılıp aynı kimlikle gönderilirse de fark tam 24 saattir —
 * yarınki söz hiç açılmadan eski söz "kaydedildi" diye dönüyordu (sessiz yanlış). Gece yarısı yeniden denemesi seyrek ve sonucu açık bir
 * uyuşmazlık iletisidir (sayfa yenilenince söz görünür) — sessiz yanlıştan iyidir.
 */
function sameCommitmentRequest(a: { kind: string; dueAt: Date }, b: { kind: string; dueAt: Date }): boolean {
  return a.kind === b.kind && a.dueAt.getTime() === b.dueAt.getTime();
}

/**
 * Söz + görev TEK işlemde. Konuşmanın dairesi yoksa söz verilemez (görev bir daireye bağlıdır). Görev kökeni `manual` (ev sahibinin
 * işi — rezervasyon iptalinde otomatik silinmez).
 *
 * TEKRAR GÜVENLİĞİ — İSTEK KİMLİĞİ (kurucu D3, 10-15, aynen: "Her yeni söz ayrı işlem kimliği alsın; çift tık ve bağlantı sonrası yeniden
 * deneme aynı kimliği korusun. Aynı kimlikle farklı içerik gelirse sessizce birleştirme, açık uyuşmazlık döndür. Kontrol sunucuda ve
 * veritabanında eşzamanlı isteklere dayanıklı olsun; görev oluşturma da tekrar güvenli olsun. Klima ve musluk aynı saatte iki ayrı
 * söz/görev oluşturmalı; aynı sözün tekrarı oluşturmamalı."). Eski "aynı tür + aynı saat = aynı söz" anlam birleştirmesi KALDIRILDI
 * (klima 18:00 ile musluk 18:00'i birleştirip ikinciyi kaybediyordu). Kontrol konuşma kilidi altında + `(conversationId,
 * clientRequestId)` tekil dizini (migration 68) son savunma; söz ve görev aynı işlemde → görev de tekrar güvenli.
 */
export async function createGuestCommitment(input: {
  organizationId: string;
  conversationId: string;
  propertyId: string;
  reservationId: string | null;
  kind: CommitmentKind;
  /** Sözün konusu (I1, migration 73) — YALNIZ öneri onayı verir (ev sahibinin mesajından, kodla); elle form vermez (NULL). */
  topic?: CommitmentTopic | null;
  dueAt: Date;
  actorUserId: string;
  /** İstemcinin işlem kimliği (yoksa her çağrı yeni söz). */
  clientRequestId?: string | null;
  /**
   * Aynı tür + aynı an + açık söz varsa onu döndür (eski anlam birleştirmesi). YALNIZ öneri onayı (`ai-suggestions/act.ts`): öneri,
   * ev sahibinin mesajındaki TEK bir sözdür; ev sahibi aynı sözü bu arada elle kaydettiyse onay ikinci söz açmasın (öneri listesi de
   * aynı kuralla gizler). Elle form bunu KULLANMAZ — klima 18:00 ile musluk 18:00 iki ayrı söz (kurucu D3).
   */
  mergeSameSlot?: boolean;
}, outerTx?: Prisma.TransactionClient): Promise<{
  id: string;
  taskId: string;
  reused: boolean;
  /** `reused` ise neden: aynı işlem kimliğinin tekrarı ("request") ya da aynı tür + an + uyumlu konudaki açık söze bağlandı ("slot"). */
  via?: "request" | "slot";
}> {
  // Dış işlem verilirse (yapay zekâ önerisinin onayı — karar kaydıyla AYNI işlem) onun içinde; yoksa bugünkü gibi kendi işlemi.
  const run = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => (outerTx ? fn(outerTx) : prisma.$transaction(fn));
  const topic = isCommitmentTopic(input.topic) ? input.topic : null;
  return run(async (tx) => {
    // Konuşma kilidi: aynı kimlikli eş zamanlı istekler sıraya girer; ikincisi birincinin yazdığını görür (↑ başlık).
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${COMMITMENT_LOCK_NS}::int4, hashtext(${input.conversationId}))`);
    const requestId = input.clientRequestId ?? null;
    if (requestId) {
      const same = await tx.guestCommitment.findFirst({
        where: { organizationId: input.organizationId, conversationId: input.conversationId, clientRequestId: requestId },
        select: { id: true, taskId: true, kind: true, dueAt: true },
      });
      if (same) {
        if (!sameCommitmentRequest(same, input)) throw new CommitmentRequestConflictError("different_content");
        if (same.taskId) return { id: same.id, taskId: same.taskId, reused: true, via: "request" };
        // Aynı istek, ama görevi arada silinmiş (söz bu yüzden iptal edildi): yeni söz AÇILMAZ (aynı kimlik tekil) — ayrı metinle söylenir.
        throw new CommitmentRequestConflictError("task_deleted");
      }
    }
    if (!requestId || input.mergeSameSlot) {
      // KİMLİKSİZ istek (yayın anında açık kalmış eski sekme — Opus O12): eski anlam birleştirmesi korunur (aynı tür + aynı an + açık söz →
      // o söz). Yeni istemci her zaman kimlik gönderir; bu dal yalnız geçiş dönemi içindir.
      // I1 (10-17): konu UYUMLU olmalı (`commitmentSlotMatches` ile aynı kural — öneri listesi de bunu kullanır): aynı konu ya da biri
      // konusuz. Aday sırası: önce konusu EŞİT olan, sonra konusuz; eşitlikte en eski (aynı zaman damgası → kimlik).
      const candidates = await tx.guestCommitment.findMany({
        where: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          kind: input.kind,
          dueAt: input.dueAt,
          status: "open",
          taskId: { not: null },
        },
        select: { id: true, taskId: true, topic: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const compatible = candidates.filter((c) => commitmentTopicsCompatible(c.topic, topic));
      const same = compatible.find((c) => topic !== null && c.topic === topic) ?? compatible[0];
      if (same?.taskId) return { id: same.id, taskId: same.taskId, reused: true, via: "slot" };
    }
    if (__commitmentHooks.afterSameCheck) await __commitmentHooks.afterSameCheck();
    const task = await tx.task.create({
      data: {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        type: TASK_TYPE_FOR[input.kind],
        origin: "manual",
        title: `Misafire söz: ${commitmentLabel(input.kind, topic)}`,
        dueAt: input.dueAt,
        status: "todo",
        priority: "standard",
      },
      select: { id: true },
    });
    const commitment = await tx.guestCommitment.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: task.id,
        kind: input.kind,
        topic,
        dueAt: input.dueAt,
        clientRequestId: requestId,
      },
      select: { id: true },
    });
    await writeAuditInTx(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "commitment.created",
      metadata: { commitmentId: commitment.id, taskId: task.id, kind: input.kind, ...(topic ? { topic } : {}) },
    });
    return { id: commitment.id, taskId: task.id, reused: false };
  });
}

/**
 * Görevin durumu değişti (görev güncelleme işleminin İÇİNDE çağrılır — aynı işlem): `done`a geçti → bağlı açık sözler kapanır;
 * `done`dan çıktı → bu görevin kapattığı sözler yeniden açılır (iptal edilmiş söz açılmaz).
 */
export async function syncCommitmentsForTaskStatus(
  tx: Tx,
  scope: { organizationId: string; taskId: string },
  from: string,
  to: string,
  now: Date,
): Promise<void> {
  const { organizationId, taskId } = scope;
  if (from !== "done" && to === "done") {
    await tx.guestCommitment.updateMany({ where: { organizationId, taskId, status: "open" }, data: { status: "done", closedAt: now } });
  } else if (from === "done" && to !== "done") {
    await tx.guestCommitment.updateMany({ where: { organizationId, taskId, status: "done" }, data: { status: "open", closedAt: null } });
  }
}

/**
 * Görevin son tarihi değişti (aynı işlemde): bağlı AÇIK söz yeni saati izler (Haiku: görev saati değişince söz eski saatte kalıyor,
 * Dikkat satırı yanlış gecikme gösteriyordu). Durum gibi saatin de tek kaynağı görevdir — ev sahibi işi yeniden planladıysa sözü de
 * yeniden planlamıştır. Görev saati kaldırılırsa (boş) söz saati korunur.
 */
export async function syncCommitmentsForTaskDueAt(tx: Tx, scope: { organizationId: string; taskId: string }, dueAt: Date): Promise<void> {
  await tx.guestCommitment.updateMany({ where: { ...scope, status: "open" }, data: { dueAt } });
}

/**
 * SAKLAMA (KVKK, Haiku denetimi B3 10-10): son anı YA DA oluşturulma anı saklama sınırından (`DATA_RETENTION_MONTHS`) eski sözler silinir
 * — durumdan bağımsız (iki yıllık "açık" söz anlamsızdır). Oluşturulma anı da sayılır (10-10 gece, Haiku incelemesi): görev tarihi ileri
 * taşınınca söz de taşınır (`syncCommitmentsForTaskDueAt`) ve yalnız son ana bakan kural kaydı saklama süresinin ötesinde tutardı.
 * Kendi saatlik işi (`scheduled-sync` commitment-retention) — konuşma öğesi süpürgesinin arızası bunu durdurmaz.
 */
export async function purgeExpiredGuestCommitments(cutoff: Date): Promise<{ deleted: number }> {
  const r = await prisma.guestCommitment.deleteMany({ where: { OR: [{ dueAt: { lt: cutoff } }, { createdAt: { lt: cutoff } }] } });
  return { deleted: r.count };
}

/** Görev silinmeden ÖNCE (aynı işlemde): bağlı açık söz iptal olur (görevsiz açık söz "kimsenin işi değil" olarak kalmasın). */
export async function cancelCommitmentsForDeletedTask(tx: Tx, scope: { organizationId: string; taskId: string }, now: Date): Promise<void> {
  await tx.guestCommitment.updateMany({ where: { ...scope, status: "open" }, data: { status: "cancelled", closedAt: now } });
}
