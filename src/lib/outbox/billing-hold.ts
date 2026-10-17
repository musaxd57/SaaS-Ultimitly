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

/**
 * N1 — "EN SON NE ZAMAN KAPALI GÖRÜLDÜ" İŞARETİ (Haiku 10-17, ölçüldü): erişim kapalıyken gelen mesajları yalnız DAMGALAMAK yetmiyordu —
 * senkron o dönemde düşmüşse (ör. sağlayıcı 402) mesajlar ödemeden SONRA, sağlayıcının eski zaman damgasıyla içeri alınıyor ve oto-yanıt
 * günler önceki sorulara cevap üretiyordu. Zamanlanmış senkron erişimi kapalı gördüğü HER turda (senkron başarısız olsa da) bu işareti "şimdi"
 * yapar; oto-yanıt adaylığı bu andan ÖNCEKİ mesajları kapsamaz (`runDueChannelAutoReplies` → `freshSince`). Ödemeden sonra gelen mesaj
 * işaretten yenidir → normal cevaplanır; arada kalan pencere en çok bir senkron turu (2 dk). Migration'sız: `SystemLock` satırı (ad + zaman;
 * kişisel veri yok). `lockedUntil` burada "son görülme anı" anlamındadır — kilit değildir, kimse almaz / bırakmaz.
 */
const BLOCKED_SEEN_PREFIX = "billing-blocked-seen:";

export async function noteBillingBlockedSeen(organizationId: string, now: Date = new Date()): Promise<void> {
  const name = `${BLOCKED_SEEN_PREFIX}${organizationId}`;
  await prisma.systemLock.upsert({ where: { name }, create: { name, lockedUntil: now }, update: { lockedUntil: now } });
}

/** Erişimin en son kapalı görüldüğü an (hiç görülmediyse `null`). Okuma hatası fırlatır — çağıran fail-closed davranır. */
export async function billingBlockedSeenAt(organizationId: string): Promise<Date | null> {
  const row = await prisma.systemLock.findUnique({ where: { name: `${BLOCKED_SEEN_PREFIX}${organizationId}` }, select: { lockedUntil: true } });
  return row?.lockedUntil ?? null;
}

/**
 * Bekleme notu yazılırken EZİLEBİLEN geçici sebepler (Haiku 10-17: not koşulsuz yazılıyordu → "misafir insan istedi" / şikâyet / risk
 * notu "abonelik" notuna dönüşüyordu). Kalıcı / anlamlı sebep korunur; deneme damgası her durumda yazılır (bayat cevap engeli asıl iştir).
 */
export const BILLING_NOTE_OVERWRITABLE: readonly string[] = [
  "outside_hours",
  "daily_budget",
  "ai_unavailable",
  "send_failed",
  "rate_limited",
  "subscription_inactive",
  "not_connected",
  // İki "gönderilmedi" notu birbirini günceller (genel anahtar kapalıyken / abonelik kapalıyken).
  "auto_reply_disabled",
  BILLING_PAUSED_REASON,
];
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

/**
 * Gönderim anı vetosu (yapay zekâ cevabı / bekleme mesajı): erişim kapalıysa `billing_paused` (satır İPTAL edilir — N1). Erişim açık AMA satır
 * erişimin en son kapalı görüldüğü andan ÖNCE oluşmuşsa da iptal (Opus 10-17: ileri vadeli / teslimi duraklatılmış satır kapalı dönemde hiç
 * talep edilmeden ödemeden sonra gidiyordu — bayat cevap). Diğer türler → null.
 */
export async function billingCancelReason(row: {
  messageType: string | null;
  organizationId: string;
  createdAt?: Date | null;
}): Promise<string | null> {
  if (!row.messageType || !BILLING_CANCEL_SET.has(row.messageType)) return null;
  if (!(await premiumAllowed(row.organizationId))) return BILLING_PAUSED_REASON;
  return (await spannedBillingBlock(row)) ? BILLING_PAUSED_REASON : null;
}

/**
 * Satır, erişimin kapalı görüldüğü bir dönemde zaten kuyrukta mıydı (oluşma anı ≤ son kapalı görülme)? Yaşam döngüsü vetosu bununla
 * bayatlık penceresini daraltır (Opus 10-17: kapı kodu mesajı ödeme gelince konaklamanın 3. günü gidiyordu). Faturalandırma kapalıyken ya da
 * oluşma anı bilinmiyorsa false.
 */
export async function spannedBillingBlock(row: { organizationId: string; createdAt?: Date | null }): Promise<boolean> {
  if (!billingEnforced() || !row.createdAt) return false;
  const seen = await billingBlockedSeenAt(row.organizationId);
  return seen !== null && row.createdAt.getTime() <= seen.getTime();
}

/**
 * SQL süzgeci: `alias` satırı erişimi kapalı bir işletmenin BEKLEYEN yaşam döngüsü satırı mı. NULL tür açıkça dışarıda (`NULL IN (…)` NULL
 * döner, `NOT NULL` satırı eler — Haiku 10-16: eski NULL satır yanlışlıkla talep dışı kalıyordu).
 */
export function billingHeldSql(alias: "s" | "e", blocked: readonly string[]): Prisma.Sql {
  const t = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(${t}."status" = 'pending' AND ${t}."messageType" IS NOT NULL AND ${t}."messageType" IN (${Prisma.join([...BILLING_WAIT_TYPES])}) AND ${t}."organizationId" = ANY(${[...blocked]}::text[]))`;
}
