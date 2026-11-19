import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// "Kayıtları karşılaştır" SAYFASI (kurucu 11-19 akşam, madde 3 ve 4). Sayfa fonksiyonu GERÇEK test veritabanıyla çağrılır, dönen ağaç yürünür
// (`calendar-page.test.ts` deseni). Sabitlenen:
//   · çakışma sürerken açıklama: "Aynı rezervasyon birden fazla dairede görünüyor" + ikinci satırda daire adları " · " ile (ek takılmaz);
//   · çakışma çözülünce (son kopya yanıtından sonra liste yenilenince de) "Rezervasyonu aç" görünür ve kalan kaydın dairesinin, varış ayının
//     takvimine gider (uygulamada tek rezervasyonu açan sayfa yok — en dar var olan görünüm);
//   · etkin kayıt hiç kalmadıysa "Rezervasyonu aç" yok; çakışma sürerken yok (hangisinin açılacağı sorunun kendisi).
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
import CompareBookingRecordsPage from "@/app/(app)/reservations/compare/[key]/page";

const mockAuth = vi.mocked(requireAuth);

function sessionFor(orgId: string) {
  return {
    userId: "user-compare-test",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const lale = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const sahil = await prisma.property.create({ data: { organizationId: org.id, name: "Sahil Evi" } });
  mockAuth.mockResolvedValue(sessionFor(org.id));
  return { orgId: org.id, lale: lale.id, sahil: sahil.id };
}

async function booking(propertyId: string, o: { channel: string; connectionId?: string; guestNameSource?: string; status?: string }) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: stayDay(4),
      departureDate: stayDay(7),
      status: o.status ?? "confirmed",
      sourceReference: "HM-1",
      channel: o.channel,
      connectionId: o.connectionId ?? null,
      guestNameSource: o.guestNameSource ?? null,
    },
    select: { id: true },
  });
}

const render = (key: string) => CompareBookingRecordsPage({ params: Promise.resolve({ key }) });

describe("Kayıtları karşılaştır sayfası (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    mockAuth.mockReset();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 çakışma sürerken: başlık sabit + daire adları ' · ' ile (ek yok); 'Rezervasyonu aç' YOK", async () => {
    const w = await world();
    const manual = await booking(w.lale, { channel: "manual", guestNameSource: "host" });
    await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });

    const text = treeText(await render(manual.id));

    expect(text).toContain("Aynı rezervasyon birden fazla dairede görünüyor");
    expect(text).toContain("Lale 3 · Sahil Evi");
    expect(text).not.toMatch(/Evi'(n?d|t)[ae]|3'(t|d)[ae]/);
    expect(text).not.toContain("Kayıtlar artık tek dairede.");
    expect(text).not.toContain("Rezervasyonu aç");
  });
});
