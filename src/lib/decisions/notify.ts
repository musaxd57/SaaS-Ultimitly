import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { decisionPendingEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { reportError } from "@/lib/report-error";
import { REPLY_WAITING_CLAIM_TTL_MS, REPLY_WAITING_MAIL_PREFIX } from "@/lib/host-reply-waiting";
import { HELD_MAIL_PREFIX } from "@/lib/conversation-items/flow";
import { DECISION_KIND_LABELS_TR, decisionTitle, formatDecisionDay } from "./core";
import { claimDecisionNotification, releaseDecisionNotification, type PersistedDecision } from "./store";

// ---------------------------------------------------------------------------
// "KARAR BEKLİYOR" E-POSTASI (Host Karar Motoru, Faz 1 — kurucu: "Host'a bir bildirim gider; tekrar tekrar gönderilmez").
//  · MESAJ BAŞINA TEK BİLDİRİM: "Misafir cevabınızı bekliyor" (K10) e-postasıyla AYNI talep satırı (`reply-waiting-mail:<mesaj>`)
//    — ikisi aynı mesaja birden gitmez; hassas öğe ACİL e-postası (`held-items-mail:<mesaj>`) o mesaj için gittiyse bu e-posta
//    gitmez (acil e-posta zaten konuşmaya götürür; kart orada). Kart başına da tek damga (`notifiedAt`, atomik).
//  · Gidemezse iki talep de geri verilir (aynı mesaj yeniden değerlendirilirse yeniden denenir) + tek alarm.
//  · Alıcı acil e-postayla AYNI kural: org'un uyarı adresi, yoksa SAHİBİN e-postası — personel ya da operatör ASLA.
//  · Misafir metni taşımaz; bağlantı `appBaseUrl()`den. Asla fırlatmaz.
// ---------------------------------------------------------------------------

export type DecisionNoticeOutcome = "mailed" | "deduped" | "no_recipient" | "failed" | "none";

export async function notifyTurnDecisions(input: {
  organizationId: string;
  conversation: { id: string; guestIdentifier: string };
  property: { name: string };
  decisions: readonly PersistedDecision[];
  now?: Date;
}): Promise<DecisionNoticeOutcome> {
  const now = input.now ?? new Date();
  const pending = input.decisions.filter((d) => d.status === "pending" && d.notifiedAt === null);
  if (pending.length === 0) return "none";
  // Bir turun kartları aynı mesajdadır (öğe yoksa son mesaj); farklı mesajlara düştüyse en yeni kartın mesajı esas.
  const messageId = pending[pending.length - 1].messageId;
  const lockName = `${REPLY_WAITING_MAIL_PREFIX}${messageId}`;
  let locked = false;
  const claimed: PersistedDecision[] = [];
  try {
    const org = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: {
        name: true,
        alertEmail: true,
        users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
      },
    });
    const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim() || null;
    if (!to) return "no_recipient";
    // Kartlar bu bildirimin konusu: damgalanırlar (sonraki tur aynı kartlar için yeniden göndermesin).
    for (const d of pending) {
      if (await claimDecisionNotification(prisma, { organizationId: input.organizationId, id: d.id, now })) claimed.push(d);
    }
    if (claimed.length === 0) return "deduped";
    // Hassas öğe acil e-postası bu mesaj için gittiyse ikinci e-posta YOK (damgalar kalır — kart panelde).
    const heldMail = await prisma.systemLock.findUnique({ where: { name: `${HELD_MAIL_PREFIX}${messageId}` }, select: { name: true } });
    if (heldMail) return "deduped";
    await prisma.systemLock
      .deleteMany({ where: { name: { startsWith: REPLY_WAITING_MAIL_PREFIX }, lockedUntil: { lt: now } } })
      .catch(() => {});
    try {
      await prisma.systemLock.create({ data: { name: lockName, lockedUntil: new Date(now.getTime() + REPLY_WAITING_CLAIM_TTL_MS) } });
      locked = true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "deduped";
      throw err;
    }
    const titles = claimed.map((d) => decisionTitle(d.kind, d.requestedTime));
    const first = claimed[0];
    const html = decisionPendingEmail({
      title: titles.join(" · "),
      dayLabel: claimed.length === 1 && first.dayKey ? `${formatDecisionDay(first.dayKey, "tr")} (${DECISION_KIND_LABELS_TR[first.kind].toLocaleLowerCase("tr-TR")})` : null,
      guestIdentifier: input.conversation.guestIdentifier,
      propertyName: input.property.name,
      orgName: org?.name ?? "Lixus AI",
      panelUrl: `${appBaseUrl()}/inbox/${encodeURIComponent(input.conversation.id)}`,
    });
    const mail = await emailService.sendReporting(
      to,
      `Karar bekliyor: ${titles.join(" · ")} — ${input.conversation.guestIdentifier} (${input.property.name})`,
      html,
    );
    if (!mail.ok) throw new Error("decision-pending e-mail failed; claims released, the card stays visible in the inbox");
    return "mailed";
  } catch (err) {
    // Gitmeyen e-postanın talepleri geri verilir (aynı mesaj yeniden değerlendirilirse yeniden denenir).
    for (const d of claimed) {
      await releaseDecisionNotification(prisma, { organizationId: input.organizationId, id: d.id, claimedAt: now }).catch(() => {});
    }
    if (locked) await prisma.systemLock.deleteMany({ where: { name: lockName } }).catch(() => {});
    void reportError(`host-decisions notify org=${input.organizationId}`, err);
    return "failed";
  }
}
