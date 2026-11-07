import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { consumeDailyAiBudget } from "@/lib/ai/daily-budget";
import { orgTimezone } from "@/lib/timezone";
import { calendarDateOf } from "@/modules/availability/core";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { DECISION_LANGS, TEXT_DECISION_KINDS, decisionMessageText, isDecisionKind, liveDecisionDayKey, parseHostTime } from "@/lib/decisions/core";
import { listConversationDecisions } from "@/lib/decisions/store";
import { buildDecisionCards, decisionCardContextFor } from "@/lib/decisions/card";
import { decisionAiTextEnabled, draftDecisionMessage } from "@/lib/decisions/ai-text";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR MESAJI TASLAĞI (Sabah Kararları 62 h, kurucu 10-07). Ev sahibi Onayla / Reddet'i açınca panel buradan
// taslak ister: anahtar açıksa yapay zekâ yazar + kod ve bekçi doğrular (`decisions/ai-text.ts`), değilse / geçmezse onaylı şablon.
// Hiçbir şey GÖNDERMEZ ve hiçbir satır yazmaz (kart durumu değişmez). Yalnız sahip / yönetici; bürünmede yazma yok sayılır ama bu uç
// yazmaz — yine de `withManage` boğazından geçer. Ücretli plan / günlük AI bütçesi yoksa model ÇAĞRILMAZ, şablon döner (ev sahibi
// karar vermeye devam edebilsin). Taslak kart sayfasıyla AYNI olgulardan kurulur (`decisionCardContextFor`).
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  action: z.enum(["approve", "decline"]),
  time: z.string().max(5).optional(),
  /** Ev sahibinin panelde seçtiği mesaj dili (yoksa kartın dili). */
  lang: z.enum(DECISION_LANGS).optional(),
  /** Panelde "Ücreti mesaja ekle" / "Notu ekle" (varsayılan açık — şablonla aynı). */
  includeFee: z.boolean().optional(),
  includeNote: z.boolean().optional(),
});

export const POST = withManage<{ id: string; decisionId: string }>(async (session, req, { params }) => {
  if (!hostDecisionsEnabled()) return notFound();
  const { id, decisionId } = await params;
  const limited = await rateLimit(`decision-draft:${session.organizationId}:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const parsed = bodySchema.safeParse(await readJsonCappedOrNull(req));
  if (!parsed.success) return badRequest({ action: "Geçersiz işlem." });
  const approve = parsed.data.action === "approve";

  const decision = await prisma.decisionRequest.findFirst({
    where: { id: decisionId, conversationId: id, organizationId: session.organizationId },
  });
  if (!decision || !isDecisionKind(decision.kind) || !TEXT_DECISION_KINDS.has(decision.kind)) return notFound();
  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      propertyId: true,
      reservation: { select: { id: true, status: true, arrivalDate: true, departureDate: true } },
      property: { select: { checkInTime: true, checkOutTime: true, organization: { select: { timezone: true } } } },
    },
  });
  if (!conversation) return notFound();
  const time = approve ? parseHostTime(parsed.data.time) : null;
  if (approve && !time) return badRequest({ time: "Geçerli bir saat seçin." });

  const now = new Date();
  const tz = orgTimezone(conversation.property.organization.timezone);
  const views = await listConversationDecisions(prisma, { organizationId: session.organizationId, conversationId: id, timeZone: tz, now });
  const view = views.find((v) => v.id === decision.id);
  if (!view) return notFound();
  const ctx = await decisionCardContextFor({
    organizationId: session.organizationId,
    conversation: { ...conversation, messages: [] },
    timeZone: tz,
    now,
    needsEarlyRule: decision.kind === "early_checkin",
  });
  const [card] = await buildDecisionCards([view], ctx);
  if (!card) return notFound();
  const res = conversation.reservation;
  const dayKey = liveDecisionDayKey(
    { kind: decision.kind, dayKey: decision.dayKey, reservationId: decision.reservationId },
    res ? { id: res.id, arrivalKey: calendarDateOf(res.arrivalDate, tz).key, departureKey: calendarDateOf(res.departureDate, tz).key } : null,
  );

  const facts = {
    kind: decision.kind,
    resolution: approve ? ("approve" as const) : ("decline" as const),
    lang: parsed.data.lang ?? card.lang,
    dayKey,
    time,
    requestedTime: card.requestedTime,
    standardTime: card.standardTime,
    fee: parsed.data.includeFee === false ? null : card.fee,
    note: parsed.data.includeNote === false ? null : card.note,
    checklist: card.lines.map((l) => l.text),
  };
  // Model yalnız anahtar açık + ücretli plan + günlük bütçe varken; aksi hâlde onaylı şablon (ev sahibi yine karar verir).
  let aiAllowed = decisionAiTextEnabled() && (await premiumAllowed(session.organizationId));
  if (aiAllowed) aiAllowed = (await consumeDailyAiBudget(session.organizationId)).ok;
  if (!aiAllowed) {
    return jsonOk({ text: decisionMessageText(facts), source: "template" });
  }
  const request = await prisma.message.findFirst({ where: { id: decision.messageId, conversationId: id }, select: { body: true } });
  const draft = await draftDecisionMessage({
    ...facts,
    guestRequest: request?.body ?? null,
    stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
  });
  return jsonOk({ text: draft.text, source: draft.source, ...(draft.source === "template" ? { why: draft.why } : {}) });
});
