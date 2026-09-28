import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { PROVIDER_MESSAGEABLE_RESERVATION_WHERE, reservationMessagingCapable } from "@/lib/channels/capability";

// ---------------------------------------------------------------------------
// ELLE REZERVASYON OLUŞTURMA — kanal bir YÖNLENDİRME işaretçisidir (gece güvenlik denetimi 09-28, kodda doğrulandı).
// `POST /api/reservations` istemcinin `channel: "airbnb" | "booking" | "direct" | "other"` ile birlikte serbest bir
// `sourceReference` yazmasına izin veriyordu → satır `PROVIDER_MESSAGEABLE_RESERVATION_WHERE`e uyuyor, karşılama / giriş /
// çıkış göndericileri bu referansı sağlayıcı rezervasyon kimliği sanıp POST ediyordu (uydurma kimlik → her koşuda 4xx +
// alarm; org'un kendi hesabındaki GERÇEK bir kimlik → bu mülkün giriş bilgisi başka bir rezervasyonun misafirine). CSV içe
// aktarma aynı deliği 08-08'de kapatmıştı (kanal "manual"a sabit); tekil yol unutulmuştu. Elle girilen referans sağlayıcıda
// DOĞRULANMIŞ bir kimlik değildir → referans verilince kanal "manual" (mekanizma işaretçisi). Referans yoksa kanal etiketi
// aynen kalır (zaten mesajlanabilir değil).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as createReservation } from "@/app/api/reservations/route";

const noCtx = { params: Promise.resolve({} as Record<string, never>) };

let propertyId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const made = await makeOrgWithProperty();
  propertyId = made.propertyId;
  session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterAll(async () => {
  await prisma.$disconnect();
});

const create = (extra: Record<string, unknown>) =>
  createReservation(
    new NextRequest("http://localhost/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId,
        guestName: "Ada",
        arrivalDate: daysFromNow(1).toISOString(),
        departureDate: daysFromNow(3).toISOString(),
        status: "confirmed",
        ...extra,
      }),
    }),
    noCtx,
  );

describe("elle rezervasyon: sağlayıcıya yönlendirilemez", () => {
  for (const channel of ["airbnb", "booking", "direct", "other"]) {
    it(`🚨 channel "${channel}" + referans → mesajlanabilir DEĞİL (kanal "manual", referans korunur)`, async () => {
      const res = await create({ channel, sourceReference: "HX-123456" });
      expect(res.status).toBe(201);
      const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      expect(row.channel).toBe("manual");
      expect(row.sourceReference).toBe("HX-123456");
      expect(reservationMessagingCapable(row)).toBe(false);
      // Göndericilerin yaydığı AYNI fragment: aday listesine girmez.
      expect(await prisma.reservation.count({ where: { propertyId, ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE } })).toBe(0);
    });
  }

  it("KONTROL — referans yoksa kanal etiketi aynen kalır (zaten mesajlanabilir değil)", async () => {
    const res = await create({ channel: "direct" });
    expect(res.status).toBe(201);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(row.channel).toBe("direct");
    expect(reservationMessagingCapable(row)).toBe(false);
  });

  it("KONTROL — referansla mükerrer kayıt yine reddedilir (tekillik korunur)", async () => {
    expect((await create({ channel: "airbnb", sourceReference: "HX-1" })).status).toBe(201);
    expect((await create({ channel: "airbnb", sourceReference: "HX-1" })).status).toBe(400);
  });
});
