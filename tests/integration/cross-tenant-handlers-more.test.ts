import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİRACILAR ARASI YALITIM — DAVRANIŞSAL, İKİNCİ PAKET (10-10 gece; değişmez 16, Haiku envanteri)
//
// `cross-tenant-handlers.test.ts` sekiz tutamacı sınıyordu. Dinamik kimlikli rotaların envanterinde (Haiku, kodla doğrulandı) altı
// tutamacın davranışsal pini YOKTU ya da yalnız VAR OLMAYAN kimlikle sınanıyordu (var olmayan kimlik kapsamı sınamaz — kapsam koşulu
// silinse de 404 verir). Bu dosya her birini B kiracısının oturumuyla, A kiracısının GERÇEK kimlikleriyle çağırır: ret KAPSAMDAN gelir
// (404 ya da mülk alanına bağlı 400) ve A'nın verisi değişmez. Anti-vakum: aynı çağrılar A'nın kendi oturumuyla çalışır.
// Rota → test eşlemesi `tests/unit/cross-tenant-coverage.test.ts`te (yeni dinamik rota eşlemesiz eklenemez).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai/translate", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/translate")>()),
  translate: vi.fn(async () => ({ ok: true as const, text: "Hello" })),
}));

import { translate } from "@/lib/ai/translate";
import { DELETE as calSourceDelete } from "@/app/api/calendar-sources/[id]/route";
import { POST as calSourceCreate } from "@/app/api/properties/[id]/calendar-sources/route";
import { POST as guestChatReply } from "@/app/api/guest-chats/[id]/reply/route";
import { POST as translateMessage } from "@/app/api/conversations/[id]/translate-message/route";
import { DELETE as kbDelete } from "@/app/api/kb/[id]/route";
import { DELETE as templateDelete } from "@/app/api/templates/[id]/route";
import { DELETE as propertyDelete } from "@/app/api/properties/[id]/route";
import { PUT as earlyRulePut, DELETE as earlyRuleDelete } from "@/app/api/properties/[id]/early-checkin-rule/route";
import { loadEarlyCheckinRule, saveEarlyCheckinRule } from "@/lib/early-checkin/rules";
import type { EarlyCheckinRule } from "@/lib/early-checkin/core";

const RULE: EarlyCheckinRule = { mode: "auto", earliest: "12:00", fee: { amount: 30, currency: "EUR" }, note: null };
const put = (body: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const owner = (organizationId: string, userId: string): SessionPayload => ({
  userId,
  organizationId,
  role: "owner",
  email: `${userId}@x.com`,
  name: userId,
  sessionEpoch: 0,
});
const json = (body: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const bare = (method = "DELETE") => new NextRequest("http://localhost/api/x", { method });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedVictim() {
  const org = await prisma.organization.create({ data: { name: "A" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "a", email: "a@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
  const source = await prisma.calendarSource.create({ data: { propertyId: property.id, label: "Airbnb", url: "https://example.com/a.ics" } });
  const feedReservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Misafir",
      arrivalDate: new Date(Date.now() + 86_400_000),
      departureDate: new Date(Date.now() + 3 * 86_400_000),
      channel: "airbnb",
      status: "confirmed",
      calendarSourceId: source.id,
      sourceReference: "uid-1",
    },
  });
  const chat = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "qr", channel: "chat", status: "new" } });
  const conversation = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "g", channel: "airbnb", status: "new" } });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", body: "Merhaba", senderName: "g", language: "tr" },
  });
  const kb = await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "rules", title: "Kurallar", content: "Sigara yok", reviewState: "approved", source: "host_manual" },
  });
  const template = await prisma.messageTemplate.create({ data: { organizationId: org.id, category: "welcome", title: "Hoş geldiniz", body: "Merhaba" } });
  return { org, user, property, source, feedReservation, chat, conversation, message, kb, template };
}

