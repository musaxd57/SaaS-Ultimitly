import "server-only";

import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { reportError } from "@/lib/report-error";
import { dateKeyInTimeZone, orgTimezone, zonedWallClockToUtc } from "@/lib/timezone";
import { getConversationSuggestions } from "@/lib/ai-suggestions/load";
import { decideSuggestion } from "@/lib/ai-suggestions/act";
import { commitmentTaskTitle, hostCommitmentAutoEnabled, isCommitmentKind } from "@/lib/guest-commitments-core";
import { stayEndedBefore } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// SÖZ → GÖREV OTOMATİK (kurucu kararları 10-17 gece; tasarım `docs/TASARIM-2026-10-17-soz-otomatik-gorev.md`).
//
// Ev sahibinin YAZDIĞI mesajdaki söz ONAYSIZ söz + görev olur ("Onayla host uğraşmasın; host yapıcam yazdıysa saati ile kaydetsin").
// Mantık öneri yolunun AYNISI (`getConversationSuggestions` → `decideSuggestion`, kaynak "auto"): aynı kapılar, aynı birleştirme / konu /
// kardeş kuralları, aynı karar kaydı (bir kez uygulanan / "Yanlış, kaldır" ile kaldırılan söz bir daha açılmaz). Saat UYDURULMAZ (açık saat ·
// gün dilimi · yalnız gün). Belirsiz durum (hangi söze bağlansın · yeni saat hangi sözün) OTOMATİK UYGULANMAZ — öneri kartı kalır. Bağlamla
// KESİN eşleşen saat değişikliği ("Klima için teknisyen 11'de gelecek", "Teknisyen 11'e kaydı" — tek aday) kendiliğinden taşınır.
//
// Anahtar `HOST_COMMITMENT_AUTO_ENABLED` (yalnız "1"; kurucu "herkese birden" → Railway açılışında "1"). İşletme ayarı
// `autoCommitmentsEnabled` (Ayarlar; varsayılan açık — kapalıyken söz önerisi de çıkmaz). Günlük sınır işletme başına 20 (dolunca o gün öneri
// kartı olarak kalır). Konaklama bitince havlu / malzeme / temizlik sözü kapanır (iz: `closedReason`), arıza açık kalır.
// ---------------------------------------------------------------------------

export { hostCommitmentAutoEnabled };

/** İşletme başına günde en çok bu kadar söz kendiliğinden açılır (kurucu 10-17: 20). */
export const AUTO_COMMITMENT_DAILY_CAP = 20;
/** Her senkron turunda bakılan pencere: son etkinliği bu kadar dakika içinde olan konuşmalar (tur 2 dk; pay bırakıldı). */
export const SWEEP_RECENT_MINUTES = 15;
/** Saatlik telafi penceresi: geç içeri alınan ev sahibi mesajı (sağlayıcı arızası sonrası) — öneri penceresi zaten "bugün / yarın". */
export const SWEEP_CATCHUP_MINUTES = 48 * 60;
/** Ev sahibi mesajı aranan pencere (konuşmanın son etkinliği yakın olsa da söz mesajı bundan eski ise öneri penceresi dışında). */
const HOST_MESSAGE_LOOKBACK_HOURS = 48;
/** Tur başına en çok bu kadar konuşma (sıradaki tur kalanı alır). */
const SWEEP_MAX_CONVERSATIONS = 200;

export type AutoApplyResult = { created: number; rescheduled: number; skipped: number };
const ZERO: AutoApplyResult = { created: 0, rescheduled: 0, skipped: 0 };

/** Kuyruk satırı olup HİÇBİRİ "sent" olmayan giden mesaj kimlikleri (`history-learn/service.ts` ile aynı kural). */
async function undeliveredOutboundIds(messageIds: readonly string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const outbox = await prisma.messageOutbox.findMany({ where: { messageId: { in: [...new Set(messageIds)] } }, select: { messageId: true, status: true } });
  const delivered = new Set(outbox.filter((o) => o.status === "sent").map((o) => o.messageId));
  return new Set(outbox.map((o) => o.messageId).filter((id): id is string => id != null && !delivered.has(id)));
}

function startOfLocalDay(now: Date, tz: string): Date {
  const [y, mo, d] = dateKeyInTimeZone(now, tz).split("-").map(Number);
  return zonedWallClockToUtc(y, mo, d, 0, 0, 0, tz);
}

