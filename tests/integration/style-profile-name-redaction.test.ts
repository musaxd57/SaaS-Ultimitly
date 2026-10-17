import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// #211 (gece güvenlik turu, S2 P3 — kodda doğrulandı 09-27): üslup profili org genelindeki ev sahibi cevaplarından damıtılır ve
// org'un BAŞKA konuşmalarının istemine girer. Cevap gövdeleri özetleyiciye (OpenAI) gitmeden önce e-posta / telefon / uzun kod
// redakte ediliyordu ama MİSAFİR ADI edilmiyordu ("Merhaba Ayşe, …") → özet bir örnekte adı taşırsa başka misafirin istemine
// sızabiliyordu. Artık her cevabın kendi konuşmasındaki misafir adları (görünen ad + rezervasyon adı) `[Misafir]` olur — kalite
// denetçisiyle aynı yardımcı (`redactNameFromBody`). Tarz (hitap, uzunluk, kapanış) korunur.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  summarizeHostStyle: vi.fn(async () => "1) TARZ: kısa ve sıcak."),
}));

import { summarizeHostStyle } from "@/lib/ai";
import { refreshStyleProfile } from "@/lib/automation";

const mockSummarize = vi.mocked(summarizeHostStyle);

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Mehmet Kaya",
      arrivalDate: new Date(Date.now() - 86_400_000),
      departureDate: new Date(Date.now() + 86_400_000),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  const c1 = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "Ayşe Demir" } });
  const c2 = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "Misafir 42", reservationId: reservation.id } });
  const bodies: Array<[string, string]> = [
    [c1.id, "Merhaba Ayşe, havlular dolapta. İyi tatiller!"],
    [c1.id, "Ayşe Hanım, rica ederim, keyifli konaklamalar."],
    [c1.id, "Sevgili Ayşe Demir, kapı kodunu giriş günü paylaşırız."],
    [c2.id, "Mehmet Bey merhaba, otopark bina önünde."],
    [c2.id, "İyi yolculuklar, Mehmet Bey!"],
    [c2.id, "Rica ederim, her zaman yazabilirsiniz."],
  ];
  for (const [conversationId, body] of bodies) {
    await prisma.message.create({ data: { conversationId, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body } });
  }
  return org.id;
}

beforeEach(async () => {
  await resetDb();
  mockSummarize.mockClear();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-used");
});
afterEach(() => vi.unstubAllEnvs());

describe("üslup profili örneklerinde misafir adı yok", () => {
  it("🚨 görünen ad ve rezervasyon adı (tam + ilk ad) özetleyiciye gitmeden [Misafir] olur; tarz metni korunur", async () => {
    const orgId = await seed();
    const result = await refreshStyleProfile(orgId);
    expect(result.refreshed).toBe(true);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const samples = mockSummarize.mock.calls[0][0] as string[];
    const joined = samples.join("\n");
    for (const name of ["Ayşe", "Demir", "Mehmet", "Kaya"]) expect(joined, name).not.toContain(name);
    // Bilinen sınır (kalite denetçisiyle aynı yardımcı): YALNIZ soyad geçen cümle redakte edilmez — "Kaya", "Demir" gündelik sözcük
    // de olduğu için tek başına soyadı silmek metni bozardı.
    expect(joined).toContain("[Misafir]");
    // Tarz korunur: hitap ve kapanış kalıpları yerinde.
    expect(joined).toContain("havlular dolapta");
    expect(joined).toContain("Rica ederim, her zaman yazabilirsiniz.");
  });

  it("🚨 kanalın AYRI hitap adı da silinir (tam ad 'Robert Smith', hitap adı 'Bob' — ilk sözcük kuralı tutmuyordu)", async () => {
    const orgId = await seed();
    const property = await prisma.property.findFirstOrThrow({ where: { organizationId: orgId } });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Robert Smith",
        guestGivenName: "Bob",
        arrivalDate: new Date(Date.now() - 86_400_000),
        departureDate: new Date(Date.now() + 86_400_000),
        status: "confirmed",
        channel: "airbnb",
      },
    });
    const c3 = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "Robert Smith", reservationId: reservation.id } });
    await prisma.message.create({
      data: { conversationId: c3.id, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: "Hello Bob, the towels are in the closet." },
    });
    await refreshStyleProfile(orgId);
    const joined = (mockSummarize.mock.calls[0][0] as string[]).join("\n");
    expect(joined).not.toContain("Bob");
    expect(joined).toContain("the towels are in the closet");
  });
});