describe("kiracılar arası yalıtım — ikinci paket, davranışsal", () => {
  let v: Awaited<ReturnType<typeof seedVictim>>;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    // Kabuktan sızan faturalandırma ayarı ücretli çeviriyi 402'ye çevirip reddin sebebini maskelemesin.
    vi.stubEnv("BILLING_ENFORCED", "");
    v = await seedVictim();
    const attackerOrg = await prisma.organization.create({ data: { name: "B" } });
    const attacker = await prisma.user.create({ data: { organizationId: attackerOrg.id, name: "b", email: "b@x.com", passwordHash: "x", role: "owner" } });
    session = owner(attackerOrg.id, attacker.id);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 B kiracısı A'nın takvim kaynağını silemez, A'nın dairesine kaynak ekleyemez, A'nın QR sohbetine yazamaz", async () => {
    expect((await calSourceDelete(bare(), ctx(v.source.id))).status).toBe(404);
    // Ret mülk KAPSAMINDAN: istek gövdesi geçerli (ad + https adres) — 400'ün alanı `propertyId` olmalı, başka bir doğrulama değil.
    const created = await calSourceCreate(json({ label: "Booking", url: "https://example.com/b.ics" }), ctx(v.property.id));
    expect(created.status).toBe(400);
    expect(Object.keys(((await created.json()) as { fields?: Record<string, string> }).fields ?? {})).toEqual(["propertyId"]);
    expect((await guestChatReply(json({ body: "ele gecirildi" }), ctx(v.chat.id))).status).toBe(404);

    // A'nın verisi BİREBİR aynı: kaynak duruyor, besleme satırı hâlâ ona bağlı (öksüzleştirilmedi), ikinci kaynak yok, sohbette yeni mesaj yok.
    expect(await prisma.calendarSource.count({ where: { propertyId: v.property.id } })).toBe(1);
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: v.feedReservation.id } });
    expect(res).toMatchObject({ calendarSourceId: v.source.id, channel: "airbnb" });
    expect(await prisma.message.count({ where: { conversationId: v.chat.id } })).toBe(0);
  });

  it("🚨 B kiracısı A'nın GERÇEK konuşma + mesaj kimliğiyle çeviri isteyemez (model çağrılmaz, kota tüketilmez)", async () => {
    const r = await translateMessage(json({ messageId: v.message.id, targetLanguage: "en" }), ctx(v.conversation.id));
    expect(r.status).toBe(404);
    expect(vi.mocked(translate), "kiracılar arası istek modele ulaştı").not.toHaveBeenCalled();
    // A'nın günlük yapay zekâ kotası (sayaç satırı) hiç oluşmadı — kota tüketimi kapsamın ÖNÜNE taşınırsa kırmızı.
    expect(await prisma.rateLimitCounter.count({ where: { key: `ai-daily:${v.org.id}` } })).toBe(0);
    // B kendi konuşmasıyla A'nın mesaj kimliğini de kullanamaz (mesaj konuşmaya bağlı aranır).
    const bProperty = await prisma.property.create({ data: { organizationId: session.organizationId, name: "B-1" } });
    const bConversation = await prisma.conversation.create({ data: { propertyId: bProperty.id, guestIdentifier: "x", channel: "airbnb" } });
    const r2 = await translateMessage(json({ messageId: v.message.id, targetLanguage: "en" }), ctx(bConversation.id));
    expect(r2.status).toBe(404);
    expect(vi.mocked(translate)).not.toHaveBeenCalled();
  });

  it("🚨 B kiracısı A'nın bilgi tabanı kalemini, şablonunu, erken giriş kuralını ve dairesini silemez / değiştiremez", async () => {
    await saveEarlyCheckinRule(v.org.id, v.property.id, RULE);
    expect((await kbDelete(bare(), ctx(v.kb.id))).status).toBe(404);
    expect((await templateDelete(bare(), ctx(v.template.id))).status).toBe(404);
    expect((await earlyRulePut(put({ ...RULE, earliest: "09:00" }), ctx(v.property.id))).status).toBe(404);
    expect((await earlyRuleDelete(bare(), ctx(v.property.id))).status).toBe(404);
    expect((await propertyDelete(bare(), ctx(v.property.id))).status).toBe(404);
    expect(await prisma.knowledgeBaseItem.count({ where: { id: v.kb.id } })).toBe(1);
    expect(await prisma.messageTemplate.count({ where: { id: v.template.id } })).toBe(1);
    expect(await loadEarlyCheckinRule(v.org.id, v.property.id)).toEqual(RULE);
    expect(await prisma.property.count({ where: { id: v.property.id } })).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0); // başarısız deneme A adına denetim kaydı da yazmaz
  });

  it("ANTİ-VAKUM: aynı çağrılar A'nın KENDİ oturumuyla çalışır (ret kapsamdan geliyor, bozuk istekten değil)", async () => {
    session = owner(v.org.id, v.user.id);
    expect((await guestChatReply(json({ body: "Ev sahibi burada" }), ctx(v.chat.id))).status).toBe(201);
    expect(await prisma.message.count({ where: { conversationId: v.chat.id, direction: "outbound" } })).toBe(1);
    const t = await translateMessage(json({ messageId: v.message.id, targetLanguage: "en" }), ctx(v.conversation.id));
    expect(t.status).toBe(200);
    expect(vi.mocked(translate)).toHaveBeenCalledTimes(1);
    expect((await calSourceCreate(json({ label: "Booking", url: "https://example.com/b.ics" }), ctx(v.property.id))).status).toBe(201);
    expect((await calSourceDelete(bare(), ctx(v.source.id))).status).toBe(200);
    expect(await prisma.reservation.findUniqueOrThrow({ where: { id: v.feedReservation.id } })).toMatchObject({ calendarSourceId: null, channel: "manual" });
    expect((await kbDelete(bare(), ctx(v.kb.id))).status).toBe(200);
    expect((await templateDelete(bare(), ctx(v.template.id))).status).toBe(200);
    expect((await earlyRulePut(put(RULE), ctx(v.property.id))).status).toBe(200);
    expect((await earlyRuleDelete(bare(), ctx(v.property.id))).status).toBe(200);
    expect((await propertyDelete(bare(), ctx(v.property.id))).status).toBe(200);
    expect(await prisma.property.count({ where: { id: v.property.id } })).toBe(0);
  });
});
