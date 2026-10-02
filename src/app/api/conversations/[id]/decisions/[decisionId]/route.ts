import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { auditActor, auditImpersonation, writeAudit } from "@/lib/audit";
import { orgTimezone } from "@/lib/timezone";
import { todayKey } from "@/modules/availability/core";
import { providerErrorMessageFromText } from "@/lib/provider-errors";
import { sendHostMessage } from "@/lib/host-send";
import { applyItemEvent } from "@/lib/conversation-items/store";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { TEXT_DECISION_KINDS, isDecisionKind, parseHostTime } from "@/lib/decisions/core";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR (Faz 1, kurucu 10-02 akşam). Ev sahibi kartta Onayla / Reddet / Kapat der. Onay ve ret misafire
// mesaj GÖNDERİR (cevap rotasıyla aynı çekirdek, `host-send.ts`); metni ev sahibi kartta görür ve düzenleyebilir (varsayılanı
// kod kurar, `decisions/core.ts`). Göndermeden HEMEN önce yeniden doğrulama (TOCTOU, Faz 0 §4):
//  1. kilit: `pending` + sürüm eşleşmeli (CAS) — çift tıklama / eşzamanlı ikinci karar 409, ikinci mesaj YOK;
//  2. misafir talepten SONRA yeniden yazdıysa önce okutulur (409 `guest_wrote_again`; "okudum" = son mesaj kimliğiyle tekrar);
//  3. rezervasyon iptal / hedef gün geçti → durur (kart kendiliğinden kapanır).
// Gönderim belirsizse kart "gönderim doğrulanamadı" kalır (mesaj ulaşmış OLABİLİR — kör tekrar yok); kesin hatada kart yeniden
// açılır. Yalnız sahip / yönetici; bürünmede yazma yok (`withManage` boğazı). Denetim kaydı metin / tutar taşımaz.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  action: z.enum(["approve", "decline", "dismiss"]),
  version: z.number().int().min(0),
  time: z.string().max(5).optional(),
  body: z.string().max(10000).optional(),
  seenMessageId: z.string().max(64).optional(),
});

function conflict(code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, error, ...extra }, { status: 409 });
}

