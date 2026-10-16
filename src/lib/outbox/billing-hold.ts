import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { billingEnforced, premiumAllowed } from "@/lib/billing/subscription";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// ABONELİK ERİŞİMİ KAPALI İŞLETMENİN KUYRUKTAKİ OTOMATİK MESAJI (Codex 10-16, ölçüldü). Kurucu kararı: "Geçerli ödenmiş dönem bitince ücretli
// otomatik işler dursun." Yeni otomasyon duruyordu ama kuyruk işçisi gönderim anında erişime bakmıyordu → bekleyen yapay zekâ cevabı /
// karşılama mesajı yine gönderiliyordu. Bu işletmelerin OTOMATİK satırı talep edilmez — iptal de edilmez, deneme sayısı artmaz; bekleyen
// mesajın ödeme sonrası kaderi kurucu kararı (`docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §N1). Elle cevap ("manual") ve eski NULL tür
// etkilenmez ve bekleyen otomatik satırın arkasında SIRA kuralıyla tıkanmaz (Y5 deseni). TEK KAYNAK: işçinin talep süzgeci ve kuyruk sağlığı
// okuması aynı kuralı kullanır (sağlık okuması bekletilen satırı "takılı" saymasın — Haiku 10-16). Faturalandırma kapalıyken okuma yok.
// ---------------------------------------------------------------------------

/** Ücretli OTOMATİK gönderim türleri (yapay zekâ cevabı, bekleme mesajı, yaşam döngüsü). */
export const PAID_AUTOMATED_TYPES = ["ai", "holding_ack", "welcome", "checkin", "checkout"] as const;
const PAID_AUTOMATED_SET: ReadonlySet<string> = new Set(PAID_AUTOMATED_TYPES);
/** Gönderim anında yakalanan satıra bu kadar sonra yeniden bakılır (deneme sayılmaz). */
export const BILLING_HOLD_RETRY_MS = 10 * 60_000;

/**
 * Bekleyen otomatik satırı olan ve erişimi KAPALI işletmeler. VADESİ gelmemiş (ertelenmiş) satırlar da sayılır: aksi hâlde ertelenen satırın
 * işletmesi listeye girmez ve aynı konuşmadaki sonraki elle cevap sıra kuralında tıkanırdı (Haiku 10-16). Okuma hatası talebi DÜŞÜRMEZ:
 * işletme başına hata → engelsiz sayılır (gönderim anı kemeri yeniden okur; o da düşerse satır POST'suz geri bırakılır).
 */
export async function billingBlockedOrgIds(): Promise<string[]> {
  if (!billingEnforced()) return [];
  try {
    const pending = await prisma.messageOutbox.findMany({
      where: { status: "pending", messageType: { in: [...PAID_AUTOMATED_TYPES] } },
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

/** Gönderim anı kemeri: talepten sonra erişim kapandıysa otomatik satır POST edilmez, ertelenir. Elle cevap / NULL tür → null. */
export async function billingHoldUntil(row: { messageType: string | null; organizationId: string }, now: Date): Promise<Date | null> {
  if (!row.messageType || !PAID_AUTOMATED_SET.has(row.messageType)) return null;
  return (await premiumAllowed(row.organizationId)) ? null : new Date(now.getTime() + BILLING_HOLD_RETRY_MS);
}

/**
 * SQL süzgeci: `alias` satırı erişimi kapalı bir işletmenin BEKLEYEN otomatik satırı mı. NULL tür açıkça dışarıda (`NULL IN (…)` NULL döner,
 * `NOT NULL` satırı eler — Haiku 10-16: eski NULL satır yanlışlıkla talep dışı kalıyordu).
 */
export function billingHeldSql(alias: "s" | "e", blocked: readonly string[]): Prisma.Sql {
  const t = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(${t}."status" = 'pending' AND ${t}."messageType" IS NOT NULL AND ${t}."messageType" IN (${Prisma.join([...PAID_AUTOMATED_TYPES])}) AND ${t}."organizationId" = ANY(${[...blocked]}::text[]))`;
}
