import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// zod 4 GEÇİŞİ (kurucu kararı 4.15, 10-28): `.partial()` ile isteğe bağlı yapılan alanın `.default()`u zod 4'te UYGULANIR (zod 3'te
// uygulanmıyordu; ölçüldü: `propertySchema.partial().parse({ name })` → giriş 15:00, çıkış 11:00, temizlik 120 EKLENİYOR). Kısmi
// güncellemede bu, GÖNDERİLMEYEN alanı varsayılana EZMEK demektir:
//   · mülk adını değiştiren ev sahibinin giriş / çıkış saati ve temizlik payı sessizce sıfırlanır (misafire yanlış saat gider);
//   · bilgi tabanı kaleminin yalnız metnini düzelten ev sahibinin KAPATTIĞI kalem yeniden AÇILIR (kapatılmış bilgi misafire gider),
//     kategorisi "general"e, dili "tr"ye döner.
// Tip denetimi bunu YAKALAMAZ (çıktı tipi aynı). Bu dosya davranışı rotadan sınar.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH as PATCH_PROPERTY } from "@/app/api/properties/[id]/route";
import { PATCH as PATCH_KB } from "@/app/api/kb/[id]/route";

const req = (url: string, body: unknown) =>
  new NextRequest(url, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const patchProperty = (id: string, body: unknown) =>
  PATCH_PROPERTY(req(`http://localhost/api/properties/${id}`, body), { params: Promise.resolve({ id }) });
const patchKb = (id: string, body: unknown) => PATCH_KB(req(`http://localhost/api/kb/${id}`, body), { params: Promise.resolve({ id }) });

describe("zod 4 — kısmi güncelleme gönderilmeyen alanı varsayılana ezmez", () => {
  let orgId = "";
  let propertyId = "";
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    await prisma.property.update({
      where: { id: propertyId },
      data: { checkInTime: "16:30", checkOutTime: "10:15", cleaningBufferMinutes: 45 },
    });
    const u = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" },
    });
    session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "O", sessionEpoch: 0 } as SessionPayload;
  });

  it("🚨 mülk: yalnız ad değişince giriş / çıkış saati ve temizlik payı AYNEN kalır", async () => {
    const res = await patchProperty(propertyId, { name: "Lale Yeni Ad" });
    expect(res.status).toBe(200);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(p.name).toBe("Lale Yeni Ad");
    expect({ checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, cleaningBufferMinutes: p.cleaningBufferMinutes }).toEqual({
      checkInTime: "16:30",
      checkOutTime: "10:15",
      cleaningBufferMinutes: 45,
    });
  });

  it("🚨 mülk: denetim kaydı yalnız GÖNDERİLEN alanı yazar (varsayılanlar 'değişti' sayılmaz)", async () => {
    expect((await patchProperty(propertyId, { checkInTime: "14:00" })).status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.updated" } });
    expect((JSON.parse(audit.metadataJson ?? "{}") as { fields: string[] }).fields).toEqual(["checkInTime"]);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect({ checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, cleaningBufferMinutes: p.cleaningBufferMinutes }).toEqual({
      checkInTime: "14:00",
      checkOutTime: "10:15",
      cleaningBufferMinutes: 45,
    });
  });

  it("mülk: alan GÖNDERİLDİĞİNDE doğrulama aynen çalışır (aşırı-uygulama kontrolü: varsayılan sökülürken kural sökülmedi)", async () => {
    const bad = await patchProperty(propertyId, { checkInTime: "99:99" });
    expect(bad.status).toBe(400);
    const badBuffer = await patchProperty(propertyId, { cleaningBufferMinutes: 5000 });
    expect(badBuffer.status).toBe(400);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(p.checkInTime).toBe("16:30");
    expect(p.cleaningBufferMinutes).toBe(45);
  });

  it("🚨 mülk: sarf malzemesi profili ALT KÜMEYLE kaydedilir (form yalnız 0'dan büyük kalemleri gönderir; zod 4 enum anahtarlı kayıt hepsini zorunlu kılar)", async () => {
    const res = await patchProperty(propertyId, { supplyProfile: { carsaf_takimi: 2, cop_poseti: 1 } });
    expect(res.status).toBe(200);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(JSON.parse(p.supplyProfileJson!)).toEqual({ carsaf_takimi: 2, cop_poseti: 1 });
    expect(p.checkInTime).toBe("16:30");
  });

  it("mülk: sarf profilinde bilinmeyen kalem ve aralık dışı sayı yine reddedilir (aşırı-uygulama kontrolü)", async () => {
    expect((await patchProperty(propertyId, { supplyProfile: { bilinmeyen: 9 } })).status).toBe(400);
    expect((await patchProperty(propertyId, { supplyProfile: { carsaf_takimi: -1 } })).status).toBe(400);
    expect((await patchProperty(propertyId, { supplyProfile: { carsaf_takimi: 1000 } })).status).toBe(400);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(p.supplyProfileJson).toBeNull();
  });

  it("🚨 bilgi tabanı: KAPATILMIŞ kalemin yalnız metni düzeltilince kalem KAPALI kalır, kategori ve dil değişmez", async () => {
    const kb = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: LaleNet", isActive: false, language: "en" },
    });
    const res = await patchKb(kb.id, { content: "Ağ adı: LaleNet-5G" });
    expect(res.status).toBe(200);
    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } });
    expect(after.content).toBe("Ağ adı: LaleNet-5G");
    expect({ isActive: after.isActive, category: after.category, language: after.language }).toEqual({
      isActive: false,
      category: "wifi",
      language: "en",
    });
  });

  it("bilgi tabanı: alanlar GÖNDERİLDİĞİNDE yazılır (aşırı-uygulama kontrolü) ve oluşturma şemasının varsayılanları yerinde", async () => {
    const kb = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: LaleNet", isActive: false, language: "en" },
    });
    expect((await patchKb(kb.id, { isActive: true, category: "rules", language: "tr" })).status).toBe(200);
    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } });
    expect({ isActive: after.isActive, category: after.category, language: after.language }).toEqual({
      isActive: true,
      category: "rules",
      language: "tr",
    });
    const { kbSchema, propertySchema } = await import("@/lib/validators");
    expect(kbSchema.parse({ propertyId, title: "Ab", content: "cd" })).toMatchObject({ category: "general", language: "tr", isActive: true });
    expect(propertySchema.parse({ name: "Lale" })).toMatchObject({ checkInTime: "15:00", checkOutTime: "11:00", cleaningBufferMinutes: 120 });
  });
});
