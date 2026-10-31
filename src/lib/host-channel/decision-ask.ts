import "server-only";

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { calendarDateOf } from "@/modules/availability/core";
import { freshDecisionCard, guestWroteAfterRequest } from "@/lib/decisions/decide";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { activeBindingAddress, hostChannelSecret, usableHostBindingForOrg } from "./binding";
import { decidableOnChannel, decisionWarnings } from "./decision-answer";
import { decisionButtonId } from "./decision-buttons";
import { shortStayRange, templateSafe } from "./question-text";
import { chooseHostChannel, hostChannelFlagsFromEnv } from "./routing";
import type { HostChannelTransport } from "./types";
import type { DecisionCardData } from "@/lib/decisions/view-types";

// ---------------------------------------------------------------------------
// "KARAR BEKLİYOR" WHATSAPP'TA — Tür B gönderimi (tasarım §3.10, dilim 3; anahtar `HOST_QUESTION_DECISIONS_ENABLED` + kanal + işletme
// listesi + doğrulanmış numara). Tek çağıran bugünkü "Karar bekliyor" e-postası (`decisions/notify.ts`): WhatsApp gittiyse o kart için
// e-posta GİTMEZ; gitmezse bugünkü e-posta.
//  · YALNIZ WhatsApp'ta karar verilebilen kart (metinli tür, istenen saat belli, ücretsiz onay — `decidableOnChannel`); ötekiler e-posta.
//  · Kart başına (sürümle) tek kayıt (`decision:<karar>:v<sürüm>`, `HostQuestion` `kind: "decision"`, durum `notified` — soru akışına
//    karışmaz, metin taşımaz); aynı kart yeniden bildirilirse ikinci WhatsApp yok.
//  · Misafir metni / adı gitmez: daire · tarih aralığı · kartın başlığı · en çok 2 kontrol satırı, UYARILAR ÖNCE (ev sahibinin kendi olguları).
//  · Asla fırlatmaz; her beklenmedik hata → `false` (bugünkü e-posta).
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DECISION_RECORD_TTL_MS = 24 * HOUR_MS;
/** Kontrol satırı yoksa şablon değişkeni boş olamaz (Meta boş parametreyi reddeder). */
export const NO_CHECKS_TEXT = "ek bilgi yok";

/**
 * Şablonun kontrol değişkeni: uyarılar (panelde kırmızı) ÖNCE, en çok 2, sığmayanların sayısı ("+N uyarı daha") — ilk iki satır konuma göre
 * seçilince "daire boşalmamış olabilir" gibi uyarı hiç görünmüyordu (sert inceleme 10-31 F-1). Uyarı yoksa ilk iki satır. Hiç satır yoksa
 * `NO_CHECKS_TEXT` (Meta boş değişkeni reddeder). Tamamı önizlemede.
 */
export function decisionTemplateChecks(card: Pick<DecisionCardData, "lines">): string {
  const warnings = decisionWarnings(card);
  const shown = (warnings.length > 0 ? warnings : card.lines.map((l) => l.text))
    .slice(0, 2)
    .map((t) => templateSafe(t))
    .filter(Boolean);
  const more = warnings.length - Math.min(warnings.length, 2);
  return [...shown, ...(more > 0 ? [`+${more} uyarı daha`] : [])].join("; ") || NO_CHECKS_TEXT;
}

