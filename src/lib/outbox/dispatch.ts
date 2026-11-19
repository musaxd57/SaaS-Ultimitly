import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// KUYRUKTA "HAZIRLANIYOR / DIŞ GÖNDERİM BAŞLADI" AYRIMI VE ATOMİK İPTAL (kurucu 11-18 akşam: "`cancelRequestedAt` tek başına yarışı
// kapatmaz — iptal ile gönderim başlangıcı aynı satırda atomik karar vermeli"; tasarım
// `docs/TASARIM-2026-11-18-kuyrukta-atomik-iptal-ve-gonderim.md`; kolonlar migration 98).
//
// `sending` durumu iki ayrı şeyi taşıyordu: işçi satırı aldı ve gönderim öncesi kontrolleri koşuyor (sağlayıcıya henüz hiçbir şey gitmedi)
// ↔ istek sağlayıcıya çıktı. Dışarıdan iptal isteyen bunları ayırt edemiyordu. Kural: İKİ KOŞULLU YAZIM, AYNI SATIR —
//   · işçi, isteği atmadan HEMEN önce:  dispatchStartedAt = şimdi   ⇐ yalnız `cancelRequestedAt` BOŞSA
//   · iptal isteyen:                     cancelRequestedAt = şimdi   ⇐ yalnız `dispatchStartedAt` BOŞSA
// Veritabanının satır kilidi ikisini sıraya sokar; ikisi birden başarılı OLAMAZ. Kim kazanırsa öteki bunu yazımının sonucundan (0 satır)
// öğrenir: işçi isteği ATMAZ, ya da iptal isteyen "gönderim başladı" cevabını alır ve mesajı "iptal edildi" sayamaz.
// ---------------------------------------------------------------------------

/**
 * Bu sürümün talep belirteci öneki. Gönderim başlangıcı işaretini YAZAN bir işçinin aldığı satır belirtecinden tanınır: talep süresi dolan
 * satırda "işaret yok = istek atılmadı" hükmü yalnız bu önekli talebe verilir. Öneksiz talep işareti hiç yazmayan eski sürümündür — onun
 * satırında işaretin yokluğu hiçbir şey kanıtlamaz (istek atılmış olabilir) ve satır eskisi gibi "belirsiz"e gider.
 */
export const DISPATCH_AWARE_TOKEN_PREFIX = "d1:";

/** İptal sebebi kısa bir KODDUR (serbest metin yazılmaz — kolon misafir verisi kapsamı dışında tutulur). */
const CANCEL_REASON = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Misafir verisi silindiği için iptal (silme talebi / saklama süresi). İşçi bu sebeple iptal ederken kapanmış öğeleri yeniden AÇMAZ
 * (`worker.ts cancelRow`): silinen misafirin öğeleri zaten temizlenmiştir.
 */
export const OUTBOX_ERASED_REASON = "erased";

/** Dışarıdan doğrudan iptal edilebilen, henüz hiçbir işçinin almadığı durumlar. */
const UNCLAIMED_CANCELABLE = ["pending", "blocked"] as const;

export type DispatchStart =
  /** İşaret yazıldı: istek atılabilir. */
  | { kind: "started" }
  /** Bu satır için iptal istenmiş: istek ATILMAZ, satır iptal edilir. */
  | { kind: "cancel_requested"; reason: string | null }
  /** Talep artık bu işçide değil (süresi doldu / başka işçi aldı): hiçbir şey yapılmaz. */
  | { kind: "lost" };

/**
 * İşçi, sağlayıcıya istek atmadan HEMEN önce çağırır. `started` dönmedikçe istek ATILMAZ.
 * Tek koşullu yazım: satır hâlâ bu talepte, `sending` ve iptal istenmemiş.
 */
export async function markDispatchStarted(input: { id: string; token: string; now: Date }): Promise<DispatchStart> {
  const upd = await prisma.messageOutbox.updateMany({
    where: { id: input.id, claimedBy: input.token, status: "sending", cancelRequestedAt: null },
    data: { dispatchStartedAt: input.now },
  });
  if (upd.count === 1) return { kind: "started" };
  const row = await prisma.messageOutbox.findFirst({
    where: { id: input.id, claimedBy: input.token, status: "sending" },
    select: { cancelRequestedAt: true, cancelReason: true },
  });
  if (row?.cancelRequestedAt) return { kind: "cancel_requested", reason: row.cancelReason };
  return { kind: "lost" };
}

/**
 * "İptal iste" yazımının kendisi (tek kural): kapsamdaki, gönderimi henüz BAŞLAMAMIŞ her satıra (bekleyen · engelli · işçinin hazırlığındaki)
 * iptal isteği yazar. Çağıranın KENDİ işlemine girebilsin diye yalnız yazımın argümanlarını döndürür — silme yolları (konuşma / daire silme,
 * misafir silme talebi, saklama süpürgesi) bunu kendi işlemlerinin içinde, var olan "bekleyeni iptal et" yazımından ÖNCE koşar: işçinin
 * elindeki satır o yazımdan kaçar (talebi ezilmez), ama isteği taşıdığı için gönderim başlangıcında reddedilir. Saf.
 *
 * Kapsam çağıranındır (kiracı kapsamını o taşır); sebep kısa bir koddur.
 */
