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
  claimTurnDecisionForPolicy,
  releasePolicyClaim,
  decisionsForReservations,
} from "@/lib/decisions/store";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { openDecisionsForTurn } from "@/lib/decisions/turn";

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

  it("🚨 CANLI gün: misafir rezervasyonu değiştirdiyse kartın günü rezervasyonun BUGÜNKÜ tarihinden (eski gün metne girmez, süre eski günden dolmaz)", async () => {
    const w = await world();
    const m = await w.msg("13:00'te girebilir miyiz?", 30);
    // Kart DÜNÜN günüyle kaydedilmiş (ör. rezervasyon o zaman dündü); rezervasyon şimdi YARIN.
    const yesterdayKey = utcDay(-1).toISOString().slice(0, 10);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: yesterdayKey }],
    });
    const list = () => listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    let [v] = await list();
    expect(v.id).toBe(d.id);
    expect(v.dayKey).toBe(w.arrivalKey);
    expect(v.effective).toBe("pending");
    // Rezervasyon 3 gün ileri kaydı → kartın günü de.
    const moved = utcDay(4);
    await prisma.reservation.update({ where: { id: w.reservation.id }, data: { arrivalDate: moved, departureDate: new Date(moved.getTime() + 2 * DAY) } });
    [v] = await list();
    expect(v.dayKey).toBe(moved.toISOString().slice(0, 10));
    // Geç çıkış kartının günü çıkış günü; tarih değişikliği kartının günü yok.
    const [late, change] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [
        { kind: "late_checkout", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: null },
        { kind: "date_change", messageId: m.id, itemId: null, requestedTime: null, dayKey: null },
      ],
    });
    const views = await list();
    expect(views.find((x) => x.id === late.id)?.dayKey).toBe(new Date(moved.getTime() + 2 * DAY).toISOString().slice(0, 10));
    expect(views.find((x) => x.id === change.id)?.dayKey).toBeNull();
    // Konuşma BAŞKA bir rezervasyona bağlandıysa kartın kayıtlı günü esas (talep o konaklama içindi).
    const other = await prisma.reservation.create({
      data: { propertyId: w.property.id, guestName: "Ada", arrivalDate: utcDay(20), departureDate: utcDay(22), status: "confirmed", channel: "airbnb" },
    });
    await prisma.conversation.update({ where: { id: w.conversation.id }, data: { reservationId: other.id } });
    [v] = (await list()).filter((x) => x.id === d.id);
    expect(v.dayKey).toBe(yesterdayKey);
    expect(v.effective).toBe("expired");
  });

  it("🚨 gönderimi doğrulanamayan kart: günü geçince ya da rezervasyon iptal edilince açık iş SAYILMAZ (rozet / pano kalıcı kirlenmez)", async () => {
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
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "send_unverified", decidedTime: "13:00" } });
    const counts = (now: Date) => openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id], timeZone: TZ, now });
    expect((await counts(new Date())).counts.get(w.conversation.id)).toBe(1);
    expect((await counts(new Date(Date.now() + 5 * DAY))).counts.size).toBe(0);
    const [late] = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date(Date.now() + 5 * DAY) });
    expect(late.effective).toBe("expired");
    // Yarıda kalmış gönderim (eski "sending") da aynı kural.
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "sending" } });
    await prisma.$executeRaw`UPDATE "DecisionRequest" SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${d.id}`;
    expect((await counts(new Date())).counts.get(w.conversation.id)).toBe(1);
    await prisma.reservation.update({ where: { id: w.reservation.id }, data: { status: "cancelled" } });
    expect((await counts(new Date())).counts.size).toBe(0);
    const [v] = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
    expect(v.effective).toBe("cancelled");
  });

  it("🚨 'ev sahibi yazdı' türetmesi TAVANSIZ: başka konuşmalardaki yüzlerce ev sahibi mesajı bir kartın cevabını gizlemez", async () => {
    const w = await world();
    const m = await w.msg("Erken giriş?", 60);
    const base = { organizationId: w.org.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [d] = await openTurnDecisions(prisma, {
      ...base,
      conversationId: w.conversation.id,
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    // Ev sahibi BU konuşmada cevap yazdı (40 dk önce).
    await w.msg("Bakıyorum, size yazacağım.", 40, "outbound", "host");
    // Başka bir konuşmada daha YENİ 520 ev sahibi mesajı + o konuşmanın da bekleyen kartı.
    const busy = await prisma.conversation.create({
      data: { propertyId: w.property.id, reservationId: w.reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "r-busy" },
    });
    const bm = await prisma.message.create({
      data: { conversationId: busy.id, direction: "inbound", senderName: "Ada", body: "Erken giriş?", createdAt: new Date(Date.now() - 50 * 60_000) },
    });
    await openTurnDecisions(prisma, {
      ...base,
      conversationId: busy.id,
      decisions: [{ kind: "early_checkin", messageId: bm.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    await prisma.message.createMany({
      data: Array.from({ length: 520 }, (_, i) => ({
        conversationId: busy.id,
        direction: "outbound",
        senderName: "Ev Sahibi",
        authorType: "host",
        body: `not ${i}`,
        createdAt: new Date(Date.now() - (30 - i / 100) * 60_000),
      })),
    });
    const counts = await openDecisionCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id, busy.id], timeZone: TZ, now: new Date() });
    expect(counts.counts.get(w.conversation.id)).toBeUndefined();
    expect(counts.counts.get(busy.id)).toBeUndefined();
    const forOrg = await openDecisionsForOrg(prisma, { organizationId: w.org.id, timeZone: TZ, now: new Date() });
    expect(forOrg.map((v) => v.id)).not.toContain(d.id);
  });

  it("🚨 pano en YENİ kartları okur: günü geçmiş 60 eski kart yeni talebi tavanın dışına itmez", async () => {
    const w = await world();
    const past = await prisma.reservation.create({
      data: { propertyId: w.property.id, guestName: "Eski", arrivalDate: utcDay(-10), departureDate: utcDay(-8), status: "confirmed", channel: "airbnb" },
    });
    const oldConv = await prisma.conversation.create({
      data: { propertyId: w.property.id, reservationId: past.id, guestIdentifier: "Eski", channel: "airbnb", externalReservationId: "r-old" },
    });
    const oldMsgs = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        prisma.message.create({
          data: { conversationId: oldConv.id, direction: "inbound", senderName: "Eski", body: `Erken giriş ${i}?`, createdAt: new Date(Date.now() - (12 * DAY - i * 60_000)) },
        }),
      ),
    );
    await prisma.decisionRequest.createMany({
      data: oldMsgs.map((m, i) => ({
        organizationId: w.org.id,
        conversationId: oldConv.id,
        messageId: m.id,
        reservationId: past.id,
        kind: "early_checkin",
        lang: "tr",
        dayKey: utcDay(-10).toISOString().slice(0, 10),
        createdAt: new Date(Date.now() - (12 * DAY - i * 60_000)),
      })),
    });
    const m = await w.msg("13:00'te girebilir miyiz?", 5);
    const [fresh] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    const forOrg = await openDecisionsForOrg(prisma, { organizationId: w.org.id, timeZone: TZ, now: new Date(), limit: 50 });
    expect(forOrg.map((v) => v.id)).toEqual([fresh.id]);
  });

  it("🚨 otomatik onay talebi: BEKLEYEN kart sahiplenilir; ev sahibinin işlediği kart (gönderiliyor / reddedildi / kapatıldı / doğrulanamadı) sahiplenilemez; geri alma kesin hatada 'bekliyor', belirsizde 'doğrulanamadı'", async () => {
    const w = await world();
    const m = await w.msg("13:00?", 30);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    const claim = () =>
      claimTurnDecisionForPolicy(prisma, {
        organizationId: w.org.id,
        conversationId: w.conversation.id,
        kind: "early_checkin",
        messageIds: [m.id],
        decidedTime: "13:00",
        now: new Date(),
      });
    for (const status of ["sending", "declined", "dismissed", "send_unverified", "approved"]) {
      await prisma.decisionRequest.update({ where: { id: d.id }, data: { status } });
      expect(await claim(), status).toEqual({ ok: false, claimed: null });
    }
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "pending" } });
    const ok = await claim();
    expect(ok.ok).toBe(true);
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "resolved_by_policy", decidedTime: "13:00" });
    await releasePolicyClaim(prisma, { organizationId: w.org.id, id: d.id, version: ok.claimed!.version, outcome: "reopen" });
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "pending", decidedTime: null });
    const again = await claim();
    await releasePolicyClaim(prisma, { organizationId: w.org.id, id: d.id, version: again.claimed!.version, outcome: "unverified" });
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "send_unverified", decidedTime: "13:00" });
    // Kart yoksa engel değil (otomatik onay kartı sonra kendisi yazar).
    expect(
      await claimTurnDecisionForPolicy(prisma, {
        organizationId: w.org.id,
        conversationId: w.conversation.id,
        kind: "early_checkin",
        messageIds: ["yok"],
        decidedTime: "13:00",
        now: new Date(),
      }),
    ).toEqual({ ok: true, claimed: null });
  });

  it("yerine geçilmiş (superseded) kart turun kartı sayılmaz: otomatik onay onu 'ev sahibinin kartı' diye engellemez", async () => {
    const w = await world();
    const m = await w.msg("13:00?", 30);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
    });
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "superseded" } });
    expect(
      await claimTurnDecisionForPolicy(prisma, {
        organizationId: w.org.id,
        conversationId: w.conversation.id,
        kind: "early_checkin",
        messageIds: [m.id],
        decidedTime: "13:00",
        now: new Date(),
      }),
    ).toEqual({ ok: true, claimed: null });
  });

  it("deterministik saat yedeği turda İKİ saatli tür varken yazılmaz ('erken gelip daha uzun kalabilir miyiz? 11:30' — saat hangisinin?)", async () => {
    const w = await world();
    const m = await w.msg("Erken gelip daha uzun kalabilir miyiz? Saat 11:30 gibi.", 5);
    const out = await openDecisionsForTurn(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservation: { id: w.reservation.id, arrivalDate: w.reservation.arrivalDate, departureDate: w.reservation.departureDate },
      timeZone: TZ,
      guestTexts: [m.body],
      policy: {
        declared: { asked: "early_checkin", stance: "none" },
        replyIntent: "late_checkout",
        stayTimes: { checkIn: "15:00", checkOut: "11:00" },
      },
      items: [],
      lastMessageId: m.id,
      turnMessageIds: [m.id],
      language: "tr",
      now: new Date(),
    });
    const timed = out.filter((d) => d.kind === "early_checkin" || d.kind === "late_checkout");
    expect(timed.map((d) => [d.kind, d.requestedTime]).sort()).toEqual([
      ["early_checkin", null],
      ["late_checkout", null],
    ]);
  });

  it("komşu konaklamanın kararı GÖNDERİLİRKEN de görünür (kilit onayın saatini yazar)", async () => {
    const w = await world();
    const m = await w.msg("Geç çıkış 13:00?", 30);
    const [d] = await openTurnDecisions(prisma, {
      organizationId: w.org.id,
      conversationId: w.conversation.id,
      reservationId: w.reservation.id,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "late_checkout", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: null }],
    });
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "sending", decidedTime: "13:00" } });
    const views = await decisionsForReservations(prisma, {
      organizationId: w.org.id,
      reservationIds: [w.reservation.id],
      kinds: ["late_checkout"],
      timeZone: TZ,
      now: new Date(),
    });
    expect(views.map((v) => [v.effective, v.decidedTime])).toEqual([["sending", "13:00"]]);
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
    // Onay gönderilirken de (kilit onay saatini yazar) — temkin: misafire ulaşıyor olabilir.
    await prisma.decisionRequest.updateMany({ data: { status: "sending" } });
    expect((await load())?.facts.previousSameDay?.checkoutTime).toBe("13:00");
    // Başka kiracının kaydı sayılmaz; reddedilen / bekleyen geç çıkış sayılmaz.
    await prisma.decisionRequest.updateMany({ data: { status: "declined" } });
    expect((await load())?.facts.previousSameDay?.checkoutTime).toBe("11:00");
  });
  // -------------------------------------------------------------------------
  // Y4 (Codex 10-07, 15c8663): "eski kart" = kaynak MESAJIN sırası, kartın açılış anı DEĞİL.
  // -------------------------------------------------------------------------
  it("🚨 Y4 yavaş tur: yeni talebin kartı ÖNCE açıldı, eski talebin kartı SONRA → yeni kart beklemede kalır, eski kart kapanır", async () => {
    const w = await world();
    const m1 = await w.msg("13:00'te girebilir miyiz?", 60);
    const m2 = await w.msg("Pardon, 12:00 olur mu?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [fresh] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m2.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
    const [stale] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("pending"); // ⬅️ ARIZADA "superseded"
    expect(stale.status).toBe("superseded");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("superseded");
  });

  it("🚨 Y4 eşit milisaniye: iki kart aynı anda açılsa da yalnız yeni MESAJIN kartı beklemede kalır", async () => {
    const w = await world();
    const m1 = await w.msg("13:00?", 60);
    const m2 = await w.msg("12:00?", 30);
    const at = new Date();
    const mk = (messageId: string, t: string) =>
      prisma.decisionRequest.create({
        data: { organizationId: w.org.id, conversationId: w.conversation.id, messageId, kind: "early_checkin", requestedTime: t, lang: "tr", createdAt: at },
      });
    const newer = await mk(m2.id, "12:00");
    await mk(m1.id, "13:00");
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    // Eski mesaj yeniden işlendi (aynı kart döner) → yeni kartı KAPATMAZ, kendisi kapanır.
    await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    const rows = await prisma.decisionRequest.findMany();
    expect(rows.find((r) => r.id === newer.id)?.status).toBe("pending");
    expect(rows.find((r) => r.messageId === m1.id)?.status).toBe("superseded");
  });

  it("🚨 Y4 otomatik onay ESKİ mesaja: sonradan gelen başka saatli talebin kartı beklemede kalır (sırasız kapanmaz)", async () => {
    const w = await world();
    const m1 = await w.msg("13:00 olur mu?", 60);
    const m2 = await w.msg("Aslında 12:00 olabilir mi?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [later] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m2.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
    await resolveDecisionByPolicy(prisma, { ...base, kind: "early_checkin", messageId: m1.id, itemId: null, dayKey: w.arrivalKey, decidedTime: "13:00" });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("pending"); // ⬅️ ARIZADA "superseded"
    expect((await prisma.decisionRequest.findFirstOrThrow({ where: { messageId: m1.id } })).status).toBe("resolved_by_policy");
  });

  it("🚨 Y4 iki talep AYNI milisaniyede yazıldı: sıra mesaj kimliğiyle kesinleşir, yalnız sonrakinin kartı bekler", async () => {
    const w = await world();
    const at = new Date(Date.now() - 30 * 60_000);
    const m1 = await prisma.message.create({ data: { conversationId: w.conversation.id, direction: "inbound", senderName: "Ada", body: "13:00?", createdAt: at } });
    const m2 = await prisma.message.create({ data: { conversationId: w.conversation.id, direction: "inbound", senderName: "Ada", body: "12:00?", createdAt: at } });
    const [first, second] = m1.id < m2.id ? [m1, m2] : [m2, m1];
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [later] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: second.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
    const [earlier] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: first.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("pending");
    expect(earlier.status).toBe("superseded");
  });

  it("KONTROL (Y4): sonuçlanmış eski kart, yeni talep açılınca dokunulmaz; yeni kart beklemede", async () => {
    const w = await world();
    const m1 = await w.msg("13:00?", 60);
    const m2 = await w.msg("12:00?", 30);
    const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
    const [old] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
    await prisma.decisionRequest.update({ where: { id: old.id }, data: { status: "declined" } });
    const [fresh] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m2.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
    expect(fresh.status).toBe("pending");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("declined");
  });
});