/**
 * Bir konuşmadaki ev sahibi sözlerini ONAYSIZ uygula. İdempotent (karar kaydı); sistem kararı (aktör yok). Belirsiz öneri (seçim isteyen)
 * kart olarak kalır. Günlük sınır dolunca yeni söz açılmaz (saat taşıma sınırdan sayılmaz — yeni görev açmaz).
 */
export async function applyHostCommitmentsAuto(organizationId: string, conversationId: string, now: Date = new Date()): Promise<AutoApplyResult> {
  if (!hostCommitmentAutoEnabled()) return ZERO;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { autoCommitmentsEnabled: true, timezone: true } });
  if (!org?.autoCommitmentsEnabled) return ZERO;
  const tz = orgTimezone(org.timezone);
  const suggestions = (await getConversationSuggestions(organizationId, conversationId, now)).filter((s) => s.kind === "commitment");
  if (suggestions.length === 0) return ZERO;
  // "Yanlış, kaldır" ile kaldırılan söz sayılmaz (Haiku 10-17 gece). YUMUŞAK sınır: aynı işletmenin iki konuşması aynı anda işlenirse
  // (gönderim kancası + senkron turu) bir iki söz aşılabilir — gürültü sınırıdır, para / güvenlik sınırı değil.
  let used = await prisma.guestCommitment.count({
    where: {
      organizationId,
      source: "auto",
      createdAt: { gte: startOfLocalDay(now, tz) },
      // `not` NULL'u dışlar (SQL) → açık / kapanmış (neden yok) satırlar ayrı dal.
      OR: [{ closedReason: null }, { closedReason: { not: "wrong" } }],
    },
  });
  // Kalıcı kuyrukta olup henüz TESLİM EDİLMEMİŞ ev sahibi mesajı (gönderilmedi / düştü / iptal / belirsiz) misafire ulaşmamış olabilir →
  // ondan söz kendiliğinden açılmaz (öneri kartı kalır; teslim olunca sonraki tur işler). Aynı kural geçmişten öğrenmede.
  const undelivered = await undeliveredOutboundIds(
    suggestions.flatMap((s) => (s.kind === "commitment" ? [s.proposal.messageId] : [])),
  );
  const out: AutoApplyResult = { created: 0, rescheduled: 0, skipped: 0 };
  for (const s of suggestions) {
    if (s.kind !== "commitment") continue;
    if (undelivered.has(s.proposal.messageId)) {
      out.skipped++;
      continue;
    }
    // Belirsiz: kart kalır (ev sahibi seçer).
    if (s.proposal.attachTopics || s.proposal.moveOptions) {
      out.skipped++;
      continue;
    }
    const isMove = Boolean(s.proposal.reschedule);
    if (!isMove && used >= AUTO_COMMITMENT_DAILY_CAP) {
      out.skipped++;
      continue;
    }
    const r = await decideSuggestion({ organizationId, actorUserId: null, auto: true, key: s.key, decision: "approve", now });
    if (r.status !== "done") {
      out.skipped++;
      continue;
    }
    if (r.created?.rescheduled) out.rescheduled++;
    else if (r.created?.commitmentId && !r.created.merged) {
      out.created++;
      used++;
    }
  }
  return out;
}

/**
 * Zamanlanmış tur: son etkinliği `lookbackMinutes` içinde olan ve son 48 saatte EV SAHİBİ mesajı taşıyan konuşmalar (işletme ayarı açık).
 * Her turda kısa pencere (`SWEEP_RECENT_MINUTES` — kanaldan doğrudan yazılan mesaj senkronla gelir), saatlikte geniş telafi
 * (`SWEEP_CATCHUP_MINUTES`). Sorgu dizinli (`Conversation.lastMessageAt` + mesajın konuşma dizini). Konuşma başına hata turu durdurmaz.
 */
