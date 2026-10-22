import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertTurnItems } from "@/lib/conversation-items/store";
import { buildItemsForMessage, requestOrdinals } from "@/lib/conversation-items/core";
import { planItemsTurn } from "@/lib/conversation-items/flow";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(async () => ({ ok: true })) } }));

// ---------------------------------------------------------------------------
// Migration 84 (kurucu 10-23 D: "evet, kanıtla") — aynı mesajda aynı türden ikinci istek AYRI öğe (`ordinal`) + kısa konu etiketi
// (`topic`, kurucu C). Pinlenen: anahtar açıkken iki satır ve etiketler; YENİDEN İŞLEME satır çoğaltmaz (aynı sıra, ters sıra, başka
// sözcük); etiket yalnız ilk yazımda; misafir silme talebi etiketi boşaltır (öğe — ev sahibinin iş kaydı — kalır); anahtar kapalıyken
// bugünkü kural (tür başına tek satır, sıra 0, etiket yok).
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const T0 = new Date("2026-10-20T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const BODY = "Havuz kaçta kapanıyor? Sauna var mı?";

const understood = (reqs: { q: string; o: string }[]) =>
  parseUnderstanding(
    {
      language: "tr",
      requests: reqs.map((r) => ({ intent: "amenities", message: 1, query_tr: r.q, query_original: r.o })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true },
  );
const HAVUZ = { q: "havuz kaçta kapanıyor", o: "Havuz kaçta kapanıyor?" };
const SAUNA = { q: "sauna var mı", o: "Sauna var mı?" };

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  ({ orgId, propertyId } = await makeOrgWithProperty());
});
afterEach(() => vi.unstubAllEnvs());

async function seed() {
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: `res-${Math.random()}`, status: "new", lastMessageAt: at(0) },
  });
  const m = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", body: BODY, senderName: "Alex", authorType: "guest", createdAt: at(0) },
  });
  return { conversationId: conversation.id, messageId: m.id };
}

async function turn(conversationId: string, messageId: string, reqs: { q: string; o: string }[], min: number) {
  return planItemsTurn(prisma, {
    organizationId: orgId,
    conversationId,
    history: [{ id: messageId, direction: "inbound", body: BODY }],
    guestMessage: BODY,
    understanding: understood(reqs),
    expectedMessageIds: [messageId],
    now: at(min),
  });
}

const rowsOf = (conversationId: string) =>
  prisma.conversationItem.findMany({ where: { conversationId }, orderBy: [{ ordinal: "asc" }], select: { kind: true, ordinal: true, topic: true, status: true } });

describe("anahtar açık — aynı türden iki istek iki satır", () => {
  beforeEach(() => vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1"));

  it("havuz + sauna: iki satır (sıra 0 / 1), kısa etiketler; plan iki ayrı istek görür", async () => {
    const { conversationId, messageId } = await seed();
    const plan = await turn(conversationId, messageId, [HAVUZ, SAUNA], 1);
    expect(await rowsOf(conversationId)).toEqual([
      { kind: "amenities", ordinal: 0, topic: "havuz", status: "open" },
      { kind: "amenities", ordinal: 1, topic: "sauna", status: "open" },
    ]);
    expect(plan.mode).toBe("items");
    expect(plan.mode === "items" && plan.turnItems.length).toBe(2);
  });

  it("🚨 yeniden işleme: aynı okuma, TERS sıra, başka sözcük — satır sayısı 2'de kalır, etiketler değişmez", async () => {
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 1);
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 2);
    await turn(conversationId, messageId, [SAUNA, HAVUZ], 3);
    await turn(conversationId, messageId, [{ q: "sauna saatleri", o: "Sauna?" }, { q: "havuz kapanış saati", o: "Havuz?" }], 4);
    expect(await rowsOf(conversationId)).toEqual([
      { kind: "amenities", ordinal: 0, topic: "havuz", status: "open" },
      { kind: "amenities", ordinal: 1, topic: "sauna", status: "open" },
    ]);
  });

  it("🚨 ters sıralı ikinci okumada ipucu doğru satıra gider (havuz sorgusu havuz satırının anahtarında)", async () => {
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 1);
    const plan = await turn(conversationId, messageId, [SAUNA, HAVUZ], 2);
    if (plan.mode !== "items") throw new Error(plan.mode);
    const refOf = (ordinal: number) => plan.answerable.find((a) => (a.item.ordinal ?? 0) === ordinal)?.ref;
    const hintOf = (ordinal: number) => plan.replyItems.answerable.find((a) => a.ref === refOf(ordinal))?.hint;
    expect(hintOf(0)).toBe(HAVUZ.q);
    expect(hintOf(1)).toBe(SAUNA.q);
  });

  it("anahtar kapalı dönemin tek satırı (sıra 0, etiketsiz) açılınca çoğalmaz; yeni bulunan ikinci istek ayrı satır", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "");
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ], 1);
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 2);
    expect(await rowsOf(conversationId)).toEqual([
      { kind: "amenities", ordinal: 0, topic: null, status: "open" },
      { kind: "amenities", ordinal: 1, topic: "sauna", status: "open" },
    ]);
  });

  it("migration varsayılanı: sırası verilmeyen yazıcı (kelime ağı / model öğesi) sıra 0 satırına birleşir", async () => {
    const { conversationId, messageId } = await seed();
    const ords = requestOrdinals(["amenities", "amenities"]);
    await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId,
      messages: [{ messageId, items: buildItemsForMessage({ requests: [{ intent: "amenities", topic: "havuz" }, { intent: "amenities", topic: "sauna" }], lexicalLabels: [], ordinals: ords }) }],
      now: at(1),
    });
    await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId,
      messages: [{ messageId, items: buildItemsForMessage({ requests: [{ intent: "amenities" }], lexicalLabels: [] }) }],
      now: at(2),
    });
    expect((await rowsOf(conversationId)).map((r) => [r.ordinal, r.topic])).toEqual([
      [0, "havuz"],
      [1, "sauna"],
    ]);
  });
});

