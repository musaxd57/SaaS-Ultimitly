import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Y6 (10-14 dış inceleme): ev sahibi UYARI yolu (`sendDueAlerts`, oto-yanıt kapalıyken tek uyarı yolu).
//  1. AÇIK TEHLİKE şikâyet sınıfına bağlı değil: "Dairede yangın çıktı!" kelime ağında `general` dönüyordu → e-posta YOKTU.
//  2. Pencere: son 6 mesaj okunuyordu → misafirin 6+ takip mesajı cevapsız şikâyeti pencereden itiyordu.
// Her vakanın KONTROLÜ var (aynı tohum, uyarı gerektirmeyen metin / cevaplanmış şikâyet → e-posta YOK).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { sendDueAlerts } from "@/lib/automation";

const mockMail = vi.mocked(emailService.sendReporting);
const MIN = 60_000;

async function seed(messages: { dir: "inbound" | "outbound"; body: string }[]) {
  const o = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale 7" } });
  const start = Date.now() - (messages.length + 1) * MIN;
  const c = await prisma.conversation.create({
    data: {
      propertyId: p.id,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status: "new",
      lastMessageAt: new Date(start + messages.length * MIN),
      messages: {
        create: messages.map((m, i) => ({
          direction: m.dir,
          senderName: m.dir === "inbound" ? "Ayşe" : "Ev Sahibi",
          body: m.body,
          createdAt: new Date(start + (i + 1) * MIN),
        })),
      },
    },
  });
  return { orgId: o.id, conversationId: c.id };
}

describe("Y6 — açık tehlike + pencere", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it.each(["Dairede yangın çıktı!", "There is a fire in the apartment!", "Our CO alarm is beeping."])(
    "🚨 %j (şikâyet sözcüğü yok) → ev sahibine acil e-posta + Sorunlu",
    async (body) => {
      const { orgId, conversationId } = await seed([{ dir: "inbound", body }]);
      expect((await sendDueAlerts(orgId)).alerted).toBe(1);
      expect(mockMail).toHaveBeenCalledTimes(1);
      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(c.status).toBe("problem");
      expect(c.lastRiskType).toBe("safety_emergency");
    },
  );

  it.each(["Is there a gas stove?", "How do I use the Fire TV stick?", "Wifi düştü, şifreyi tekrar verir misiniz?"])(
    "KONTROL (Haiku 10-14): %j — yalnız kanal ağı acil sanıyor, tehlike okuyucusu değil → uyarı YOK",
    async (body) => {
      const { orgId, conversationId } = await seed([{ dir: "inbound", body }]);
      expect((await sendDueAlerts(orgId)).alerted).toBe(0);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("new");
    },
  );

  it("🚨 karışık tur: yangın + iade → ACİL mesaj seçilir (riskType safety_emergency)", async () => {
    const { orgId, conversationId } = await seed([
      { dir: "inbound", body: "Dairede yangın çıktı!" },
      { dir: "inbound", body: "Ve paramın iadesini istiyorum." },
    ]);
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).lastRiskType).toBe("safety_emergency");
  });

  it("KONTROL (Haiku 10-14): 72 saatten ESKİ cevapsız şikâyet bugünkü 'merhaba?' ile uyarıya dönmez", async () => {
    const o = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
    const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale 7" } });
    const old = new Date(Date.now() - 5 * 86_400_000);
    await prisma.conversation.create({
      data: {
        propertyId: p.id,
        channel: "airbnb",
        guestIdentifier: "Ayşe",
        status: "new",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "Ayşe", body: "Daire çok kirli, param iade edilsin!", createdAt: old },
            { direction: "inbound", senderName: "Ayşe", body: "Merhaba?", createdAt: new Date(Date.now() - MIN) },
          ],
        },
      },
    });
    expect((await sendDueAlerts(o.id)).alerted).toBe(0);
  });

  it("KONTROL: sıradan soru → uyarı yok", async () => {
    const { orgId } = await seed([{ dir: "inbound", body: "Wi-Fi şifresi nedir?" }]);
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });

  const FOLLOW_UPS = Array.from({ length: 8 }, (_, i) => ({ dir: "inbound" as const, body: `Bir de şunu sorayım ${i + 1}: otopark nerede?` }));

  it("🚨 cevapsız şikâyetin ardından 8 takip mesajı → şikâyet yine görülür, e-posta gider", async () => {
    const { orgId } = await seed([{ dir: "inbound", body: "Daire çok kirli, param iade edilsin. Bu kabul edilemez!" }, ...FOLLOW_UPS]);
    expect((await sendDueAlerts(orgId)).alerted).toBe(1);
  });

  it("KONTROL: şikâyet CEVAPLANMIŞSA ardından gelen takipler uyarı doğurmaz", async () => {
    const { orgId } = await seed([
      { dir: "inbound", body: "Daire çok kirli, param iade edilsin. Bu kabul edilemez!" },
      { dir: "outbound", body: "Çok üzgünüz, hemen ilgileniyoruz." },
      ...FOLLOW_UPS,
    ]);
    expect((await sendDueAlerts(orgId)).alerted).toBe(0);
  });
});
