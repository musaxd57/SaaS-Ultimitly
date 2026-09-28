import { describe, it, expect, beforeEach, vi } from "vitest";
import { treeText } from "../helpers/tree-text";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Gönderilenler önizlemesi GÖNDERİCİYLE aynı adı gösterir (kurucu kararı 09-28): ad bilinmiyorsa ("Rezervasyon HM4K2") şablonun
// `{isim}` belirteci boşluğuyla kalkar — "Merhaba {isim}, hoş geldiniz" → "Merhaba, hoş geldiniz". Eski önizleme yer tutucu adı
// tam haliyle basıyordu ("Merhaba Rezervasyon HM4K2, …").
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import SentPage from "@/app/(app)/sent/page";

const mockAuth = vi.mocked(requireAuth);

async function seed(guestName: string) {
  const org = await prisma.organization.create({ data: { name: "Gönderilenler Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "welcome", title: "Karşılama", content: "Merhaba {isim}, hoş geldiniz.", isActive: true },
  });
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName,
      arrivalDate: new Date("2026-06-20T00:00:00Z"),
      departureDate: new Date("2026-06-22T00:00:00Z"),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-sent-name",
      welcomeSentAt: new Date("2026-06-19T09:00:00Z"),
    },
  });
  mockAuth.mockResolvedValue({ userId: "u1", organizationId: org.id, role: "owner", email: "o@x.com" } as never);
}

async function renderText(): Promise<string> {
  return treeText(await SentPage({ searchParams: Promise.resolve({ type: "welcome" }) }));
}

describe("Gönderilenler — karşılama önizlemesi ad bilinmiyorken", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 yer tutucu ad önizlemeye girmez: 'Merhaba, hoş geldiniz.'", async () => {
    await seed("Rezervasyon HM4K2");
    const text = await renderText();
    expect(text).toContain("Merhaba, hoş geldiniz.");
    expect(text).not.toContain("Merhaba Rezervasyon");
  });

  it("KONTROL — gerçek adda ilk ad", async () => {
    await seed("Ayşe Yılmaz");
    expect(await renderText()).toContain("Merhaba Ayşe, hoş geldiniz.");
  });
});