export function cancelRequestWrite(scope: Prisma.MessageOutboxWhereInput, reason: string, now: Date): Prisma.MessageOutboxUpdateManyArgs {
  if (!CANCEL_REASON.test(reason)) throw new Error("outbox cancel reason must be a short code");
  return {
    where: {
      AND: [
        scope,
        { cancelRequestedAt: null },
        { OR: [{ status: { in: [...UNCLAIMED_CANCELABLE] } }, { status: "sending", dispatchStartedAt: null }] },
      ],
    },
    data: { cancelRequestedAt: now, cancelReason: reason },
  };
}

export interface OutboxCancelResult {
  /** Hemen iptal edilen satır (hiçbir işçi almamıştı). */
  canceled: number;
  /** İşçinin elinde ama isteği henüz atılmamış satır: iptal İSTENDİ — işçi isteği atmayacak ve satırı iptal edecek. */
  requested: number;
  /** İsteği sağlayıcıya ÇIKMIŞ satır: iptal edilemez; sonucu gönderimin kendisi belirler. */
  dispatching: number;
}

/**
 * Kapsamdaki kuyruk satırları için iptal iste. Çağıran `dispatching > 0` ise bunu "iptal edildi" diye sunamaz.
 *
 * Sıra bilinçli: ÖNCE tek yazımla, henüz gönderimi başlamamış HER satıra (bekleyen + işçinin hazırlığındaki) iptal isteği yazılır. İki ayrı
 * yazım ("bekleyeni iptal et" + "hazırlananı işaretle") arasında durum değiştiren satır (işçi tam o an aldı ya da geri bıraktı) ikisinden de
 * kaçardı. İstek satırda kalıcıdır: işçi satırı bu turda geri bıraksa da bir sonraki talepte gönderim başlangıcı reddedilir. SONRA hiçbir
 * işçinin almadığı satırlar hemen iptal edilir (istek zaten yazılı olduğu için bu adımın yarıda kalması mesajı göndermez).
 *
 * `scope` çağıranın kiracı kapsamını TAŞIMALIDIR (`organizationId`); bu fonksiyon kapsam eklemez.
 */
export async function requestOutboxCancel(
  scope: Prisma.MessageOutboxWhereInput & { organizationId: string },
  reason: string,
  now: Date = new Date(),
): Promise<OutboxCancelResult> {
  await prisma.messageOutbox.updateMany(cancelRequestWrite(scope, reason, now));
  const canceled = await cancelFlaggedUnclaimed(scope);
  // Kalanlar: iptal isteği taşıyan ve hâlâ işçide olan satırlar (gönderim başlangıcında iptal olacak) + isteği çoktan çıkmış satırlar.
  const [requested, dispatching] = await Promise.all([
    prisma.messageOutbox.count({ where: { AND: [scope, { status: "sending", dispatchStartedAt: null, cancelRequestedAt: { not: null } }] } }),
    prisma.messageOutbox.count({ where: { AND: [scope, { status: "sending", dispatchStartedAt: { not: null } }] } }),
  ]);
  return { canceled, requested, dispatching };
}

/**
 * İptal isteği taşıyan ve hiçbir işçinin almadığı satırları iptal eder. İşçi her geçişin başında kapsamsız çağırır: iptal isteği yazıldıktan
 * sonra geri bırakılan (ertelenen) satır bir sonraki talebi beklemeden kapanır. Dönüş: iptal edilen satır sayısı.
 */
export async function cancelFlaggedUnclaimed(scope: Prisma.MessageOutboxWhereInput = {}): Promise<number> {
  // Sebep satırdaki koddan okunur (istekler farklı sebeplerle gelmiş olabilir) → sebep başına bir yazım; kod kümesi küçüktür.
  const reasons = await prisma.messageOutbox.findMany({
    where: { AND: [scope, { status: { in: [...UNCLAIMED_CANCELABLE] }, cancelRequestedAt: { not: null } }] },
    select: { cancelReason: true },
    distinct: ["cancelReason"],
  });
  let total = 0;
  for (const { cancelReason } of reasons) {
    const res = await prisma.messageOutbox.updateMany({
      where: { AND: [scope, { status: { in: [...UNCLAIMED_CANCELABLE] }, cancelRequestedAt: { not: null }, cancelReason }] },
      data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: cancelReason ?? "cancel_requested", claimedBy: null, claimExpiresAt: null },
    });
    total += res.count;
  }
  return total;
}

/** Satırın evresi — arayüz ve teşhis için tek sözlük. Saf. */
export type OutboxPhase = "queued" | "preparing" | "dispatching" | "uncertain" | "sent" | "failed" | "canceled";

export function outboxPhase(row: { status: string; dispatchStartedAt: Date | null }): OutboxPhase {
  switch (row.status) {
    case "pending":
    case "blocked":
      return "queued";
    case "sending":
      return row.dispatchStartedAt ? "dispatching" : "preparing";
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      // ambiguous · reconciling · review: istek çıktı, sonucu bilinmiyor.
      return "uncertain";
  }
}
