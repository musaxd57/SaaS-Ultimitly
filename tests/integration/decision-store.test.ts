import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  listConversationDecisions,
  openDecisionCounts,
  openDecisionsForOrg,
  openTurnDecisions,
  resolveDecisionByPolicy,
  claimDecisionNotification,
  releaseDecisionNotification,
} from "@/lib/decisions/store";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KALICI KAYIT (migration 59). Kimlik tekilliği, yeni istek eskisini kapatır, "ev sahibi yazdı" türetmesi
// (karar kartıyla giden mesaj HARİÇ), rozet / pano sayıları, kiracı yalıtımı, bildirim talebi, onaylı geç çıkışın erken giriş
// kontrolüne girmesi (yalnız sıkılaştırır).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const TZ = "Europe/Istanbul";
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: TZ } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const arrival = utcDay(1);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ada",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 2 * DAY),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "r-1" },
  });
  const msg = (body: string, minutesAgo: number, direction: "inbound" | "outbound" = "inbound", authorType?: string) =>
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction,
        senderName: direction === "inbound" ? "Ada" : "Ev Sahibi",
        body,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
        ...(authorType ? { authorType } : {}),
      },
    });
  return { org, property, reservation, conversation, msg, arrivalKey: arrival.toISOString().slice(0, 10) };
}