export const POST = withManage<{ id: string; decisionId: string }>(async (session, req, { params }) => {
  if (!hostDecisionsEnabled()) return notFound();
  const { id, decisionId } = await params;
  // Kota org kapsamlı (cevap rotasıyla aynı ilke, 09-23): başka kiracının kullanıcısı bu kimlikle sahibin kotasını yakamaz.
  const limited = await rateLimit(`decision:${session.organizationId}:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const parsed = bodySchema.safeParse(await readJsonCappedOrNull(req));
  if (!parsed.success) return badRequest({ action: "Geçersiz işlem." });
  const input = parsed.data;

  const decision = await prisma.decisionRequest.findFirst({
    where: { id: decisionId, conversationId: id, organizationId: session.organizationId },
  });
  if (!decision || !isDecisionKind(decision.kind)) return notFound();
  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      id: true,
      channel: true,
      guestIdentifier: true,
      externalReservationId: true,
      reservation: { select: { status: true } },
      property: { select: { organization: { select: { timezone: true } } } },
    },
  });
  if (!conversation) return notFound();
  const now = new Date();
  const audit = (action: string, extra: Record<string, unknown> = {}) =>
    writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action,
      metadata: { decisionId: decision.id, kind: decision.kind, ...extra, ...auditImpersonation(session) },
    });

  // ── KAPAT: "gerek kalmadı / kendim hallettim" (karar bekleyen ya da gönderimi doğrulanamayan kart) ──
  if (input.action === "dismiss") {
    const res = await prisma.decisionRequest.updateMany({
      where: {
        id: decision.id,
        organizationId: session.organizationId,
        status: { in: ["pending", "send_unverified"] },
        version: input.version,
      },
      data: { status: "dismissed", decidedById: session.userId, decidedAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) return conflict("stale", "Bu kart az önce değişti. Sayfayı yenileyip tekrar bakın.");
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    await audit("decision.dismissed");
    return jsonOk({ status: "dismissed" });
  }

  // ── ONAYLA / REDDET ──
  if (decision.status !== "pending" || decision.version !== input.version) {
    return conflict("stale", "Bu kart az önce değişti. Sayfayı yenileyip tekrar bakın.");
  }
  const body = input.body?.trim() ?? "";
  if (!body) return badRequest({ body: "Misafire gidecek mesaj boş olamaz." });
  const approve = input.action === "approve";
  const time = approve ? parseHostTime(input.time) : null;
  if (approve && TEXT_DECISION_KINDS.has(decision.kind) && !time) return badRequest({ time: "Geçerli bir saat seçin (SS:DD)." });

  // Yeniden doğrulama — göndermeden HEMEN önce.
  if (/cancel/i.test(conversation.reservation?.status ?? "")) {
    return conflict("reservation_cancelled", "Rezervasyon iptal edilmiş; misafire karar mesajı gönderilmedi.");
  }
  const tz = orgTimezone(conversation.property.organization.timezone);
  if (decision.dayKey && decision.dayKey < todayKey(now, tz)) {
    return conflict("expired", "Talep edilen gün geçti; misafire karar mesajı gönderilmedi.");
  }
  const requestMessage = await prisma.message.findFirst({
    where: { id: decision.messageId, conversationId: id },
    select: { createdAt: true },
  });
  const latestGuest = await prisma.message.findFirst({
    where: { conversationId: id, direction: "inbound", ...(requestMessage ? { createdAt: { gt: requestMessage.createdAt } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (requestMessage && latestGuest && latestGuest.id !== input.seenMessageId) {
    return conflict("guest_wrote_again", "Misafir bu talepten sonra yeniden yazdı. Mesajı okuyun, sonra tekrar gönderin.", {
      latestMessageId: latestGuest.id,
    });
  }

  // Kilit (CAS): yalnız bu sürümdeki BEKLEYEN kart gönderime geçer.
  const lock = await prisma.decisionRequest.updateMany({
    where: { id: decision.id, organizationId: session.organizationId, status: "pending", version: input.version },
    data: { status: "sending", version: { increment: 1 } },
  });
  if (lock.count !== 1) return conflict("stale", "Bu kart az önce değişti. Sayfayı yenileyip tekrar bakın.");
  const lockedVersion = input.version + 1;
  const reopen = () =>
    prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId: session.organizationId, status: "sending", version: lockedVersion },
      data: { status: "pending", version: { increment: 1 } },
    });

  let sent: Awaited<ReturnType<typeof sendHostMessage>>;
  try {
    sent = await sendHostMessage({
      organizationId: session.organizationId,
      conversation,
      body,
      claimBody: body,
      senderName: session.name,
      // K6 (Faz 0 önerisi): karar ev sahibinin, metni kod kurdu → "ev sahibi yazdı + yapay zekâ destekli".
      aiAssisted: true,
      idempotencyKey: `decision:${decision.id}:v${lockedVersion}`,
      strictIdempotency: true,
    });
  } catch (err) {
    await reopen().catch(() => {});
    throw err;
  }

  if (sent.status === "sent" || sent.status === "queued" || sent.status === "failed_ambiguous") {
    const delivered = sent.status !== "failed_ambiguous";
    const resultMessageId = sent.status === "failed_ambiguous" ? null : (sent.message?.id ?? null);
    await prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId: session.organizationId, status: "sending", version: lockedVersion },
      data: {
        status: delivered ? (approve ? "approved" : "declined") : "send_unverified",
        decidedTime: time,
        decidedById: session.userId,
        decidedAt: now,
        resultMessageId,
        version: { increment: 1 },
      },
    });
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    await audit(approve ? "decision.approved" : "decision.declined", delivered ? {} : { delivery: "unverified" });
    if (!delivered) {
      return NextResponse.json(
        {
          code: "send_unverified",
          error: "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı kontrol edin.",
        },
        { status: 502 },
      );
    }
    return jsonOk({ status: approve ? "approved" : "declined", resultMessageId, queued: sent.status === "queued" });
  }

  // Kesin olumsuz sonuçlar: hiçbir şey gitmedi → kart yeniden açılır (ev sahibi düzeltip tekrar dener).
  await reopen();
  switch (sent.status) {
    case "not_connected":
      return NextResponse.json(
        { error: "Kanal hesabınız bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlantınızı kurun." },
        { status: 502 },
      );
    case "duplicate":
      return conflict("duplicate", "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor.");
    case "idempotency_conflict":
      return conflict("stale", "Bu kart az önce değişti. Sayfayı yenileyip tekrar bakın.");
    case "claim_unavailable":
      return NextResponse.json({ error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." }, { status: 503 });
    case "failed_definitive":
      return NextResponse.json(
        { error: providerErrorMessageFromText(sent.error, "Mesaj gönderilemedi. Lütfen kısa bir süre sonra tekrar deneyin.") },
        { status: 502 },
      );
  }
});