/** `true`: WhatsApp gitti (ya da bu kart sürümü için zaten gitmişti) — e-posta gönderilmez. */
export async function askDecisionOnChannel(input: {
  organizationId: string;
  conversationId: string;
  decision: { id: string; version: number; messageId: string };
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<boolean> {
  const flags = hostChannelFlagsFromEnv();
  if (chooseHostChannel({ kind: "decision", orgId: input.organizationId, flags, binding: "verified", orgSentLastHour: 0 }) !== "whatsapp") return false;
  if (!input.transport?.sendDecision || !hostChannelSecret() || !hostDecisionsEnabled()) return false;
  const now = input.now ?? new Date();
  let rowId: string | null = null;
  try {
    const binding = await usableHostBindingForOrg(input.organizationId);
    if (!binding) return false;
    const sentLastHour = await prisma.hostQuestion.count({
      where: { organizationId: input.organizationId, sentAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    if (chooseHostChannel({ kind: "decision", orgId: input.organizationId, flags, binding: "verified", orgSentLastHour: sentLastHour }) !== "whatsapp") {
      return false;
    }
    const fresh = await freshDecisionCard({ organizationId: input.organizationId, conversationId: input.conversationId, decisionId: input.decision.id, now });
    if (!fresh?.card || fresh.card.version !== input.decision.version || !decidableOnChannel(fresh.card, "approve")) return false;
    // Misafir talepten sonra yeniden yazdıysa WhatsApp'ta karar verilemez (çekirdek "okudum" ister) → bugünkü e-posta (sert inceleme S-4).
    const request = await prisma.decisionRequest.findFirst({
      where: { id: input.decision.id, organizationId: input.organizationId },
      select: { conversationId: true, messageId: true, createdAt: true },
    });
    if (!request || (await guestWroteAfterRequest(request))) return false;
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, property: { organizationId: input.organizationId } },
      select: { property: { select: { name: true } }, reservation: { select: { arrivalDate: true, departureDate: true } } },
    });
    if (!conv?.reservation) return false;
    const to = await activeBindingAddress(binding.id, input.organizationId);
    if (!to) return false;

    const idempotencyKey = `decision:${input.decision.id}:v${input.decision.version}`;
    const fresh_id = randomUUID();
    try {
      await prisma.hostQuestion.create({
        data: {
          id: fresh_id,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          bindingId: binding.id,
          kind: "decision",
          turnMessageId: input.decision.messageId,
          status: "queued",
          idempotencyKey,
          expiresAt: new Date(now.getTime() + DECISION_RECORD_TTL_MS),
        },
      });
      rowId = fresh_id;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      // Bu kart sürümü için kayıt var: gittiyse e-posta yok; gitmediyse bugünkü e-posta (sessiz kalmaktansa).
      const prev = await prisma.hostQuestion.findFirst({ where: { organizationId: input.organizationId, idempotencyKey }, select: { status: true } });
      return prev?.status === "notified";
    }

    const card = fresh.card;
    const dayMonth = (d: Date) => {
      const [, m, day] = calendarDateOf(d, fresh.timeZone).key.split("-").map(Number);
      return { day: day!, month: m! };
    };
    const base = { decisionId: card.id, version: card.version };
    const sent = await input.transport.sendDecision(to, {
      property: templateSafe(conv.property.name),
      dates: shortStayRange(dayMonth(conv.reservation.arrivalDate), dayMonth(conv.reservation.departureDate)),
      title: templateSafe(card.dayLabel ? `${card.dayLabel} · ${card.title}` : card.title),
      checks: decisionTemplateChecks(card),
      link: input.conversationId,
      approveId: decisionButtonId({ ...base, step: "choose", action: "approve" }),
      declineId: decisionButtonId({ ...base, step: "choose", action: "decline" }),
    });
    if (!sent.ok || !sent.providerMessageId) {
      await prisma.hostQuestion.updateMany({ where: { id: rowId, status: "queued" }, data: { status: "failed", version: { increment: 1 } } });
      return false;
    }
    await prisma.hostQuestion.updateMany({
      where: { id: rowId, status: "queued" },
      data: { status: "notified", sentAt: now, providerMessageId: sent.providerMessageId, version: { increment: 1 } },
    });
    return true;
  } catch {
    if (rowId) await prisma.hostQuestion.updateMany({ where: { id: rowId, status: "queued" }, data: { status: "failed" } }).catch(() => null);
    return false;
  }
}