describe("karar kaydı", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aynı (konuşma, mesaj, tür) TEK kart — ikinci açma aynı satırı döner, eksik saati doldurur ama dolu saati EZMEZ", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş mümkün mü?", 30);
    const input = {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
    };
    const [a] = await openTurnDecisions(prisma, { ...input, decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: null, dayKey: null }] });
    const [b] = await openTurnDecisions(prisma, {
      ...input,
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ requestedTime: "13:00", dayKey: w.arrivalKey });
    const [c] = await openTurnDecisions(prisma, {
      ...input,
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }],
    });
    expect(c.requestedTime).toBe("13:00");
    expect(await prisma.decisionRequest.count()).toBe(1);
  });

  it("misafir saati değiştirdi (yeni mesaj, aynı tür) → eski BEKLEYEN kart 'yeni istekle değişti', tek açık kart kalır; sonuçlanmış kart dokunulmaz", async () => {
    const w = await world();
    const m1 = await w.msg("13:00'te girebilir miyiz?", 60);
    const m2 = await w.msg("Pardon, 12:00 olur mu?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [old] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    // Aynı konuşmada BAŞKA türden kart etkilenmez.
    const [late] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "late_checkout", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: null }] });
    const [fresh] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m2.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("superseded");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("pending");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("pending");
    // ESKİ mesaj yeniden işlenirse (ör. senkron tekrarı) YENİ kart geri kapanmaz — yalnız kendinden eski kartlar.
    await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("pending");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("superseded");
  });

  it("🚨 'ev sahibi yazdı' türetmesi: talepten sonraki ELLE cevap kartı 'yanıtladınız' yapar; BAŞKA bir kartın karar mesajı yapmaz; otomatik mesaj yapmaz", async () => {
    const w = await world();
    const m = await w.msg("13:00'te girebilir miyiz ve 13:00'te çıkabilir miyiz?", 60);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [early, late] = await openTurnDecisions(prisma, {
      ...base,
      decisions: [
        { kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey },
        { kind: "late_checkout", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: null },
      ],
    });
    // Erken giriş kartıyla giden ev sahibi mesajı.
    const decisionMsg = await w.msg("Erken giriş talebiniz onaylandı.", 20, "outbound", "host");
    await prisma.decisionRequest.update({ where: { id: early.id }, data: { status: "approved", resultMessageId: decisionMsg.id } });
    // Otomatik şablon mesajı (K7) da ev sahibi cevabı DEĞİLDİR.
    await w.msg("Hoş geldiniz!", 15, "outbound", "automation");
    let views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    expect(views.find((v) => v.id === late.id)?.effective).toBe("pending");
    expect(views.find((v) => v.id === early.id)?.effective).toBe("approved");
    // Ev sahibi elle yazdı → bekleyen kart "yanıtladınız" (açık iş sayılmaz).
    await w.msg("Geç çıkışı yarın konuşalım.", 5, "outbound", "host");
    views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    expect(views.find((v) => v.id === late.id)?.effective).toBe("host_replied");
    expect((await openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now: new Date() })).counts.get(w.conversation.id)).toBeUndefined();
  });

  it("rozet ve pano: açık kartlar sayılır; süresi geçen / iptal rezervasyonun kartı sayılmaz; KİRACI YALITIMI", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: null, dayKey: w.arrivalKey }] });
    const counts = await openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now: new Date() });
    expect(counts.counts.get(w.conversation.id)).toBe(1);
    const forOrg = await openDecisionsForOrg(prisma, { organizationId: w.org.id, timeZone: TZ, now: new Date() });
    expect(forOrg.map((d) => d.propertyId)).toEqual([w.property.id]);
    // Başka kiracı bu kartları göremez.
    const other = await prisma.organization.create({ data: { name: "Other" } });
    expect((await openDecisionCounts(prisma, { organizationId: other.id, conversationIds: [w.conversation.id], timeZone: TZ, now: new Date() })).counts.size).toBe(0);
    expect(await openDecisionsForOrg(prisma, { organizationId: other.id, timeZone: TZ, now: new Date() })).toEqual([]);
    expect(await listConversationDecisions(prisma, { organizationId: other.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() })).toEqual([]);
    // Gün geçti → açık değil.
    const future = new Date(Date.now() + 5 * DAY);
    expect((await openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now: future })).counts.size).toBe(0);
    // Rezervasyon iptal → açık değil.
    await prisma.reservation.update({ where: { id: w.reservation.id }, data: { status: "cancelled" } });
    expect((await openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now: new Date() })).counts.size).toBe(0);
  });

  it("🚨 gönderim yarıda kaldı: 'sending' 5 dk'dan eskiyse 'gönderim doğrulanamadı' (rozet + panoda açık iş); taze 'sending' açık iş değil", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş?", 30);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "sending", version: 1 } });
    const counts = () => openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now: new Date() });
    expect((await counts()).counts.size).toBe(0);
    let views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    expect(views[0].effective).toBe("sending");
    await prisma.$executeRaw`UPDATE "DecisionRequest" SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${d.id}`;
    expect((await counts()).counts.get(w.conversation.id)).toBe(1);
    views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    expect(views[0].effective).toBe("send_unverified");
    expect((await openDecisionsForOrg(prisma, { organizationId: w.org.id, timeZone: TZ, now: new Date() })).map((v) => v.id)).toEqual([d.id]);
  });

  it("başka kiracının konuşmasına kart AÇILMAZ (kimlik çakışsa da)", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş?", 30);
    const other = await prisma.organization.create({ data: { name: "Other" } });
    await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: null,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: null, dayKey: null }],
    });
    const out = await openTurnDecisions(prisma, {
      organizationId: other.id,
      conversationId: w.conversation.id,
      reservationId: null,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "09:00", dayKey: null }],
    });
    expect(out).toEqual([]);
    expect((await prisma.decisionRequest.findFirstOrThrow()).organizationId).toBe(w.org.id);
  });

  it("doğrulanmış otomatik onay: kart 'otomatik onaylandı' (onaylı saat yapısal), bekleyen eski kart kapanır", async () => {
    const w = await world();
    const m1 = await w.msg("13:00?", 60);
    const m2 = await w.msg("12:00 olur mu?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [old] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    await resolveDecisionByPolicy(prisma, { ...base, kind: "early_checkin", messageId: m2.id, itemId: null, dayKey: w.arrivalKey, decidedTime: "12:00" });
    const rows = await prisma.decisionRequest.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.find((r) => r.id === old.id)?.status).toBe("superseded");
    expect(rows.find((r) => r.messageId === m2.id)).toMatchObject({ status: "resolved_by_policy", decidedTime: "12:00" });
  });

  it("bildirim talebi tek seferlik; geri alma yalnız kendi damgasını açar", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş?", 30);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: null,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: null, dayKey: null }],
    });
    const t1 = new Date();
    expect(await claimDecisionNotification(prisma, { organizationId: w.org.id, id: d.id, now: t1 })).toBe(true);
    expect(await claimDecisionNotification(prisma, { organizationId: w.org.id, id: d.id, now: new Date() })).toBe(false);
    await releaseDecisionNotification(prisma, { organizationId: w.org.id, id: d.id, claimedAt: new Date(t1.getTime() + 1) });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: d.id } })).notifiedAt).not.toBeNull();
    await releaseDecisionNotification(prisma, { organizationId: w.org.id, id: d.id, claimedAt: t1 });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: d.id } })).notifiedAt).toBeNull();
  });

  it("🚨 onaylanmış GEÇ ÇIKIŞ sonraki misafirin erken giriş kontrolüne girer (yalnız sıkılaştırır): önceki misafir 13:00'e kadar dairede", async () => {
    const w = await world();
    // Bugün çıkan önceki misafir (standart çıkış 11:00) + bugün giren yeni misafir.
    const today = utcDay(0);
    const prev = await prisma.reservation.create({
      data: { propertyId: w.property.id, guestName: "Önceki", arrivalDate: utcDay(-2), departureDate: today, status: "confirmed", channel: "airbnb" },
    });
    const next = await prisma.reservation.create({
      data: { propertyId: w.property.id, guestName: "Yeni", arrivalDate: today, departureDate: utcDay(2), status: "confirmed", channel: "airbnb" },
    });
    const load = () =>
      loadEarlyCheckinFacts({
        organizationId: w.org.id,
        propertyId: w.property.id,
        reservationId: next.id,
        now: new Date(),
        requested: { time: "12:00", sources: 2, conflict: false },
        singleIntent: true,
      });
    expect((await load())?.facts.previousSameDay?.checkoutTime).toBe("11:00");
    const prevConv = await prisma.conversation.create({
      data: { propertyId: w.property.id, reservationId: prev.id, guestIdentifier: "Önceki", channel: "airbnb", externalReservationId: "r-prev" },
    });
    const pm = await prisma.message.create({ data: { conversationId: prevConv.id, direction: "inbound", senderName: "Önceki", body: "13:00'e kadar kalabilir miyiz?" } });
    await prisma.decisionRequest.create({
      data: {
        organizationId: w.org.id,
        conversationId: prevConv.id,
        messageId: pm.id,
        reservationId: prev.id,
        kind: "late_checkout",
        requestedTime: "13:00",
        lang: "tr",
        status: "approved",
        decidedTime: "13:00",
        decidedAt: new Date(),
      },
    });
    expect((await load())?.facts.previousSameDay?.checkoutTime).toBe("13:00");
    // Başka kiracının kaydı sayılmaz; reddedilen / bekleyen geç çıkış sayılmaz.
    await prisma.decisionRequest.updateMany({ data: { status: "declined" } });
    expect((await load())?.facts.previousSameDay?.checkoutTime).toBe("11:00");
  });
});
