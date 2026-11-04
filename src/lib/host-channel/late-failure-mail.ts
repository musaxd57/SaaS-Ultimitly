import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ANON_BODY } from "@/lib/data-retention";
import { emailService } from "@/lib/email";
import { decisionPendingEmail, hostReplyWaitingEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { logEvent } from "@/lib/event-log";
import { reportError } from "@/lib/report-error";
import { DECISION_DAY_SUFFIX_TR, TEXT_DECISION_KINDS, decisionTitle, formatDecisionDay, type DecisionKind } from "@/lib/decisions/core";

// ---------------------------------------------------------------------------
// GEÇ GELEN "ULAŞMADI" → E-POSTA YEDEĞİ (Codex 11-04 P2). Bilgi sorusu ve karar bildirimi WhatsApp'a gidince bugünkü e-posta BASTIRILIR
// (`host-reply-waiting.ts`, `decisions/notify.ts`). Sağlayıcı sonradan imzalı durum bildirimiyle "failed" derse ev sahibine ne WhatsApp ne
// e-posta ulaşmış olur — yalnız acil bildirimin (`alert`) ertelenmiş e-postası vardı. Artık bilgi / karar için de:
//  · Kayıt: `SystemLock` satırı `host-late-fail-mail:<HostQuestion.id>` (migration YOK; acil e-postanın deseni). Yinelenen bildirim aynı
//    satıra düşer → TEK e-posta.
//  · Teslim: her senkron geçişinde vadesi gelen satır kiralanır (CAS); e-posta BUGÜNKÜ şablonla (ev sahibinin WhatsApp olmasaydı alacağı
//    e-postanın AYNISI). Okunmuş / cevaplanmış bildirim, silinmiş / anonimleşmiş içerik, kapanmış karar → e-posta yok.
//  · Gönderilemezse 2 dk sonra yeniden; 72 saat sonra bırakılır (operatöre haber). Gönderildikten sonra satır 7 gün TEKİLLEŞTİRME izi kalır.
// ---------------------------------------------------------------------------

export const LATE_FAIL_MAIL_PREFIX = "host-late-fail-mail:";
const SENT_HOLDER = "sent";
const LEASE_MS = 3 * 60_000;
const RETRY_MS = 2 * 60_000;
const GIVE_UP_MS = 72 * 60 * 60_000;
const SENT_MARKER_MS = 7 * 24 * 60 * 60_000;
const BATCH = 50;
const BUDGET_MS = 30_000;

/** Durum bildirimindeki "failed" kimlikleri → o bilgi / karar bildirimlerinin e-posta yedeği kaydedilir (yineleme güvenli). */
export async function scheduleLateFailureMails(providerMessageIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (providerMessageIds.length === 0) return 0;
  const ids = [...new Set(providerMessageIds)].slice(0, 200);
  const rows = await prisma.hostQuestion.findMany({
    where: { providerMessageId: { in: ids }, kind: { in: ["info", "decision"] }, answeredAt: null },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  // Bildirim "ulaşmadı" işaretlenir (ham SQL — `updatedAt` / sürüm değişmez; acil yolun kuralı): sonradan gelen düz ev sahibi mesajı onu
  // "okundu" yapamaz, cevap yönlendirmesi ulaşmamış soruyu seçmez.
  await prisma.$executeRaw`UPDATE "HostQuestion" SET "status" = 'failed' WHERE "providerMessageId" = ANY(${ids}) AND "kind" IN ('info', 'decision') AND "answeredAt" IS NULL`;
  const created = await prisma.systemLock.createMany({
    data: rows.map((r) => ({ name: `${LATE_FAIL_MAIL_PREFIX}${r.id}`, lockedUntil: now, holder: null })),
    skipDuplicates: true,
  });
  return created.count;
}

type DueOutcome = "sent" | "skipped" | "dropped" | "retry" | "no_recipient";

export async function deliverDueLateFailureMails(now: Date = new Date(), clock: () => number = Date.now): Promise<Record<DueOutcome, number>> {
  const counts: Record<DueOutcome, number> = { sent: 0, skipped: 0, dropped: 0, retry: 0, no_recipient: 0 };
  // Eski "gönderildi" izleri (7 gün) süpürülür.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: LATE_FAIL_MAIL_PREFIX }, holder: SENT_HOLDER, lockedUntil: { lt: now } } })
    .catch(() => null);
  const started = clock();
  const due = await prisma.systemLock.findMany({
    where: { name: { startsWith: LATE_FAIL_MAIL_PREFIX }, lockedUntil: { lte: now }, NOT: { holder: SENT_HOLDER } },
    orderBy: [{ lockedUntil: "asc" }, { name: "asc" }],
    take: BATCH,
    select: { name: true, lockedUntil: true, holder: true },
  });
  for (const row of due) {
    if (clock() - started > BUDGET_MS) break;
    const token = randomUUID();
    const won = await prisma.systemLock.updateMany({
      where: { name: row.name, lockedUntil: row.lockedUntil, holder: row.holder },
      data: { holder: token, lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (won.count !== 1) continue;
    let outcome: DueOutcome;
    try {
      outcome = await deliverOne(row.name.slice(LATE_FAIL_MAIL_PREFIX.length), now);
    } catch {
      outcome = "retry";
    }
    counts[outcome]++;
    if (outcome === "retry") {
      await prisma.systemLock
        .updateMany({ where: { name: row.name, holder: token }, data: { holder: null, lockedUntil: new Date(now.getTime() + RETRY_MS) } })
        .catch(() => null);
    } else if (outcome === "sent") {
      await prisma.systemLock
        .updateMany({ where: { name: row.name, holder: token }, data: { holder: SENT_HOLDER, lockedUntil: new Date(now.getTime() + SENT_MARKER_MS) } })
        .catch(() => null);
    } else {
      await prisma.systemLock.deleteMany({ where: { name: row.name, holder: token } }).catch(() => null);
    }
  }
  return counts;
}

async function deliverOne(questionId: string, now: Date): Promise<DueOutcome> {
  const q = await prisma.hostQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      kind: true,
      organizationId: true,
      turnMessageId: true,
      decisionId: true,
      sentAt: true,
      createdAt: true,
      readAt: true,
      answeredAt: true,
      conversation: {
        select: {
          id: true,
          guestIdentifier: true,
          channel: true,
          property: {
            select: {
              name: true,
              address: true,
              city: true,
              organization: {
                select: {
                  name: true,
                  alertEmail: true,
                  users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!q) return "dropped"; // konuşma / bildirim silindi
  if (q.answeredAt) return "skipped";
  const anchor = q.sentAt ?? q.createdAt;
  if (now.getTime() - anchor.getTime() > GIVE_UP_MS) {
    await reportError("host-channel-late-failure-mail", new Error("Ulaşmayan bildirimin e-posta yedeği 72 saati aştı — gönderilmedi")).catch(() => null);
    return "dropped";
  }
  const org = q.conversation.property.organization;
  const to = org.alertEmail?.trim() || org.users[0]?.email?.trim() || null;
  if (!to) return "no_recipient";
  const conv = q.conversation;
  if (q.kind === "info") {
    const message = await prisma.message.findUnique({ where: { id: q.turnMessageId }, select: { body: true } });
    if (!message || message.body === ANON_BODY) return "dropped";
    const html = hostReplyWaitingEmail(
      { id: conv.id, guestIdentifier: conv.guestIdentifier, channel: conv.channel, priority: "normal" },
      message.body,
      conv.property,
      org.name ?? "Lixus AI",
    );
    const mail = await emailService.sendReporting(to, `Misafir cevabınızı bekliyor — ${conv.guestIdentifier} (${conv.property.name})`, html);
    if (!mail.ok) return "retry";
  } else {
    if (!q.decisionId) return "dropped";
    const d = await prisma.decisionRequest.findUnique({ where: { id: q.decisionId }, select: { kind: true, requestedTime: true, dayKey: true, status: true } });
    if (!d || d.status !== "pending") return "skipped"; // karar verildi / kapandı → hatırlatma yok
    const kind = d.kind as DecisionKind;
    const title = decisionTitle(kind, d.requestedTime);
    const html = decisionPendingEmail({
      title,
      dayLabel: d.dayKey ? `${formatDecisionDay(d.dayKey, "tr")}${DECISION_DAY_SUFFIX_TR[kind] ? ` (${DECISION_DAY_SUFFIX_TR[kind]})` : ""}` : null,
      action: TEXT_DECISION_KINDS.has(kind) ? "decide" : "change",
      guestIdentifier: conv.guestIdentifier,
      propertyName: conv.property.name,
      orgName: org.name ?? "Lixus AI",
      panelUrl: `${appBaseUrl()}/inbox/${encodeURIComponent(conv.id)}`,
    });
    const mail = await emailService.sendReporting(to, `Karar bekliyor: ${title} — ${conv.guestIdentifier} (${conv.property.name})`, html);
    if (!mail.ok) return "retry";
  }
  await logEvent("host_channel.late_failure.email_sent", {}, { organizationId: q.organizationId }).catch(() => null);
  return "sent";
}
