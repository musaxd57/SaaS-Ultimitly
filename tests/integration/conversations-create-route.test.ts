import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİRACI SINIRI — gövdede kimlik alan konuşma rotası (gece-4 S10-01, değişmez 16). `POST /api/conversations` istemcinin gönderdiği
// `propertyId` + `reservationId`'yi alır; rotada açık IDOR koruması var ama hiçbir test bu rotayı çağırmıyordu (mekanik kiracılar arası
// kapsam pini yalnız `[id]` yollarını görür). Saldırgan (A işletmesi) ↔ kurban (B işletmesi): yabancı mülk / yabancı rezervasyon / aynı
// işletmenin BAŞKA mülküne ait rezervasyon → 400 ve hiçbir satır yazılmaz; liste (GET) yalnız kendi işletmesini döndürür.
// Mutasyon (10-18): mülk kapısı, rezervasyon-mülk eşleşmesi ve GET süzgeci kaldırılınca kırmızı. Rezervasyon sorgusundaki işletme süzgeci
// EŞDEĞER mutant: mülk işletmeye ait doğrulandı ve rezervasyon o mülke bağlı olmak zorunda — ikinci kat savunma, ayırt eden durum kurulamaz.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/automation", async (orig) => ({
  ...(await orig<typeof import("@/lib/automation")>()),
  applyInboundMessageRules: vi.fn(async () => undefined),
}));

import { GET, POST } from "@/app/api/conversations/route";

const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx as never);

async function orgWithOwner(tag: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: tag, email: `${tag}@x.com`, passwordHash: "x", role: "owner" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: `Misafir ${tag}`, arrivalDate: new Date("2026-11-01T00:00:00Z"), departureDate: new Date("2026-11-04T00:00:00Z") },
  });
  return { orgId, propertyId, reservationId: reservation.id, session: { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: tag, sessionEpoch: 0 } as SessionPayload };
}

const base = { guestIdentifier: "Misafir", firstMessage: "Merhaba, Wi-Fi şifresi nedir?" };

beforeEach(async () => {
  await resetDb();
  session = null;
});

describe("POST /api/conversations — kiracı sınırı (S10-01)", () => {
  it("🚨 başka işletmenin mülkü → 400, konuşma açılmaz", async () => {
    const a = await orgWithOwner("a");
    const b = await orgWithOwner("b");
    session = a.session;
    const res = await post({ ...base, propertyId: b.propertyId });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ propertyId: "Geçersiz mülk" });
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("🚨 kendi mülkü + başka işletmenin rezervasyonu → 400 (misafir verisi kenar çubuğuna sızmaz)", async () => {
    const a = await orgWithOwner("a");
    const b = await orgWithOwner("b");
    session = a.session;
    const res = await post({ ...base, propertyId: a.propertyId, reservationId: b.reservationId });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ reservationId: "Geçersiz rezervasyon" });
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("🚨 kendi işletmesinin BAŞKA mülküne ait rezervasyon → 400", async () => {
    const a = await orgWithOwner("a");
    const other = await prisma.property.create({ data: { organizationId: a.orgId, name: "İkinci daire" } });
    const otherRes = await prisma.reservation.create({
      data: { propertyId: other.id, guestName: "Başka", arrivalDate: new Date("2026-11-01T00:00:00Z"), departureDate: new Date("2026-11-03T00:00:00Z") },
    });
    session = a.session;
    const res = await post({ ...base, propertyId: a.propertyId, reservationId: otherRes.id });
    expect(res.status).toBe(400);
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("KONTROL: kendi mülkü + kendi rezervasyonu → 201; GET yalnız kendi işletmesinin konuşmalarını döndürür", async () => {
    const a = await orgWithOwner("a");
    const b = await orgWithOwner("b");
    session = b.session;
    expect((await post({ ...base, propertyId: b.propertyId, reservationId: b.reservationId })).status).toBe(201);
    session = a.session;
    const res = await post({ ...base, propertyId: a.propertyId, reservationId: a.reservationId });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ propertyId: a.propertyId, reservationId: a.reservationId });
    const list = (await (await GET(new NextRequest("http://localhost/api/conversations"), ctx as never)).json()) as Array<{ propertyId: string }>;
    expect(list.map((c) => c.propertyId)).toEqual([a.propertyId]);
  });
});