describe("🚨 anahtar kapalı — bugünkü kural", () => {
  it("aynı türden iki istek TEK satır, sıra 0, etiket yok", async () => {
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 1);
    await turn(conversationId, messageId, [SAUNA, HAVUZ], 2);
    expect(await rowsOf(conversationId)).toEqual([{ kind: "amenities", ordinal: 0, topic: null, status: "open" }]);
  });
});

describe("KVKK — misafir silme talebi etiketi boşaltır", () => {
  it("rezervasyonun konuşmasındaki öğelerin etiketi silinir, öğenin kendisi (tür / durum) kalır; başka konuşmaya dokunulmaz", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 1);
    const other = await seed();
    await turn(other.conversationId, other.messageId, [HAVUZ], 1);
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Alex",
        sourceReference: "res-erase-84",
        channel: "airbnb",
        status: "completed",
        arrivalDate: at(-3 * 24 * 60),
        departureDate: at(-24 * 60),
      },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { reservationId: reservation.id } });
    const { eraseReservationData } = await import("@/lib/erasure");
    await eraseReservationData(orgId, reservation.id);
    expect(await rowsOf(conversationId)).toEqual([
      { kind: "amenities", ordinal: 0, topic: null, status: "open" },
      { kind: "amenities", ordinal: 1, topic: null, status: "open" },
    ]);
    expect((await rowsOf(other.conversationId)).map((r) => r.topic)).toEqual(["havuz"]);
  });
});