export async function sweepHostCommitmentsAuto(
  now: Date = new Date(),
  lookbackMinutes: number = SWEEP_RECENT_MINUTES,
): Promise<AutoApplyResult & { conversations: number }> {
  const total = { created: 0, rescheduled: 0, skipped: 0, conversations: 0 };
  if (!hostCommitmentAutoEnabled()) return total;
  const since = new Date(now.getTime() - lookbackMinutes * 60_000);
  const hostSince = new Date(now.getTime() - HOST_MESSAGE_LOOKBACK_HOURS * 3_600_000);
  const rows = await prisma.conversation.findMany({
    where: {
      lastMessageAt: { gte: since },
      property: { organization: { autoCommitmentsEnabled: true } },
      messages: { some: { direction: "outbound", authorType: "host", createdAt: { gte: hostSince, lte: now } } },
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
    take: SWEEP_MAX_CONVERSATIONS,
    select: { id: true, property: { select: { organizationId: true } } },
  });
  for (const r of rows) {
    try {
      const res = await applyHostCommitmentsAuto(r.property.organizationId, r.id, now);
      total.created += res.created;
      total.rescheduled += res.rescheduled;
      total.skipped += res.skipped;
      total.conversations++;
    } catch (err) {
      await reportError("commitment-auto-sweep", err);
    }
  }
  return total;
}

/** Konaklama bitince kapanan söz türleri (kurucu 10-17: havlu / temizlik / eksik eşya kapanır, ARIZA açık kalır). */
export const STAY_END_CLOSES: readonly string[] = ["towels", "supplies", "cleaning"];

/**
 * Konaklaması bitmiş (çıkış günü bugünden önce, işletme diliminde) konuşmalardaki AÇIK havlu / malzeme / temizlik sözlerini kapatır:
 * durum `cancelled` + `closedReason = "stay_ended"` (iz kalır). Görevi: kimse dokunmamışsa (yapılacak + otomatik başlık) silinir, aksi
 * hâlde bırakılır. Arıza sözü kapanmaz (sıradaki misafir için de sorun olabilir). Rezervasyonsuz konuşmaya dokunulmaz. Anahtar kapalıyken
 * çalışmaz (bugünkü davranış).
 */
export async function closeStayEndedCommitments(now: Date = new Date()): Promise<{ closed: number }> {
  if (!hostCommitmentAutoEnabled()) return { closed: 0 };
  const open = await prisma.guestCommitment.findMany({
    // Ön süzgeç: çıkışı ŞU ANDAN önce olan rezervasyonlar (çıkış günü bugünden önceyse saklı tarih de şu andan öncedir) — kesin kural
    // aşağıda. Süzgeçsiz `take` süren konaklamaların sözleriyle dolup biten konaklamaları hiç göremeyebilirdi (Haiku 10-17 gece).
    where: {
      status: "open",
      kind: { in: [...STAY_END_CLOSES] },
      conversation: { reservation: { is: { departureDate: { lt: now } } } },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      organizationId: true,
      kind: true,
      topic: true,
      dayPart: true,
      taskId: true,
      organization: { select: { timezone: true } },
      conversation: { select: { reservation: { select: { departureDate: true } } } },
    },
    take: 500,
  });
  let closed = 0;
  for (const c of open) {
    const checkOut = c.conversation.reservation?.departureDate;
    if (!checkOut) continue;
    const tz = orgTimezone(c.organization.timezone);
    // Konaklama bitti mi: oto-yanıtın "konaklama bitti" susması ve gelen kutusu paneliyle AYNI kural (`stayEndedBefore` — çıkış günü
    // boyunca söz açık kalır).
    if (!stayEndedBefore(checkOut, now, tz)) continue;
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.guestCommitment.updateMany({
        where: { id: c.id, status: "open" },
        data: { status: "cancelled", closedAt: now, closedReason: "stay_ended" },
      });
      if (res.count !== 1) return false;
      if (c.taskId && isCommitmentKind(c.kind)) {
        await tx.task.deleteMany({ where: { id: c.taskId, status: "todo", title: commitmentTaskTitle(c.kind, c.topic, c.dayPart) } });
      }
      await writeAuditInTx(tx, {
        organizationId: c.organizationId,
        actorUserId: null,
        action: "commitment.stay_ended",
        metadata: { commitmentId: c.id, kind: c.kind },
      });
      return true;
    });
    if (done) closed++;
  }
  return { closed };
}

/** Yalnız test: işletme diliminde gün başlangıcı (günlük sınır sayımının penceresi). */
export const __autoCommitmentInternals = { startOfLocalDay };
