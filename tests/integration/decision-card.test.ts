import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { listConversationDecisions } from "@/lib/decisions/store";
import {
  buildDecisionCards,
  decisionLinkedItemIds,
  neighborDecidedTimes,
  requestQuoteOf,
  resolvedDecisionRows,
} from "@/lib/decisions/card";
import { heldRequestsByConversation, listConversationItems, openItemCounts } from "@/lib/conversation-items/store";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { todayKey } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KART VERİSİ + ÖĞELERLE BİRLİKTE YAŞAM (UX turu 1 bulguları, 10-02 gece).
//  · Aynı gün devir: önceki misafirin geç çıkış kararı erken giriş kartında, sonraki misafirin erken giriş kararı geç çıkış
//    kartında görünür (kurucu: "çıkış yapacak kişinin, girecek kişinin saatine bakacak") — kiracı kapsamlı.
//  · Karar kartında otomatik onaya özgü satır yok; varıştan önceki günlerde hazırlık satırı BİLGİ (uyarı sayısını şişirmez).
//  · Aynı talep iki kez sayılmaz: karta bağlı öğe "açık iş" rozetinde / panoda / "Açık işler" kartında ikinci kez yok.
//  · Karar kartıyla giden mesaj YALNIZ kendi talebini kapatır; aynı turun öteki öğesi (iade) açık kalır.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const TZ = "Europe/Istanbul";
// Günler mülkün diliminde sayılır (UTC gece yarısı İstanbul'da ertesi gündür — testin saatine bağlı kalmasın).
const utcDay = (offset: number) => {
  const [y, m, d] = todayKey(new Date(), TZ).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset));
};

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: TZ } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const stay = (arrival: number, departure: number, guest: string) =>
    prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: guest,
        arrivalDate: utcDay(arrival),
        departureDate: utcDay(departure),
        status: "confirmed",
        channel: "airbnb",
      },
    });
  const conv = (reservationId: string, guest: string) =>
    prisma.conversation.create({
      data: { propertyId: property.id, reservationId, guestIdentifier: guest, channel: "airbnb", externalReservationId: `r-${guest}` },
    });
  const prev = await stay(-2, 1, "Önceki");
  const cur = await stay(1, 3, "Ada");
  const next = await stay(3, 5, "Sonraki");
  const prevConv = await conv(prev.id, "Önceki");
  const curConv = await conv(cur.id, "Ada");
  const nextConv = await conv(next.id, "Sonraki");
  const msg = (conversationId: string, body: string, minutesAgo: number, direction: "inbound" | "outbound" = "inbound") =>
    prisma.message.create({
      data: {
        conversationId,
        direction,
        senderName: direction === "inbound" ? "Misafir" : "Ev Sahibi",
        authorType: direction === "inbound" ? "guest" : "host",
        body,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
  const decision = (
    conversationId: string,
    reservationId: string,
    messageId: string,
    kind: string,
    over: { status?: string; requestedTime?: string | null; decidedTime?: string | null; dayKey?: string | null; organizationId?: string; itemId?: string } = {},
  ) =>
    prisma.decisionRequest.create({
      data: {
        organizationId: over.organizationId ?? org.id,
        conversationId,
        messageId,
        reservationId,
        kind,
        lang: "tr",
        status: over.status ?? "pending",
        requestedTime: over.requestedTime === undefined ? "13:00" : over.requestedTime,
        decidedTime: over.decidedTime ?? null,
        dayKey: over.dayKey === undefined ? null : over.dayKey,
        ...(over.itemId ? { itemId: over.itemId } : {}),
        ...(over.status && over.status !== "pending" ? { decidedAt: new Date() } : {}),
      },
    });
  const ctx = (conversationId: string) => ({
    organizationId: org.id,
    property: { id: property.id, checkInTime: "15:00", checkOutTime: "11:00" },
    reservationId: cur.id,
    stay: { arrivalDate: cur.arrivalDate, departureDate: cur.departureDate },
    messages: [] as { id: string; direction: string; createdAt: Date; body?: string | null }[],
    timeZone: TZ,
    now: new Date(),
    adjacency: { previousSameDay: true, nextSameDay: true },
    stayEdgeLines: [],
    earlyRule: null,
    conversationId,
  });
  return { org, property, prev, cur, next, prevConv, curConv, nextConv, msg, decision, ctx };
}

describe("kart verisi — komşu konaklamanın kararı (aynı gün devir)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 erken giriş kartı önceki misafirin ONAYLI geç çıkışını ve BEKLEYEN talebini söyler; geç çıkış kartı sonraki misafirin erken girişini — kiracı kapsamlı", async () => {
    const w = await world();
    const mPrev = await w.msg(w.prevConv.id, "Çıkışı 13:00'e uzatabilir miyiz?", 300);
    const mCur = await w.msg(w.curConv.id, "13:00'te girebilir miyiz? Ayrıca 14:00'te çıkabilir miyiz?", 60);
    const mNext = await w.msg(w.nextConv.id, "12:00'de girebilir miyiz?", 30);
    await w.decision(w.prevConv.id, w.prev.id, mPrev.id, "late_checkout", { status: "approved", decidedTime: "13:00" });
    await w.decision(w.curConv.id, w.cur.id, mCur.id, "early_checkin", { requestedTime: "13:00" });
    await w.decision(w.curConv.id, w.cur.id, mCur.id, "late_checkout", { requestedTime: "14:00" });
    const nextDecision = await w.decision(w.nextConv.id, w.next.id, mNext.id, "early_checkin", { requestedTime: "12:00" });
    // Başka kiracının satırı (aynı rezervasyon kimliğiyle) ASLA görünmez.
    const other = await prisma.organization.create({ data: { name: "Other" } });
    await w.decision(w.nextConv.id, w.next.id, mCur.id, "early_checkin", { status: "approved", decidedTime: "08:00", organizationId: other.id });

    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    let cards = await buildDecisionCards(views, w.ctx(w.curConv.id));
    const early = cards.find((c) => c.kind === "early_checkin")!;
    const late = cards.find((c) => c.kind === "late_checkout")!;
    expect(early.lines).toContainEqual({ ok: true, info: true, text: "Önceki misafirin geç çıkışı onaylandı: 13:00" });
    // Kararın satırı "beklenen çıkış" satırının HEMEN altında (o saatin nedeni) — ve beklenen çıkış onaylı saati taşır.
    const expectedAt = early.lines.findIndex((l) => l.text.startsWith("Önceki misafirin beklenen çıkışı"));
    expect(early.lines[expectedAt].text).toContain("13:00");
    expect(early.lines[expectedAt + 1].text).toBe("Önceki misafirin geç çıkışı onaylandı: 13:00");
    // Sağ kutu (devir) aynı saati okur; sonraki misafirin talebi henüz karar değil.
    const neighborInput = {
      organizationId: w.org.id,
      propertyId: w.property.id,
      reservationId: w.cur.id,
      stay: { arrivalDate: w.cur.arrivalDate, departureDate: w.cur.departureDate },
      timeZone: TZ,
      now: new Date(),
    };
    expect(await neighborDecidedTimes(neighborInput)).toEqual({ previousLateCheckout: "13:00", nextEarlyCheckin: null });
    expect(await neighborDecidedTimes({ ...neighborInput, organizationId: other.id })).toEqual({ previousLateCheckout: null, nextEarlyCheckin: null });
    expect(late.lines).toContainEqual({
      ok: false,
      text: "Aynı gün gelen misafirin 12:00 erken giriş talebi de karar bekliyor — ikisini birlikte değerlendirin.",
    });
    expect(JSON.stringify(late.lines)).not.toContain("08:00");

    // Sonraki misafire 13:00 erken giriş onaylandı → 14:00 geç çıkış onunla ÇAKIŞIR (açık söylenir).
    await prisma.decisionRequest.update({ where: { id: nextDecision.id }, data: { status: "approved", decidedTime: "13:00", decidedAt: new Date() } });
    cards = await buildDecisionCards(views, w.ctx(w.curConv.id));
    expect((await neighborDecidedTimes(neighborInput)).nextEarlyCheckin).toBe("13:00");
    expect(cards.find((c) => c.kind === "late_checkout")!.lines).toContainEqual({
      ok: false,
      text: "İstenen çıkış (14:00), aynı gün gelen misafire onaylanan erken girişten (13:00) sonra.",
    });
  });

  it("önceki misafirin geç çıkış talebi BEKLİYORSA erken giriş kartı ikisini birlikte değerlendirmeyi söyler", async () => {
    const w = await world();
    const mPrev = await w.msg(w.prevConv.id, "Geç çıkış?", 300);
    const mCur = await w.msg(w.curConv.id, "13:00'te girebilir miyiz?", 60);
    await w.decision(w.prevConv.id, w.prev.id, mPrev.id, "late_checkout", { requestedTime: "12:30", dayKey: utcDay(1).toISOString().slice(0, 10) });
    await w.decision(w.curConv.id, w.cur.id, mCur.id, "early_checkin");
    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    const [card] = await buildDecisionCards(views, w.ctx(w.curConv.id));
    expect(card.lines).toContainEqual({
      ok: false,
      text: "Önceki misafirin 12:30 geç çıkış talebi de karar bekliyor — ikisini birlikte değerlendirin.",
    });
  });

  it("karar kartı görünümü: otomatik onay kuralı satırı YOK; varış bugün değilken 'varış bugün değil' ve açık temizlik BİLGİDİR", async () => {
    const w = await world();
    const mCur = await w.msg(w.curConv.id, "13:00'te girebilir miyiz?", 60);
    await w.decision(w.curConv.id, w.cur.id, mCur.id, "early_checkin");
    // Varış günü (yarın) için açık çıkış temizliği görevi.
    await prisma.task.create({
      data: {
        propertyId: w.property.id,
        reservationId: w.prev.id,
        type: "cleaning",
        title: "Çıkış temizliği",
        status: "todo",
        origin: "system",
        dueAt: utcDay(1),
      },
    });
    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    const [card] = await buildDecisionCards(views, w.ctx(w.curConv.id));
    const texts = card.lines.map((l) => l.text);
    expect(texts.some((t) => /Erken giriş kuralı kapalı/.test(t))).toBe(false);
    expect(card.lines).toContainEqual({ ok: true, info: true, text: "Varış bugün değil; temizlik durumu varış günü netleşir." });
    expect(card.lines.find((l) => /Temizlik henüz bitti olarak işaretlenmedi/.test(l.text))).toMatchObject({ ok: true, info: true });
  });

  it("talep alıntısı: yalnız misafirin mesajından, tek satır, uzunsa kırpılır", async () => {
    expect(requestQuoteOf("  13:00'te\n\ngirebilir   miyiz?  ")).toBe("13:00'te girebilir miyiz?");
    expect(requestQuoteOf("")).toBeNull();
    expect(requestQuoteOf(null)).toBeNull();
    const long = requestQuoteOf("a".repeat(500))!;
    expect(Array.from(long)).toHaveLength(221);
    expect(long.endsWith("…")).toBe(true);
    // Kod noktası sınırında (emoji yarıdan bölünmez).
    expect(requestQuoteOf("😀".repeat(300))!.startsWith("😀")).toBe(true);
    expect(Array.from(requestQuoteOf("😀".repeat(300))!)).toHaveLength(221);

    const w = await world();
    const mCur = await w.msg(w.curConv.id, "Yarın 13:00'te\ngirebilir miyiz?", 60);
    await w.decision(w.curConv.id, w.cur.id, mCur.id, "early_checkin");
    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    const ctx = { ...w.ctx(w.curConv.id), messages: [{ id: mCur.id, direction: "inbound", createdAt: mCur.createdAt, body: mCur.body }] };
    const [card] = await buildDecisionCards(views, ctx);
    expect(card.requestQuote).toBe("Yarın 13:00'te girebilir miyiz?");
  });

  it("sonuç satırları: onaylandı / otomatik onaylandı saatle, reddedildi / kapatıldı saatsiz; en yeni önce, en çok 3; bekleyen yok", async () => {
    const w = await world();
    const m = await w.msg(w.curConv.id, "?", 60);
    const mk = async (kind: string, status: string, decidedTime: string | null, minutesAgo: number) => {
      const d = await w.decision(w.curConv.id, w.cur.id, (await w.msg(w.curConv.id, kind, minutesAgo + 1)).id, kind, { status, decidedTime });
      await prisma.decisionRequest.update({ where: { id: d.id }, data: { decidedAt: new Date(Date.now() - minutesAgo * 60_000) } });
      return d;
    };
    await mk("early_checkin", "approved", "12:30", 50);
    await mk("late_checkout", "declined", null, 40);
    await mk("early_checkin", "resolved_by_policy", "13:00", 30);
    await mk("late_checkout", "dismissed", null, 20);
    await w.decision(w.curConv.id, w.cur.id, m.id, "early_checkin");
    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    const rows = resolvedDecisionRows(views, TZ);
    expect(rows.map((r) => r.outcome)).toEqual(["Kapatıldı", "Otomatik onaylandı · 13:00", "Reddedildi"]);
    expect(rows.map((r) => r.tone)).toEqual(["muted", "success", "muted"]);
  });
});

