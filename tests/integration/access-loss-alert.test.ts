import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KAYIP ANAHTAR / KİLİTLİ KALMA → EV SAHİBİ + ÖNCELİK (kurucu 10-29 gece, GD4: "anahtarı kaybettim, bulamıyorum gibi şeyler hosta kalsın,
// öncelikli olarak hosta gösterilsin").
// Önceki durum (ölçüldü): "Anahtarı kaybettim" konu ağında giriş sorusu sayılıyordu → uyarı geçişi (oto-yanıt kapalıyken ev sahibine TEK yol)
// hiçbir şey yapmıyordu: e-posta yok, "Sorunlu" yok, öncelik yok; öğe kipinde de tutulmuyordu.
//  · Öğe kipi KAPALI: uyarı geçişi → "Sorunlu" + acil e-posta + öncelik "Acil" (lastRiskType access_security).
//  · Öğe kipi AÇIK: giriş / anahtar isteği ev sahibinde tutulur + tek acil e-posta + konuşma "Acil"; konuşma "Sorunlu" OLMAZ (acil değil,
//    aynı turdaki başka soru cevaplanabilir).
//  · Dikkat Gerektirenler: erişim kaybı acil satırla aynı üst sırada (99), sıradan bırakılan istek 88.
// KONTROL: giriş SORUSU ("Anahtarı nereden alacağız?") uyarı üretmez; şikâyetin önceliği DEĞİŞMEZ (kurucu yalnız erişim kaybını istedi).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandingEnabled: () => true, understandGuestMessages: vi.fn() };
});

import { emailService } from "@/lib/email";
import { sendDueAlerts } from "@/lib/automation";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

const mockMail = vi.mocked(emailService.sendReporting);

async function seed(body: string, minutesAgo = 20) {
  const o = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale 7" } });
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const c = await prisma.conversation.create({
    data: {
      propertyId: p.id,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      externalReservationId: `res-${Math.random()}`,
      status: "new",
      lastMessageAt: at,
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", authorType: "guest", body, createdAt: at }] },
    },
  });
  return { orgId: o.id, conversationId: c.id };
}

const conv = (id: string) =>
  prisma.conversation.findUniqueOrThrow({ where: { id }, select: { status: true, priority: true, lastRiskType: true } });

describe("öğe kipi KAPALI — uyarı geçişi (oto-yanıt kapalıyken ev sahibine tek yol)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["Anahtarı kaybettim", "I lost my keys", "Ich habe meinen Schlüssel verloren", "I locked myself out"])(
    "🚨 %j → 'Sorunlu' + tek acil e-posta + öncelik Acil",
    async (body) => {
      const { orgId, conversationId } = await seed(body);
      expect((await sendDueAlerts(orgId)).alerted).toBe(1);
      expect(mockMail).toHaveBeenCalledTimes(1);
      expect(await conv(conversationId)).toEqual({ status: "problem", priority: "urgent", lastRiskType: "access_security" });
      // İkinci geçiş yeni e-posta atmaz (claim tekilliği).
      expect((await sendDueAlerts(orgId)).alerted).toBe(0);
      expect(mockMail).toHaveBeenCalledTimes(1);
    },
  );

  it("🚨 acil (yangın) da artık öncelik Acil yazar (kelime yolu yazmıyordu; model yolu yazıyordu)", async () => {
    const { orgId, conversationId } = await seed("Dairede yangın çıktı!");
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
    expect(await conv(conversationId)).toEqual({ status: "problem", priority: "urgent", lastRiskType: "safety_emergency" });
  });

  it("KONTROL: şikâyetin önceliği DEĞİŞMEDİ (standart)", async () => {
    const { orgId, conversationId } = await seed("Daire çok kirli");
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
    expect(await conv(conversationId)).toMatchObject({ status: "problem", priority: "standard" });
  });

  it.each(["Anahtarı nereden alacağız?", "Anahtarı kaybedersem ne olur?", "Where do I pick up the keys?"])(
    "KONTROL: %j (giriş sorusu / varsayım) → uyarı YOK",
    async (body) => {
      const { orgId, conversationId } = await seed(body);
      expect((await sendDueAlerts(orgId)).alerted).toBe(0);
      expect(mockMail).not.toHaveBeenCalled();
      expect(await conv(conversationId)).toMatchObject({ status: "new", priority: "standard" });
    },
  );
});

describe("öğe kipi AÇIK — istek ev sahibinde tutulur, konuşma Acil", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 'Anahtarımı kaybettim, yedek var mı?' → giriş / anahtar öğesi tutulur + tek e-posta + Acil; 'Sorunlu' YOK", async () => {
    const { orgId, conversationId } = await seed("Anahtarımı kaybettim, yedek var mı?");
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    const items = await prisma.conversationItem.findMany({
      where: { conversationId },
      select: { kind: true, sensitivity: true, status: true, riskType: true, notifiedAt: true },
    });
    expect(items).toEqual([
      { kind: "access_keys", sensitivity: "sensitive", status: "pending_host", riskType: "access_security", notifiedAt: expect.any(Date) },
    ]);
    expect(await conv(conversationId)).toMatchObject({ status: "new", priority: "urgent" });
    // İkinci geçiş yeni e-posta atmaz.
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: şikâyet öğesi tutulur ama öncelik DEĞİŞMEZ", async () => {
    const { orgId, conversationId } = await seed("Daire çok kirli");
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
    expect(await conv(conversationId)).toMatchObject({ status: "new", priority: "standard" });
  });

  it("Dikkat Gerektirenler: kayıp anahtar acil satırla aynı üst sırada (99), şikâyet 88", async () => {
    const lost = await seed("Anahtarımı kaybettim", 300);
    const dirty = await seed("Daire çok kirli", 400);
    await sendDueAlerts(lost.orgId);
    await sendDueAlerts(dirty.orgId);
    const [lostRow] = await findAttentionItems(lost.orgId);
    const [dirtyRow] = await findAttentionItems(dirty.orgId);
    expect(lostRow).toMatchObject({ kind: "held_request", severity: 99, requestKinds: ["access_keys"] });
    expect(dirtyRow).toMatchObject({ kind: "held_request", severity: 88, requestKinds: ["complaint_issue"] });
  });
});
