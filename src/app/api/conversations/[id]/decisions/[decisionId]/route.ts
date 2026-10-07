import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { auditActor, auditImpersonation, writeAudit } from "@/lib/audit";
import { orgTimezone } from "@/lib/timezone";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import { providerErrorMessageFromText } from "@/lib/provider-errors";
import { sendHostMessage } from "@/lib/host-send";
import { applyItemEvent } from "@/lib/conversation-items/store";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { reportError } from "@/lib/report-error";
import {
  DECISION_SENDING_STALE_MS,
  TEXT_DECISION_KINDS,
  isDecisionKind,
  liveDecisionDayKey,
  parseHostTime,
  timeOnRightSide,
} from "@/lib/decisions/core";
import { listConversationDecisions } from "@/lib/decisions/store";
import { buildDecisionCards, decisionCardContextFor } from "@/lib/decisions/card";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR (Faz 1, kurucu 10-02 akşam). Ev sahibi kartta Onayla / Reddet / Kapat der. Onay ve ret misafire
// mesaj GÖNDERİR (cevap rotasıyla aynı çekirdek, `host-send.ts`); metni ev sahibi kartta görür ve düzenleyebilir (varsayılanı
// kod kurar, `decisions/core.ts`). Göndermeden HEMEN önce yeniden doğrulama (TOCTOU, Faz 0 §4):
//  1. kilit: `pending` + sürüm eşleşmeli (CAS) — çift tıklama / eşzamanlı ikinci karar 409, ikinci mesaj YOK;
//  2. misafir talepten SONRA yeniden yazdıysa önce okutulur (409 `guest_wrote_again`; "okudum" = son mesaj kimliğiyle tekrar);
//  3. rezervasyon iptal / hedef gün geçti → durur (kart kendiliğinden kapanır);
//  4. kontrol listesi ev sahibi baktıktan sonra değiştiyse (`factsHash`: temizlik bitti, komşu misafire karar verildi, saat
//     geçti…) karar ESKİ bilgiyle gitmez → 409 `facts_changed`, kart tazelenir (Faz 0 §4 adım 3).
// Gönderim belirsizse (zaman aşımı, aynı metin az önce gitti / gidiyor, gönderim sırasında hata) kart "gönderim doğrulanamadı"
// kalır (mesaj ulaşmış OLABİLİR — kör tekrar yok); YALNIZ hiçbir şeyin gitmediği KESİN hatada (kanal bağlı değil, kalkan okunamadı,
// kanal kesin reddetti) kart yeniden açılır. Kilit onayın saatini ve karar vereni HEMEN yazar (gönderim sürerken komşu kart /
// erken giriş kontrolü onu görür). Yalnız sahip / yönetici; bürünmede yazma yok (`withManage` boğazı). Denetim kaydı metin / tutar
// taşımaz.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  action: z.enum(["approve", "decline", "dismiss"]),
  version: z.number().int().min(0),
  time: z.string().max(5).optional(),
  body: z.string().max(10000).optional(),
  seenMessageId: z.string().max(64).optional(),
  /** Ev sahibinin gördüğü kartın olgu parmak izi (`decisionFactsHash`). */
  factsHash: z.string().max(64).optional(),
  /** Ev sahibi hazır metni değiştirdi mi (değiştirdiyse mesaj onun yazdığıdır — "yapay zekâ destekli" sayılmaz). */
  edited: z.boolean().optional(),
});