describe("Haiku 10-23 D incelemesi — belirsizse kapatma yok (kurucu B), saklama süresi etiketi siler", () => {
  async function seedTwo(second: string) {
    const conversation = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: `res-${Math.random()}`, status: "new", lastMessageAt: at(5) },
    });
    const m1 = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "inbound", body: BODY, senderName: "Alex", authorType: "guest", createdAt: at(0) },
    });
    const m2 = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "inbound", body: second, senderName: "Alex", authorType: "guest", createdAt: at(5) },
    });
    return { conversationId: conversation.id, m1: m1.id, m2: m2.id };
  }
  const turnTwo = (conversationId: string, m1: string, m2: string, second: string, raw: Record<string, unknown>, min: number) =>
    planItemsTurn(prisma, {
      organizationId: orgId,
      conversationId,
      history: [
        { id: m1, direction: "inbound", body: BODY },
        { id: m2, direction: "inbound", body: second },
      ],
      guestMessage: second,
      understanding: parseUnderstanding({ language: "tr", stay_change: STAY_NONE, ...raw }, { items: true }),
      expectedMessageIds: [m1, m2],
      now: at(min),
    });

  it("🚨 'Saunayı boşverin' (vazgeçme yalnız tür taşır) → havuz VE sauna açık kalır; anahtar kapalıyken bugünkü kural (tek satır kapanır)", async () => {
    const second = "Saunayı boşverin, teşekkürler.";
    const raw = {
      requests: [
        { intent: "amenities", message: 1, query_tr: HAVUZ.q, query_original: HAVUZ.o },
        { intent: "amenities", message: 1, query_tr: SAUNA.q, query_original: SAUNA.o },
        { intent: "greeting_thanks", message: 2, query_tr: "teşekkür", query_original: second },
      ],
      withdrawn: [{ intent: "amenities", message: 1 }],
    };
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const on = await seedTwo(second);
    await turnTwo(on.conversationId, on.m1, on.m2, second, raw, 6);
    expect((await rowsOf(on.conversationId)).filter((r) => r.kind === "amenities").map((r) => [r.topic, r.status])).toEqual([
      ["havuz", "open"],
      ["sauna", "open"],
    ]);
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "");
    const off = await seedTwo(second);
    await turnTwo(off.conversationId, off.m1, off.m2, second, raw, 6);
    expect((await rowsOf(off.conversationId)).filter((r) => r.kind === "amenities").map((r) => r.status)).toEqual(["withdrawn"]);
  });

  it("🚨 yeni 'havuz' isteği eski 'sauna' öğesinin yerini almaz; aynı konu (havuz → havuzu) alır", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [SAUNA], 1);
    const later = await prisma.message.create({
      data: { conversationId, direction: "inbound", body: "Havuz kaçta kapanıyor?", senderName: "Alex", authorType: "guest", createdAt: at(10) },
    });
    await planItemsTurn(prisma, {
      organizationId: orgId,
      conversationId,
      history: [
        { id: messageId, direction: "inbound", body: BODY },
        { id: later.id, direction: "inbound", body: "Havuz kaçta kapanıyor?" },
      ],
      guestMessage: "Havuz kaçta kapanıyor?",
      understanding: parseUnderstanding(
        {
          language: "tr",
          requests: [
            { intent: "amenities", message: 1, query_tr: SAUNA.q, query_original: SAUNA.o },
            { intent: "amenities", message: 2, query_tr: HAVUZ.q, query_original: HAVUZ.o },
          ],
          stay_change: STAY_NONE,
          withdrawn: [],
        },
        { items: true },
      ),
      expectedMessageIds: [messageId, later.id],
      now: at(11),
    });
    const rows = await prisma.conversationItem.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { topic: true, status: true } });
    expect(rows).toEqual([
      { topic: "sauna", status: "open" },
      { topic: "havuz", status: "open" },
    ]);
  });

  it("süre bazlı anonimleştirme (DATA_RETENTION_MONTHS) etiketi boşaltır; öğe kalır", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const old = new Date(Date.now() - 30 * 30 * 24 * 60 * 60 * 1000);
    const reservation = await prisma.reservation.create({
      data: { propertyId, guestName: "Alex Old", sourceReference: "res-ret-84", channel: "airbnb", status: "completed", arrivalDate: old, departureDate: new Date(old.getTime() + 86_400_000) },
    });
    const conversation = await prisma.conversation.create({
      data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Alex Old", status: "new", lastMessageAt: old },
    });
    const m = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "inbound", body: BODY, senderName: "Alex Old", authorType: "guest", createdAt: old },
    });
    await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId: conversation.id,
      messages: [{ messageId: m.id, items: buildItemsForMessage({ requests: [{ intent: "amenities", topic: "havuz" }], lexicalLabels: [], ordinals: [0] }) }],
      now: old,
    });
    // Öksüz dal (rezervasyonsuz konuşma, kendi son mesaj zamanıyla yaşlanır) — kardeş dalla BİREBİR (parite kuralı).
    const orphan = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Alex Orphan", status: "new", lastMessageAt: old },
    });
    const om = await prisma.message.create({
      data: { conversationId: orphan.id, direction: "inbound", body: BODY, senderName: "Alex Orphan", authorType: "guest", createdAt: old },
    });
    await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId: orphan.id,
      messages: [{ messageId: om.id, items: buildItemsForMessage({ requests: [{ intent: "amenities", topic: "sauna" }], lexicalLabels: [], ordinals: [0] }) }],
      now: old,
    });
    const { anonymizeOldGuestData } = await import("@/lib/data-retention");
    await anonymizeOldGuestData();
    for (const id of [conversation.id, orphan.id]) {
      expect(await prisma.conversationItem.findMany({ where: { conversationId: id }, select: { kind: true, topic: true } })).toEqual([
        { kind: "amenities", topic: null },
      ]);
    }
  });
});

describe("mutasyon 10-23 (D) yaşayanları — veritabanı", () => {
  it("yeniden yazımda olgular kendi SIRASININ satırına birleşir (sıra 1'in kaynağı sıra 0'a geçmez)", async () => {
    const { conversationId, messageId } = await seed();
    const item = (ordinal: number, sources: ("understanding" | "lexical")[]) => ({
      requestIndex: ordinal,
      kind: "amenities" as const,
      ...(ordinal > 0 ? { ordinal } : {}),
      sensitivity: "none" as const,
      riskType: null,
      sources,
    });
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId, items: [item(0, ["understanding"]), item(1, ["understanding"])] }], now: at(1) });
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId, items: [item(1, ["lexical"])] }], now: at(2) });
    const rows = await prisma.conversationItem.findMany({ where: { conversationId }, orderBy: { ordinal: "asc" }, select: { ordinal: true, sources: true } });
    expect(rows).toEqual([
      { ordinal: 0, sources: "understanding" },
      { ordinal: 1, sources: "understanding,lexical" },
    ]);
  });

  it("misafirin adı (konuşmadaki ad) etikete girmez", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [{ q: "Alex için ekstra havlu", o: "Alex için havlu?" }], 1);
    expect((await rowsOf(conversationId)).map((r) => r.topic)).toEqual(["ekstra havlu"]);
  });
});
