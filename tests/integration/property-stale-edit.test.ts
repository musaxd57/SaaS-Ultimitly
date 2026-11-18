import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 H2 — eski mülk formu başkasının kaydettiği çıkış saatini geri alamaz. "Daire Ayarları" formu TAM form gönderir (ad, adres,
// saatler, temizlik tamponu, notlar, misafire görünen ad): B çıkışı 12:00 yapar, A eski formda yalnız adresi değiştirip kaydeder → eskiden
// A'nın formundaki 11:00 geri yazılıyordu (iki istek de 200). Ön şart: formun açıldığı sürüm (`expectedUpdatedAt`); gönderilmezse
// (malzeme profili gibi tek alan gönderen yüzeyler, eski istemci) bugünkü davranış.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/properties/[id]/route";
import { KB_STALE_EDIT_MESSAGE } from "@/lib/kb/stale-edit";

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/properties/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) },
  );

// `PropertyForm`un gönderdiği tam gövde (sayfa null alanları "" olarak verir).
const form = (over: Record<string, unknown> = {}) => ({
  name: "Test Property",
  address: "",
  city: "",
  country: "",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  cleaningBufferMinutes: 120,
  notes: "",
  guestDisplayName: "",
  ...over,
});

const auditCount = (orgId: string) => prisma.auditLog.count({ where: { organizationId: orgId, action: "property.updated" } });

describe("mülk formu — eski form koruması (H2)", () => {
  let orgId = "";
  let propertyId = "";
  let openedAt = "";
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    // Gerçek kullanıcı: denetim kaydının yazarı kullanıcı tablosuna bağlı (yoksa kayıt sessizce düşer ve sayım testi boşa çıkar).
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 } as SessionPayload;
    openedAt = (await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).updatedAt.toISOString();
  });

  it("🚨 B çıkışı 12:00 yaptı → A eski formla (yalnız adres değişik) kaydedince 409; çıkış 12:00 ve adres KORUNUR, denetim kaydı yazılmaz", async () => {
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: openedAt })).status).toBe(200);
    const before = await auditCount(orgId);
    const a = await patch(propertyId, { ...form({ address: "Yeni adres 5" }), expectedUpdatedAt: openedAt });
    expect(a.status).toBe(409);
    expect((await a.json()).error).toBe(KB_STALE_EDIT_MESSAGE);
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ checkOutTime: "12:00", address: null });
    expect(await auditCount(orgId)).toBe(before);
  });

  it("KONTROL: yanıttaki sürümle art arda kayıt geçer; sürüm göndermeyen tek alanlı yazım (malzeme profili) bugünkü gibi geçer", async () => {
    const first = await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: openedAt });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.updatedAt).toBe((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).updatedAt.toISOString());
    // Yanıt gizli anahtarları yine taşımaz (sürüm alanı eklemek bu sözleşmeyi değiştirmedi).
    expect(body).not.toHaveProperty("icalToken");
    expect(body).not.toHaveProperty("chatToken");
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00", address: "Adres 1" }), expectedUpdatedAt: body.updatedAt })).status).toBe(200);
    expect((await patch(propertyId, { supplyProfile: { banyo_havlusu: 2 } })).status).toBe(200);
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ checkOutTime: "12:00", address: "Adres 1" });
  });

  it("denetim kaydının alan listesinde ön şart YOK (yazılan alan değil)", async () => {
    expect((await patch(propertyId, { checkOutTime: "12:00", expectedUpdatedAt: openedAt })).status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.updated" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(row.metadataJson ?? "{}").fields).toEqual(["checkOutTime"]);
  });

  it("sürüm milisaniye hassas: aynı an farklı yazımla (saat dilimi) geçer, milisaniyesi kırpılmış sürüm 409", async () => {
    await prisma.$executeRaw`UPDATE "Property" SET "updatedAt" = '2026-03-04 05:06:07.891' WHERE "id" = ${propertyId}`;
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: "2026-03-04T05:06:07.000Z" })).status).toBe(409);
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: "2026-03-04T05:06:07.890Z" })).status).toBe(409);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).checkOutTime).toBe("11:00");
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: "2026-03-04T08:06:07.891+03:00" })).status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).checkOutTime).toBe("12:00");
  });

  it("geçersiz / saklanamayacak sürüm 400 (500 değil), hiçbir şey yazılmaz", async () => {
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: "dün" })).status).toBe(400);
    expect((await patch(propertyId, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: new Date(253402300800000).toISOString() })).status).toBe(400);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).checkOutTime).toBe("11:00");
  });

  it("başka işletmenin dairesi sürüm ön şartıyla da 404 (kapsam değişmedi)", async () => {
    const other = await makeOrgWithProperty();
    const foreign = await prisma.property.findUniqueOrThrow({ where: { id: other.propertyId } });
    const res = await patch(foreign.id, { ...form({ checkOutTime: "12:00" }), expectedUpdatedAt: foreign.updatedAt.toISOString() });
    expect(res.status).toBe(404);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: foreign.id } })).checkOutTime).toBe("11:00");
  });
});
