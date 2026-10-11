import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — `{daire}` ÇÖZÜLEMEZSE: yalnız o mesaj gönderilmez (tahmin yok), ev sahibi mülk sayfasında HANGİ metnin
// NEDEN durduğunu ve nasıl düzelteceğini görür; numarası okunabilen mülkte her şey aynen.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes } from "@/lib/automation";
import { requireAuth } from "@/lib/auth";
import PropertyDetailPage from "@/app/(app)/properties/[id]/page";

const mockSend = vi.mocked(sendOnChannel);
const mockAuth = vi.mocked(requireAuth);
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function seed(propertyName: string, welcome: string) {
  const enabledAt = new Date("2026-01-01T00:00:00Z");
  const org = await prisma.organization.create({
    data: { name: "Daire Org", timezone: "Europe/Istanbul", autoWelcome: true, autoWelcomeEnabledAt: enabledAt },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: propertyName } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "welcome", title: "Karşılama mesajı", content: welcome, isActive: true },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ada Demir",
      arrivalDate: midnight("2026-06-20"),
      departureDate: midnight("2026-06-22"),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-daire",
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: reservation.id };
}

describe("karşılama mesajı — daire numarası okunamıyorsa GİTMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-20T07:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("🚨 'Lale' (numara yok) + '{daire}' → gönderilmez, damgalanmaz (ham '{daire}' misafire gitmez)", async () => {
    const { orgId, reservationId } = await seed("Lale", "Merhaba {isim}, daireniz {daire}. Kapı kodu size ayrıca iletilecek.");
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(0);
    expect(out.unfilled).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } })).welcomeSentAt).toBeNull();
  });

  it("KONTROL — 'Lale Daire 5' → numara doldurulur, mesaj gider", async () => {
    const { orgId } = await seed("Lale Daire 5", "Merhaba {isim}, daireniz {daire}.");
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend.mock.calls[0][1]).toBe("Merhaba Ada, daireniz 5.");
  });
});

describe("mülk sayfası — daire numarası uyarısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "");
    vi.stubEnv("QR_PIN_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const session = (orgId: string, role: string) =>
    ({ userId: "u-daire", organizationId: orgId, role, email: "d@example.com" }) as never;
  const render = (propertyId: string) =>
    PropertyDetailPage({ params: Promise.resolve({ id: propertyId }), searchParams: Promise.resolve({}) });

  it("🚨 numara okunamıyor + '{daire}' kullanan kalem → uyarı, kalemin adı ve düzeltme yolu görünür", async () => {
    const { orgId, propertyId } = await seed("Lale", "Merhaba {isim}, daireniz {daire}.");
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    const text = treeText(await render(propertyId));
    expect(text).toContain("Daire numarası okunamadı");
    expect(text).toContain("Karşılama mesajı");
    expect(text).toContain("mülk adına daire numarasını ekleyin");
  });

  it("KONTROL — numara okunabiliyorsa, kalem '{daire}' kullanmıyorsa ya da personelse uyarı YOK", async () => {
    const a = await seed("Lale Daire 5", "Merhaba {isim}, daireniz {daire}.");
    mockAuth.mockResolvedValue(session(a.orgId, "owner"));
    expect(treeText(await render(a.propertyId))).not.toContain("Daire numarası okunamadı");

    await resetDb();
    const b = await seed("Lale", "Merhaba {isim}, hoş geldiniz.");
    mockAuth.mockResolvedValue(session(b.orgId, "owner"));
    expect(treeText(await render(b.propertyId))).not.toContain("Daire numarası okunamadı");

    await resetDb();
    const c = await seed("Lale", "Daireniz {daire}.");
    mockAuth.mockResolvedValue(session(c.orgId, "staff"));
    // Personel sayfayı HİÇ çizemez (yönetici kapısı, 10-11) → uyarı da yok; /tasks'a yönlendirilir.
    await expect(render(c.propertyId)).rejects.toMatchObject({ digest: expect.stringContaining(";/tasks;") });
  });
});
