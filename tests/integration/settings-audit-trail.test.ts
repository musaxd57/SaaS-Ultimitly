import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Gece-4 S6-14: kuruluş geneli ayar / takvim yazmaları denetim kaydı bırakır (kardeş ayar rotaları — gecelik fiyat, ev kuralları —
// zaten bırakıyordu; kalıcı kararlarda "properties/[id] DELETE audit'siz (açık)" yazıyordu). Kural: alan ADLARI + sayı, DEĞER YOK
// (saat, adres, takvim bağlantısı, ad yazılmaz). Fail = `auditActor` (bürünmede operatör).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as bulkTimes } from "@/app/api/properties/bulk-times/route";
import { POST as bulkSupply } from "@/app/api/properties/bulk-supply-profile/route";
import { PATCH as patchProperty, DELETE as deleteProperty } from "@/app/api/properties/[id]/route";
import { POST as addSource } from "@/app/api/properties/[id]/calendar-sources/route";
import { DELETE as removeSource } from "@/app/api/calendar-sources/[id]/route";

const json = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const bare = (method: string) => new NextRequest("http://localhost/api/x", { method });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noCtx = { params: Promise.resolve({} as Record<string, never>) };

let orgId: string;
let propertyId: string;
let ownerId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const made = await makeOrgWithProperty();
  orgId = made.orgId;
  propertyId = made.propertyId;
  // Denetim kaydının faili GERÇEK kullanıcı (yabancı anahtar; sahte kimlikle kayıt sessizce düşer — writeAudit eylemi bozmaz).
  const owner = await prisma.user.create({ data: { organizationId: orgId, email: "o@x.com", name: "O", passwordHash: "x", role: "owner" } });
  ownerId = owner.id;
  session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function lastAudit(action: string) {
  const rows = await prisma.auditLog.findMany({ where: { organizationId: orgId, action } });
  expect(rows, action).toHaveLength(1);
  return { actor: rows[0].actorUserId, meta: JSON.parse(rows[0].metadataJson ?? "{}") as Record<string, unknown>, raw: rows[0].metadataJson ?? "" };
}

describe("ayar / takvim yazmaları denetim kaydı bırakır — değer yazılmaz (gece-4 S6-14)", () => {
  it("toplu saat: alan adları + daire sayısı; saat değeri YOK", async () => {
    expect((await bulkTimes(json({ checkInTime: "16:30" }), noCtx)).status).toBe(200);
    const a = await lastAudit("property.bulk_times_set");
    expect(a.actor).toBe(ownerId);
    expect(a.meta).toEqual({ fields: ["checkInTime"], updated: 1 });
    expect(a.raw).not.toContain("16:30");
  });

  it("toplu malzeme profili: alt küme işareti + sayı", async () => {
    expect((await bulkSupply(json({ supplyProfile: { towels: 2 }, propertyIds: [propertyId] }), noCtx)).status).toBe(200);
    expect((await lastAudit("property.bulk_supply_profile_set")).meta).toEqual({ fields: ["supplyProfile"], updated: 1, subset: true });
  });

  it("daire güncelleme: gönderilen alan adları; ad / adres değeri YOK", async () => {
    expect((await patchProperty(json({ name: "Lale Yeni", address: "Gizli Sokak 5" }, "PATCH"), ctx(propertyId))).status).toBe(200);
    const a = await lastAudit("property.updated");
    expect(a.actor).toBe(ownerId);
    expect(a.meta).toEqual({ propertyId, fields: ["name", "address"] });
    expect(a.raw).not.toMatch(/Lale Yeni|Gizli Sokak/);
  });

  it("takvim bağlantısı ekle / sil: kimlikler + çözülen satır sayısı; bağlantı adresi ve etiket YOK", async () => {
    const created = await addSource(json({ label: "Airbnb Lale", url: "https://www.airbnb.com/calendar/ical/123.ics?s=gizli" }), ctx(propertyId));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const added = await lastAudit("calendar_source.added");
    expect(added.meta).toEqual({ propertyId, calendarSourceId: id });
    expect(added.raw).not.toMatch(/airbnb\.com|gizli|Airbnb Lale/);

    await prisma.reservation.create({
      data: { propertyId, guestName: "G", arrivalDate: new Date(), departureDate: new Date(Date.now() + 86_400_000), status: "confirmed", channel: "airbnb", calendarSourceId: id, sourceReference: "u1" },
    });
    expect((await removeSource(bare("DELETE"), ctx(id))).status).toBe(200);
    expect((await lastAudit("calendar_source.removed")).meta).toEqual({ propertyId, calendarSourceId: id, detachedReservations: 1 });
  });

  it("daire silme: yalnız kimlik; başarısız (başka kiracı) silme kayıt BIRAKMAZ", async () => {
    const other = await makeOrgWithProperty();
    session = { ...session, organizationId: other.orgId };
    expect((await deleteProperty(bare("DELETE"), ctx(propertyId))).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: "property.deleted" } })).toBe(0);

    session = { ...session, organizationId: orgId };
    expect((await deleteProperty(bare("DELETE"), ctx(propertyId))).status).toBe(200);
    expect((await lastAudit("property.deleted")).meta).toEqual({ propertyId });
  });

  it("doğrulamada reddedilen yazma kayıt bırakmaz", async () => {
    expect((await bulkTimes(json({ checkInTime: "25:99" }), noCtx)).status).toBe(400);
    expect((await patchProperty(json({ name: "  " }, "PATCH"), ctx(propertyId))).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