describe("öğelerle birlikte yaşam — aynı talep iki kez sayılmaz, karar mesajı yalnız kendi talebini kapatır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function turn() {
    const w = await world();
    const m = await w.msg(w.curConv.id, "13:00'te girebilir miyiz? Bir de temizlik ücretini iade eder misiniz?", 120);
    const mkItem = (kind: string) =>
      prisma.conversationItem.create({
        data: { organizationId: w.org.id, conversationId: w.curConv.id, messageId: m.id, kind, sensitivity: "sensitive", sources: "lexical", status: "pending_host" },
      });
    const earlyItem = await mkItem("early_checkin");
    const refundItem = await mkItem("cancellation_refund");
    const d = await w.decision(w.curConv.id, w.cur.id, m.id, "early_checkin", { itemId: earlyItem.id, dayKey: utcDay(1).toISOString().slice(0, 10) });
    return { w, m, earlyItem, refundItem, d };
  }

  it("🚨 karar kartıyla giden mesaj iade öğesini 'yanıtladınız' YAPMAZ (bayrak açık); bayrak kapalıyken eski davranış (her ev sahibi mesajı)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const { w, earlyItem, refundItem, d } = await turn();
    const sent = await w.msg(w.curConv.id, "Erken giriş talebiniz onaylandı.", 10, "outbound");
    await prisma.decisionRequest.update({ where: { id: d.id }, data: { status: "approved", decidedTime: "13:00", resultMessageId: sent.id } });
    await prisma.conversationItem.update({ where: { id: earlyItem.id }, data: { status: "done" } });
    let items = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.curConv.id });
    expect(items.find((i) => i.id === refundItem.id)?.effective).toBe("pending_host");
    expect((await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.curConv.id] })).get(w.curConv.id)).toBe(1);

    vi.stubEnv("HOST_DECISIONS_ENABLED", "");
    items = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.curConv.id });
    expect(items.find((i) => i.id === refundItem.id)?.effective).toBe("host_replied");
    expect((await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.curConv.id] })).get(w.curConv.id)).toBeUndefined();

    // Ev sahibinin ELLE yazdığı mesaj (karar mesajı değil) bayrak açıkken de öğeleri "yanıtladınız" yapar (bugünkü kural).
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    await w.msg(w.curConv.id, "İadeyi kontrol ediyorum.", 5, "outbound");
    items = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.curConv.id });
    expect(items.find((i) => i.id === refundItem.id)?.effective).toBe("host_replied");
  });

  it("açık karta bağlı öğe: rozet ve pano onu İKİNCİ kez saymaz; sayfa kartında gizlenir; öteki öğe (iade) kalır", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const { w, earlyItem, refundItem } = await turn();
    expect((await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.curConv.id] })).get(w.curConv.id)).toBe(2);
    expect(
      (await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.curConv.id], excludeItemIds: [earlyItem.id] })).get(w.curConv.id),
    ).toBe(1);
    const held = await heldRequestsByConversation(prisma, {
      organizationId: w.org.id,
      propertyIds: [w.property.id],
      since: new Date(Date.now() - 7 * DAY),
      excludeItemIds: [earlyItem.id],
    });
    expect(held.map((h) => h.kinds)).toEqual([["cancellation_refund"]]);

    const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.curConv.id, timeZone: TZ, now: new Date() });
    const linked = decisionLinkedItemIds(views);
    expect(linked.has(earlyItem.id)).toBe(true);
    expect(linked.has(refundItem.id)).toBe(false);

    // Pano: karar satırı + YALNIZ iade için bırakılan istek satırı (erken giriş iki kez görünmez).
    const rows = await findAttentionItems(w.org.id);
    const forConv = rows.filter((r) => r.href.includes(w.curConv.id));
    expect(forConv.map((r) => r.kind).sort()).toEqual(["decision_pending", "held_request"]);
    expect(forConv.find((r) => r.kind === "held_request")?.requestKinds).toEqual(["cancellation_refund"]);
  });

  it("KONTROL — yalnız karar öğesi varken pano TEK satır (karar); bayrak kapalıyken eski hâl (bırakılan istek)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const { w, refundItem } = await turn();
    await prisma.conversationItem.delete({ where: { id: refundItem.id } });
    let forConv = (await findAttentionItems(w.org.id)).filter((r) => r.href.includes(w.curConv.id));
    expect(forConv.map((r) => r.kind)).toEqual(["decision_pending"]);
    vi.stubEnv("HOST_DECISIONS_ENABLED", "");
    forConv = (await findAttentionItems(w.org.id)).filter((r) => r.href.includes(w.curConv.id));
    expect(forConv.map((r) => r.kind)).toEqual(["held_request"]);
  });
});
