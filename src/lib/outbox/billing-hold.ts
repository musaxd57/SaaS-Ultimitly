import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { billingEnforced, premiumAllowed } from "@/lib/billing/subscription";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// ABONELİK ERİŞİMİ KAPALI İŞLETMENİN KUYRUKTAKİ OTOMATİK MESAJI (Codex 10-16, ölçüldü). Kurucu kararı: "Geçerli ödenmiş dönem bitince ücretli
// otomatik işler dursun." Yeni otomasyon duruyordu ama kuyruk işçisi gönderim anında erişime bakmıyordu → bekleyen yapay zekâ cevabı /
// karşılama mesajı yine gönderiliyordu.
// 🚨 N1 (kurucu 10-17, AYNEN: "ödeme geldikten sonra çalışmaya başlasın kesinlikle bayat mesaj gitmememeli tek gösterimlik uyarı çıkabilir"):
//   · YAPAY ZEKÂ CEVABI / bekleme mesajı (ai, holding_ack) erişim kapalıyken İPTAL edilir (`billing_paused`) ve gelen kutusunda not görünür —
//     ödeme gelince günler önce hazırlanmış cevap misafire GİTMEZ (Y5 `auto_reply_disabled` deseni). Satır talep edilir, gönderim anı
//     vetosu iptal eder (durum makinesinde pending → canceled yok).
//   · YAŞAM DÖNGÜSÜ mesajı (welcome / checkin / checkout) TALEP EDİLMEZ, bekler (deneme sayısı artmaz); ödeme gelince gönderim anı vetosu
//     (`lifecycleVeto`: iptal / bitmiş konaklama / pencere geçti / zaten gönderildi) yalnız penceresi hâlâ geçerliyse gönderir.
// Elle cevap ("manual") ve eski NULL tür etkilenmez ve bekleyen satırın ARKASINDA sıra kuralıyla tıkanmaz (Y5 deseni). TEK KAYNAK: işçinin
// talep süzgeci ve kuyruk sağlığı okuması aynı kuralı kullanır (sağlık okuması bekletilen satırı "takılı" saymasın — Haiku 10-16).
// Faturalandırma kapalıyken okuma yok.
// ---------------------------------------------------------------------------

/** Ücretli OTOMATİK gönderim türleri (yapay zekâ cevabı, bekleme mesajı, yaşam döngüsü). */
export const PAID_AUTOMATED_TYPES = ["ai", "holding_ack", "welcome", "checkin", "checkout"] as const;
/** Erişim kapalıyken BEKLEYEN türler (N1: penceresi hâlâ geçerliyse ödeme sonrası gider). */
export const BILLING_WAIT_TYPES = ["welcome", "checkin", "checkout"] as const;
const BILLING_WAIT_SET: ReadonlySet<string> = new Set(BILLING_WAIT_TYPES);
/** Erişim kapalıyken İPTAL edilen türler (N1: bayat cevap ödeme sonrası gitmez). */
const BILLING_CANCEL_SET: ReadonlySet<string> = new Set(["ai", "holding_ack"]);
/** Gelen kutusu notu / iptal sebebi (inbox `SKIP_REASON_LABELS`, otomasyon damgası aynı kod). */
export const BILLING_PAUSED_REASON = "billing_paused";
/** Gönderim anında yakalanan satıra bu kadar sonra yeniden bakılır (deneme sayılmaz). */
export const BILLING_HOLD_RETRY_MS = 10 * 60_000;

/**
 * Bekleyen YAŞAM DÖNGÜSÜ satırı olan ve erişimi KAPALI işletmeler (yapay zekâ cevabı bekletilmez, talep edilip iptal edilir — N1). VADESİ
 * gelmemiş (ertelenmiş) satırlar da sayılır: aksi hâlde ertelenen satırın işletmesi listeye girmez ve aynı konuşmadaki sonraki elle cevap sıra
 * kuralında tıkanırdı (Haiku 10-16). Okuma hatası talebi DÜŞÜRMEZ: işletme başına hata → engelsiz sayılır (gönderim anı kemeri yeniden okur;
 * o da düşerse satır POST'suz geri bırakılır).
 */
export async function billingBlockedOrgIds(): Promise<string[]> {
  if (!billingEnforced()) return [];
  try {
    const pending = await prisma.messageOutbox.findMany({
      where: { status: "pending", messageType: { in: [...BILLING_WAIT_TYPES] } },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    const verdicts = await Promise.all(
      pending.map(async ({ organizationId }) => ({ organizationId, allowed: await premiumAllowed(organizationId).catch(() => true) })),
    );
    return verdicts.filter((v) => !v.allowed).map((v) => v.organizationId);
  } catch (err) {
    void reportError("outbox-billing-blocked-read", err);
    return [];
  }
}

/** Gönderim anı kemeri (yaşam döngüsü): talepten sonra erişim kapandıysa satır POST edilmez, ertelenir. Diğer türler → null. */
export async function billingHoldUntil(row: { messageType: string | null; organizationId: string }, now: Date): Promise<Date | null> {
  if (!row.messageType || !BILLING_WAIT_SET.has(row.messageType)) return null;
  return (await premiumAllowed(row.organizationId)) ? null : new Date(now.getTime() + BILLING_HOLD_RETRY_MS);
}

/** Gönderim anı vetosu (yapay zekâ cevabı / bekleme mesajı): erişim kapalıysa `billing_paused` (satır İPTAL edilir — N1). Diğerleri → null. */
export async function billingCancelReason(row: { messageType: string | null; organizationId: string }): Promise<string | null> {
  if (!row.messageType || !BILLING_CANCEL_SET.has(row.messageType)) return null;
  return (await premiumAllowed(row.organizationId)) ? null : BILLING_PAUSED_REASON;
}

/**
 * SQL süzgeci: `alias` satırı erişimi kapalı bir işletmenin BEKLEYEN yaşam döngüsü satırı mı. NULL tür açıkça dışarıda (`NULL IN (…)` NULL
 * döner, `NOT NULL` satırı eler — Haiku 10-16: eski NULL satır yanlışlıkla talep dışı kalıyordu).
 */
export function billingHeldSql(alias: "s" | "e", blocked: readonly string[]): Prisma.Sql {
  const t = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(${t}."status" = 'pending' AND ${t}."messageType" IS NOT NULL AND ${t}."messageType" IN (${Prisma.join([...BILLING_WAIT_TYPES])}) AND ${t}."organizationId" = ANY(${[...blocked]}::text[]))`;
}
