import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertTurnItems } from "@/lib/conversation-items/store";
import { buildItemsForMessage, requestOrdinals } from "@/lib/conversation-items/core";
import { notifyOpenNeeds, OPEN_NEED_MAIL_PREFIX, planItemsTurn, recordOpenNeedsNotified } from "@/lib/conversation-items/flow";
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

  it("🚨 etiketsiz satır (anahtar öncesi) + etiketli satır, 'Saunayı boşverin' → ikisi de AÇIK (etiketsiz öğe 'aynı konu' sayılmaz — Opus 10-23)", async () => {
    const second = "Saunayı boşverin, teşekkürler.";
    const { conversationId, m1, m2 } = await seedTwo(second);
    // Anahtar kapalı dönem: m1'in havuz isteği etiketsiz sıra 0 satırı.
    await turnTwo(
      conversationId,
      m1,
      m2,
      second,
      {
        requests: [
          { intent: "amenities", message: 1, query_tr: HAVUZ.q, query_original: HAVUZ.o },
          { intent: "greeting_thanks", message: 2, query_tr: "teşekkür", query_original: second },
        ],
        withdrawn: [],
      },
      3,
    );
    expect((await rowsOf(conversationId)).filter((r) => r.kind === "amenities").map((r) => [r.topic, r.status])).toEqual([[null, "open"]]);
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    await turnTwo(
      conversationId,
      m1,
      m2,
      second,
      {
        requests: [
          { intent: "amenities", message: 1, query_tr: HAVUZ.q, query_original: HAVUZ.o },
          { intent: "amenities", message: 1, query_tr: SAUNA.q, query_original: SAUNA.o },
          { intent: "greeting_thanks", message: 2, query_tr: "teşekkür", query_original: second },
        ],
        withdrawn: [{ intent: "amenities", message: 1 }],
      },
      6,
    );
    expect((await rowsOf(conversationId)).filter((r) => r.kind === "amenities").map((r) => [r.topic, r.status])).toEqual([
      [null, "open"],
      ["sauna", "open"],
    ]);
  });

  it("🚨 etiketsiz eski öğenin yerini yeni etiketli istek ALMAZ (ilişki belirsiz → kapatma yok — Opus 10-23)", async () => {
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [SAUNA], 1); // anahtar kapalı: etiketsiz
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const later = await prisma.message.create({
      data: { conversationId, direction: "inbound", body: "Sauna kaçta açılıyor?", senderName: "Alex", authorType: "guest", createdAt: at(10) },
    });
    await planItemsTurn(prisma, {
      organizationId: orgId,
      conversationId,
      history: [
        { id: messageId, direction: "inbound", body: BODY },
        { id: later.id, direction: "inbound", body: "Sauna kaçta açılıyor?" },
      ],
      guestMessage: "Sauna kaçta açılıyor?",
      understanding: parseUnderstanding(
        {
          language: "tr",
          requests: [
            { intent: "amenities", message: 1, query_tr: SAUNA.q, query_original: SAUNA.o },
            { intent: "amenities", message: 2, query_tr: "sauna kaçta açılıyor", query_original: "Sauna kaçta açılıyor?" },
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
      { topic: null, status: "open" },
      { topic: "sauna açılıyor", status: "open" },
    ]);
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

  it("🚨 R14 (Opus dilim sonu 10-23): 'Havuz ısıtmalı mı?' önceki 'Havuz kaçta açılıyor?' sorusunu KAPATMAZ (tek ortak konu sözcüğü yetmez)", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const OPENS = { q: "havuz kaçta açılıyor", o: "Havuz kaçta açılıyor?" };
    const HEATED = { q: "havuz ısıtmalı mı", o: "Havuz ısıtmalı mı?" };
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [OPENS], 1);
    const later = await prisma.message.create({
      data: { conversationId, direction: "inbound", body: "Havuz ısıtmalı mı?", senderName: "Alex", authorType: "guest", createdAt: at(10) },
    });
    await planItemsTurn(prisma, {
      organizationId: orgId,
      conversationId,
      history: [
        { id: messageId, direction: "inbound", body: BODY },
        { id: later.id, direction: "inbound", body: "Havuz ısıtmalı mı?" },
      ],
      guestMessage: "Havuz ısıtmalı mı?",
      understanding: parseUnderstanding(
        {
          language: "tr",
          requests: [
            { intent: "amenities", message: 1, query_tr: OPENS.q, query_original: OPENS.o },
            { intent: "amenities", message: 2, query_tr: HEATED.q, query_original: HEATED.o },
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
    expect(rows.map((r) => r.status)).toEqual(["open", "open"]);
    expect(rows.every((r) => r.topic)).toBe(true);
  });

  it("🚨 Haiku 10-23 gece-2: aynı soru başka fiil çekimiyle ('açılıyor' → 'açılır') eskinin yerini alır; 'Havuz açık mı?' ('havuz') 'Havuz ısıtmalı mı?' ile kapanmaz", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const pairs: [{ q: string; o: string }, { q: string; o: string }, string[]][] = [
      [{ q: "havuz kaçta açılıyor", o: "Havuz kaçta açılıyor?" }, { q: "havuz ne zaman açılır", o: "Havuz ne zaman açılır?" }, ["superseded", "open"]],
      [{ q: "havuz açık mı", o: "Havuz açık mı?" }, { q: "havuz ısıtmalı mı", o: "Havuz ısıtmalı mı?" }, ["open", "open"]],
    ];
    for (const [first, second, expected] of pairs) {
      const { conversationId, messageId } = await seed();
      await turn(conversationId, messageId, [first], 1);
      const later = await prisma.message.create({
        data: { conversationId, direction: "inbound", body: second.o, senderName: "Alex", authorType: "guest", createdAt: at(10) },
      });
      await planItemsTurn(prisma, {
        organizationId: orgId,
        conversationId,
        history: [
          { id: messageId, direction: "inbound", body: BODY },
          { id: later.id, direction: "inbound", body: second.o },
        ],
        guestMessage: second.o,
        understanding: parseUnderstanding(
          {
            language: "tr",
            requests: [
              { intent: "amenities", message: 1, query_tr: first.q, query_original: first.o },
              { intent: "amenities", message: 2, query_tr: second.q, query_original: second.o },
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
      expect(rows.map((r) => r.status), JSON.stringify(rows)).toEqual(expected);
    }
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

  it("🚨 zaten temizlenmiş kayıtta kalan eski etiket de seçilir ve boşalır — iki dal (seçim bacağı = sonlanma kuralı, Opus 10-23)", async () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    vi.stubEnv("RETENTION_MESSAGE_AGE_ANCHOR", "1");
    const { ANON_BODY } = await import("@/lib/data-retention");
    const { ANON_NAME, ANON_ID } = await import("@/lib/anon-sentinels");
    const old = new Date(Date.now() - 30 * 30 * 24 * 60 * 60 * 1000);
    // Başka hiçbir bacağa düşmeyen kayıt: ad / kimlik / gövde zaten temiz; yalnız öğe etiketi kalmış.
    const reservation = await prisma.reservation.create({
      data: { propertyId, guestName: ANON_NAME, sourceReference: "res-ret-84b", channel: "airbnb", status: "completed", arrivalDate: old, departureDate: new Date(old.getTime() + 86_400_000) },
    });
    const conversation = await prisma.conversation.create({
      data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: ANON_ID, status: "new", lastMessageAt: old },
    });
    const orphan = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: ANON_ID, status: "new", lastMessageAt: old } });
    for (const [conv, topic] of [
      [conversation.id, "havuz"],
      [orphan.id, "sauna"],
    ] as const) {
      const m = await prisma.message.create({ data: { conversationId: conv, direction: "inbound", body: ANON_BODY, senderName: ANON_ID, authorType: "guest", createdAt: old } });
      await upsertTurnItems(prisma, {
        organizationId: orgId,
        conversationId: conv,
        messages: [{ messageId: m.id, items: buildItemsForMessage({ requests: [{ intent: "amenities", topic }], lexicalLabels: [], ordinals: [0] }) }],
        now: old,
      });
    }
    const { anonymizeOldGuestData } = await import("@/lib/data-retention");
    await anonymizeOldGuestData();
    for (const id of [conversation.id, orphan.id]) {
      expect((await prisma.conversationItem.findMany({ where: { conversationId: id }, select: { topic: true } })).map((r) => r.topic)).toEqual([null]);
    }
    // Sonlanma: ikinci koşu bir şey seçmez (etiket kalmadı).
    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
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

describe("Opus e2e 10-23 F5 — parça kipinde yalnız bu okumanın satırları cevaplanabilir", () => {
  beforeEach(() => vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1"));

  it("🚨 ikinci okuma tek istek görürse öteki açık satır ipucusuz istek kimliği OLMAZ (açık kalır); parça kipi kapalıyken bugünkü kural", async () => {
    const { conversationId, messageId } = await seed();
    const first = await turn(conversationId, messageId, [HAVUZ, SAUNA], 0);
    expect(first.mode === "items" && first.answerable.length).toBe(2);
    // Tur tutuldu (satırlar açık); sonraki geçiş mesajı TEK istek olarak okudu.
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    const second = await turn(conversationId, messageId, [SAUNA], 5);
    if (second.mode !== "items") throw new Error(second.mode);
    expect(second.turnItems).toHaveLength(2);
    expect(second.answerable.map((a) => [a.ref, a.item.topic])).toEqual([["R1", "sauna"]]);
    expect(second.replyItems.answerable.map((a) => a.hint)).toEqual(["sauna var mı"]);
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "");
    const legacy = await turn(conversationId, messageId, [SAUNA], 6);
    expect(legacy.mode === "items" && legacy.answerable.length).toBe(2);
  });
});

describe("Soru 10 (kurucu 10-23 sabah) — sessiz kalan açık ihtiyaç: kalıcı kayıt + tek bildirim", () => {
  beforeEach(() => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
  });

  /** İlk okuma havuz + sauna; ikinci okuma (parça kipi) yalnız sauna → havuz satırı bayat açık. */
  async function staleSetup() {
    const { conversationId, messageId } = await seed();
    await turn(conversationId, messageId, [HAVUZ, SAUNA], 0);
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    const plan = await turn(conversationId, messageId, [SAUNA], 5);
    if (plan.mode !== "items") throw new Error(plan.mode);
    return { conversationId, messageId, plan };
  }
  const locks = () => prisma.systemLock.findMany({ where: { name: { startsWith: OPEN_NEED_MAIL_PREFIX } } });

  it("plan bayat açık satırı ayrıca verir; parça kipi kapalıyken alan yok", async () => {
    const { plan } = await staleSetup();
    expect(plan.staleOpen?.map((i) => i.topic)).toEqual(["havuz"]);
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "");
    const { conversationId, messageId } = await seed();
    const legacy = await turn(conversationId, messageId, [HAVUZ, SAUNA], 0);
    expect(legacy.mode === "items" && legacy.staleOpen).toBeUndefined();
  });

  it("🚨 önce kalıcı kayıt, sonra TEK bildirim (ihtiyacın mesajına); yeniden işleme yeni bildirim üretmez", async () => {
    const { messageId, plan } = await staleSetup();
    const notify = vi.fn(async () => "mailed" as const);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify })).toBe("mailed");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(messageId);
    expect(await locks()).toHaveLength(1);
    // Aynı tur yeniden işlendi / tarama tekrarlandı.
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(7), notify })).toBe("none");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("🚨 kayıt notify ÇAĞRILMADAN önce yazılmıştır (eşzamanlı ikinci geçiş kayıt görür, e-posta atmaz)", async () => {
    const { plan } = await staleSetup();
    let second: string | undefined;
    const notify = vi.fn(async () => {
      second = await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify: vi.fn(async () => "mailed" as const) });
      return "mailed" as const;
    });
    await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify });
    expect(second).toBe("none");
  });

  it("🚨 e-posta gitmezse (hata / alıcı yok) kayıt geri alınır, sonraki geçiş yeniden dener; 'zaten gitti' kaydı tutar", async () => {
    const { plan } = await staleSetup();
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify: async () => "failed" })).toBe("not_sent");
    expect(await locks()).toHaveLength(0);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(7), notify: async () => "no_recipient" })).toBe("not_sent");
    expect(await locks()).toHaveLength(0);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(8), notify: async () => "deduped" })).toBe("deduped");
    expect(await locks()).toHaveLength(1);
  });

  it("🚨 vazgeçilen / cevaplanan satır bildirilmez (güncel durum yeniden okunur)", async () => {
    const { conversationId, plan } = await staleSetup();
    await prisma.conversationItem.updateMany({ where: { conversationId, topic: "havuz" }, data: { status: "withdrawn" } });
    const notify = vi.fn(async () => "mailed" as const);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify })).toBe("none");
    expect(notify).not.toHaveBeenCalled();
    expect(await locks()).toHaveLength(0);
  });

  it("🚨 Opus 10-23 sabah F8: hedef, 'Misafir cevabınızı bekliyor' e-postası HENÜZ gitmemiş mesaj; hepsine gittiyse bildirim yapılmış sayılır", async () => {
    const { messageId, plan } = await staleSetup();
    // Bu mesaja e-posta önceden gitmiş (mesaj başına talep satırı "gönderildi" onaylı) → e-posta yok, kayıt kalır.
    await prisma.systemLock.create({ data: { name: `reply-waiting-mail:${messageId}`, lockedUntil: at(60 * 24), holder: "sent" } });
    const notify = vi.fn(async () => "mailed" as const);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify })).toBe("deduped");
    expect(notify).not.toHaveBeenCalled();
    expect(await locks()).toHaveLength(1);
  });

  it("🚨 Codex 10-23 (bildirim yarışı): öteki yolun e-postası UÇUŞTAYSA (talep var, onay yok) 'bildirildi' sayılmaz — kayıt geri verilir, sonraki geçiş karar verir", async () => {
    const { messageId, plan } = await staleSetup();
    // Talep yeni alınmış, sonucu belli değil (`holder` boş, az önce yazıldı) → bu geçiş kendi kaydını TUTMAZ.
    await prisma.systemLock.create({ data: { name: `reply-waiting-mail:${messageId}`, lockedUntil: new Date(Date.now() + 86_400_000) } });
    const notify = vi.fn(async () => "mailed" as const);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: new Date(), notify })).toBe("not_sent");
    expect(notify).not.toHaveBeenCalled();
    expect(await locks()).toHaveLength(0);
    // Uçuştaki e-posta düştü (talep silindi) → sonraki geçiş bu ihtiyacı kendisi bildirir.
    await prisma.systemLock.deleteMany({ where: { name: `reply-waiting-mail:${messageId}` } });
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: new Date(), notify })).toBe("mailed");
    expect(notify).toHaveBeenCalledWith(messageId);
    expect(await locks()).toHaveLength(1);
  });

  it("onaysız ama ESKİ talep (onay yazılamamış başarılı gönderim / eski kayıt) sonuçlanmış sayılır — sonsuz 'uçuşta' yok", async () => {
    const { messageId, plan } = await staleSetup();
    await prisma.systemLock.create({ data: { name: `reply-waiting-mail:${messageId}`, lockedUntil: new Date(Date.now() + 86_400_000) } });
    const notify = vi.fn(async () => "mailed" as const);
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: later, notify })).toBe("deduped");
    expect(notify).not.toHaveBeenCalled();
    expect(await locks()).toHaveLength(1);
  });

  it("🚨 F8: bugünkü devir / cevapsız parça e-postası turun açık ihtiyaçlarını KAYDEDER → sonraki bayat tur ikinci e-posta atmaz", async () => {
    const { plan } = await staleSetup();
    await recordOpenNeedsNotified(prisma, { items: [...plan.turnItems, ...(plan.staleOpen ?? [])], now: at(5) });
    const notify = vi.fn(async () => "mailed" as const);
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: plan.staleOpen!, now: at(6), notify })).toBe("none");
    expect(notify).not.toHaveBeenCalled();
  });

  it("kaynak / asistan sorusu bildirim istemez; başka işletmenin satırı okunmaz", async () => {
    const { plan } = await staleSetup();
    const notify = vi.fn(async () => "mailed" as const);
    const asAssistant = plan.staleOpen!.map((i) => ({ ...i, kind: "about_assistant" as const }));
    expect(await notifyOpenNeeds(prisma, { organizationId: orgId, items: asAssistant, now: at(6), notify })).toBe("none");
    const other = await makeOrgWithProperty();
    expect(await notifyOpenNeeds(prisma, { organizationId: other.orgId, items: plan.staleOpen!, now: at(6), notify })).toBe("none");
    expect(notify).not.toHaveBeenCalled();
  });
});