const STALE_TEXT = "Bu kart az önce değişti; güncel hâli gösteriliyor.";
const UNVERIFIED_TEXT =
  "Gönderim doğrulanamadı — mesaj misafire ulaşmış olabilir. Konuşmayı kanaldan kontrol edin; ulaşmadıysa misafire buradan yazın.";

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
      propertyId: true,
      reservation: { select: { id: true, status: true, arrivalDate: true, departureDate: true } },
      property: { select: { checkInTime: true, checkOutTime: true, organization: { select: { timezone: true } } } },
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

  // ── KAPAT: "gerek kalmadı / kendim hallettim" (karar bekleyen, gönderimi doğrulanamayan ya da gönderimi yarıda kalmış kart) ──
  if (input.action === "dismiss") {
    const res = await prisma.decisionRequest.updateMany({
      where: {
        id: decision.id,
        organizationId: session.organizationId,
        version: input.version,
        OR: [
          { status: { in: ["pending", "send_unverified"] } },
          // Gönderim sırasında süreç düştü: kart "doğrulanamadı" görünür; taze gönderim (sürüyor) KAPATILAMAZ.
          { status: "sending", updatedAt: { lt: new Date(now.getTime() - DECISION_SENDING_STALE_MS) } },
        ],
      },
      data: { status: "dismissed", decidedById: session.userId, decidedAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) return conflict("stale", STALE_TEXT);
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    await audit("decision.dismissed");
    return jsonOk({ status: "dismissed" });
  }

  // ── ONAYLA / REDDET ──
  if (decision.status !== "pending" || decision.version !== input.version) {
    return conflict("stale", STALE_TEXT);
  }
  const body = input.body?.trim() ?? "";
  if (!body) return badRequest({ body: "Misafire gidecek mesaj boş olamaz." });
  const approve = input.action === "approve";
  const time = approve ? parseHostTime(input.time) : null;
  if (approve && TEXT_DECISION_KINDS.has(decision.kind) && !time) return badRequest({ time: "Geçerli bir saat seçin." });
  // Standardın yanlış tarafındaki onay ("16:00 erken giriş" — standart 15:00) misafiri yanıltır; arayüz göndermez, uç da kabul etmez.
  const standard = decision.kind === "early_checkin" ? conversation.property.checkInTime : conversation.property.checkOutTime;
  if (approve && time && timeOnRightSide(decision.kind, time, standard) === false) {
    return badRequest({
      time:
        decision.kind === "early_checkin"
          ? `Bu saat standart giriş saatinizden (${standard}) erken değil.`
          : `Bu saat standart çıkış saatinizden (${standard}) geç değil.`,
    });
  }

  // Yeniden doğrulama — göndermeden HEMEN önce.
  if (/cancel/i.test(conversation.reservation?.status ?? "")) {
    return conflict("reservation_cancelled", "Rezervasyon iptal edilmiş; misafire karar mesajı gönderilmedi.");
  }
  const tz = orgTimezone(conversation.property.organization.timezone);
  // Gün CANLI (rezervasyon değiştiyse kartın kayıtlı günü değil, bugünkü tarihi — sayfadaki kartla aynı kural).
  const res = conversation.reservation;
  const dayKey = liveDecisionDayKey(
    { kind: decision.kind, dayKey: decision.dayKey, reservationId: decision.reservationId },
    res
      ? { id: res.id, arrivalKey: calendarDateOf(res.arrivalDate, tz).key, departureKey: calendarDateOf(res.departureDate, tz).key }
      : null,
  );
  if (dayKey && dayKey < todayKey(now, tz)) {
    return conflict("expired", "Talep edilen gün geçti; misafire karar mesajı gönderilmedi.");
  }
  const requestMessage = await prisma.message.findFirst({
    where: { id: decision.messageId, conversationId: id },
    select: { createdAt: true },
  });
  // Talebin mesajı bulunamazsa (birleştirmede ayıklanmış kopya) çapa kartın açıldığı an — kontrol atlanmaz.
  const anchor = requestMessage?.createdAt ?? decision.createdAt;
  const latestGuest = await prisma.message.findFirst({
    where: { conversationId: id, direction: "inbound", createdAt: { gt: anchor } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latestGuest && latestGuest.id !== input.seenMessageId) {
    return conflict("guest_wrote_again", "Misafir bu talepten sonra yeniden yazdı. Mesajı okuyun, sonra tekrar gönderin.", {
      latestMessageId: latestGuest.id,
    });
  }

  // Olgular değişti mi: kart, sayfayla AYNI kurucudan yeniden kurulur (mesajlar iz dışı). İz yoksa (eski istemci) kontrol atlanır.
  if (input.factsHash) {
    const views = await listConversationDecisions(prisma, { organizationId: session.organizationId, conversationId: id, timeZone: tz, now });
    const view = views.find((v) => v.id === decision.id);
    const ctx = await decisionCardContextFor({
      organizationId: session.organizationId,
      conversation: { ...conversation, messages: [] },
      timeZone: tz,
      now,
      needsEarlyRule: decision.kind === "early_checkin",
    });
    const [fresh] = view ? await buildDecisionCards([view], ctx) : [];
    if (!fresh || fresh.factsHash !== input.factsHash) {
      return conflict("facts_changed", "Bu talebin kontrol listesi siz baktıktan sonra değişti. Güncel hâline bakıp tekrar karar verin.");
    }
  }

  // Kilit (CAS): yalnız bu sürümdeki BEKLEYEN kart gönderime geçer. Onayın saati ve karar veren HEMEN yazılır (gönderim sürerken
  // komşu konaklamanın kartı / erken giriş kontrolü onu görür — ret saat taşımaz; kesin hatada geri alınır).
  const lock = await prisma.decisionRequest.updateMany({
    where: { id: decision.id, organizationId: session.organizationId, status: "pending", version: input.version },
    data: { status: "sending", decidedTime: time, decidedById: session.userId, decidedAt: now, version: { increment: 1 } },
  });
  if (lock.count !== 1) return conflict("stale", STALE_TEXT);
  const lockedVersion = input.version + 1;
  const reopen = () =>
    prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId: session.organizationId, status: "sending", version: lockedVersion },
      data: { status: "pending", decidedTime: null, decidedById: null, decidedAt: null, version: { increment: 1 } },
    });
  const settle = (status: "approved" | "declined" | "send_unverified", resultMessageId: string | null) =>
    prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId: session.organizationId, status: "sending", version: lockedVersion },
      data: { status, resultMessageId, version: { increment: 1 } },
    });
  // Mesaj misafire ulaşmış OLABİLİR: kart "gönderim doğrulanamadı" (kör tekrar yok — ev sahibi kanaldan bakar).
  const unverified = async (why: string) => {
    const fin = await settle("send_unverified", null).catch(() => ({ count: 0 }));
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [decision.itemId], event: "host_done", now }).catch(() => {});
    }
    await audit(approve ? "decision.approved" : "decision.declined", { delivery: "unverified", why, ...(fin.count === 1 ? {} : { finalize: "lost" }) });
    return NextResponse.json({ code: "send_unverified", error: UNVERIFIED_TEXT }, { status: 502 });
  };

  let sent: Awaited<ReturnType<typeof sendHostMessage>>;
  try {
    sent = await sendHostMessage({
      organizationId: session.organizationId,
      conversation,
      body,
      claimBody: body,
      senderName: session.name,
      // Kurucu kararı 10-07 (Sabah Kararları 62 / 6): karar mesajı raporda YALNIZ "ev sahibi yazdı" — varsayılanda "yapay zekâ
      // destekli" etiketi YOK. (Ayarlardan açılan etiket — 62 / 7 — yalnız düzenlenmemiş metne yazılır: `edited` bunun için gelir.)
      aiAssisted: false,
      idempotencyKey: `decision:${decision.id}:v${lockedVersion}`,
      strictIdempotency: true,
    });
  } catch (err) {
    // Gönderim sırasında hata: teslim olmuş ama kaydedilememiş olabilir (kanal kabul etti, veritabanı yazamadı) → yeniden açmak
    // ikinci bir mesaja yol açardı.
    void reportError(`host-decisions send org=${session.organizationId}`, err);
    return unverified("error");
  }

  if (sent.status === "failed_ambiguous") return unverified("ambiguous");
  // Aynı metin az önce gitti / hâlâ gidiyor (başka yoldan): misafir onu görmüş olabilir.
  if (sent.status === "duplicate") return unverified("duplicate");
  // Bu kilidin kimliğiyle kuyrukta başka bir içerik var: o gönderim sürüyor olabilir.
  if (sent.status === "idempotency_conflict") return unverified("idempotency_conflict");

  if (sent.status === "sent" || sent.status === "queued") {
    const resultMessageId = sent.message?.id ?? null;
    const fin = await settle(approve ? "approved" : "declined", resultMessageId);
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    // Mesaj gitti; kart o arada başka bir yoldan değiştiyse (yarıda kalan gönderim sayılıp kapatıldı) sonuç yine "gitti"dir.
    await audit(approve ? "decision.approved" : "decision.declined", fin.count === 1 ? {} : { finalize: "lost" });
    return jsonOk({ status: approve ? "approved" : "declined", resultMessageId, queued: sent.status === "queued" });
  }

  // Kesin olumsuz sonuçlar: hiçbir şey gitmedi → kart yeniden açılır (ev sahibi düzeltip tekrar dener). Yeni sürüm yanıtta döner:
  // istemci bir sonraki denemede onu gönderir (yoksa her yeniden deneme önce "kart değişti" ile düşerdi).
  const reopened = await reopen();
  const version = reopened.count === 1 ? lockedVersion + 1 : undefined;
  switch (sent.status) {
    case "not_connected":
      return NextResponse.json(
        { error: "Kanal hesabınız bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlantınızı kurun.", version },
        { status: 502 },
      );
    case "claim_unavailable":
      return NextResponse.json({ error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin.", version }, { status: 503 });
    case "failed_definitive":
      return NextResponse.json(
        {
          error: providerErrorMessageFromText(sent.error, "Mesaj gönderilemedi. Lütfen kısa bir süre sonra tekrar deneyin."),
          version,
        },
        { status: 502 },
      );
  }
});
