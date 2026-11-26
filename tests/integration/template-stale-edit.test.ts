import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 H1 — eski şablon düzenleyicisi başkasının kaydettiği metni geri yazamaz. Düzenleme formu TAM form gönderir (başlık, metin,
// kategori, dil, daire): A ve B aynı şablonu açar, A metni değiştirip kaydeder, B yalnız başlığı değiştirip kaydeder → eskiden B'nin
// formundaki ESKİ metin A'nın metnini sessizce geri getiriyordu (iki istek de 200). Ön şart: formun açıldığı sürüm (`expectedUpdatedAt`).
// Gönderilmezse (eski istemci / API çağıranı) bugünkü davranış.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/templates/[id]/route";
import { KB_STALE_EDIT_MESSAGE } from "@/lib/kb/stale-edit";

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) },
  );

const OLD_BODY = "Hoş geldiniz! Giriş saatimiz 15:00.";
const NEW_BODY = "Hoş geldiniz! Giriş saatimiz 14:00.";
const form = (over: Record<string, unknown> = {}) => ({ title: "Karşılama", body: OLD_BODY, category: "general", language: "tr", propertyId: null, ...over });

describe("şablon düzenleme — eski form koruması (H1)", () => {
  let orgId = "";
  let propertyId = "";
  let templateId = "";
  let openedAt = "";
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O" } as SessionPayload;
    const t = await prisma.messageTemplate.create({ data: { organizationId: orgId, title: "Karşılama", body: OLD_BODY, category: "general", language: "tr" } });
    templateId = t.id;
    openedAt = t.updatedAt.toISOString(); // iki sekme de bu sürümle açıldı
  });

  it("🚨 A metni kaydetti → B eski formla (yalnız başlık değişik) kaydedince 409; A'nın metni ve başlığı KORUNUR", async () => {
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: openedAt })).status).toBe(200);
    const b = await patch(templateId, { ...form({ title: "Karşılama mesajı" }), expectedUpdatedAt: openedAt });
    expect(b.status).toBe(409);
    expect((await b.json()).error).toBe(KB_STALE_EDIT_MESSAGE);
    const row = await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(row).toMatchObject({ title: "Karşılama", body: NEW_BODY });
  });

  it("🚨 eski form daire bağını da geri alamaz (409, şablon A'nın seçtiği dairede kalır)", async () => {
    expect((await patch(templateId, { ...form({ propertyId }), expectedUpdatedAt: openedAt })).status).toBe(200);
    expect((await patch(templateId, { ...form(), expectedUpdatedAt: openedAt })).status).toBe(409);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).propertyId).toBe(propertyId);
  });

  it("KONTROL: güncel sürümle art arda kayıt geçer; sürüm göndermeyen istek bugünkü gibi koşulsuz yazar", async () => {
    const first = await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: openedAt });
    expect(first.status).toBe(200);
    // İstemci yanıttaki sürümü saklar (sayfa yenilenmeden ikinci düzenleme sahte çatışma vermesin) — yanıt sürümü taşımalı.
    const fresh = (await first.json()).updatedAt as string;
    expect(fresh).toBe((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).updatedAt.toISOString());
    expect((await patch(templateId, { ...form({ body: NEW_BODY, title: "Karşılama 2" }), expectedUpdatedAt: fresh })).status).toBe(200);
    expect((await patch(templateId, { isActive: false })).status).toBe(200);
    expect((await patch(templateId, form({ title: "Eski istemci" }))).status).toBe(200);
    expect(await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).toMatchObject({ title: "Eski istemci", body: OLD_BODY, isActive: false });
  });

  it("sürüm milisaniye hassas: aynı an farklı yazımla (saat dilimi) geçer, milisaniyesi kırpılmış sürüm 409", async () => {
    await prisma.$executeRaw`UPDATE "MessageTemplate" SET "updatedAt" = '2026-03-04 05:06:07.891' WHERE "id" = ${templateId}`;
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: "2026-03-04T05:06:07.000Z" })).status).toBe(409);
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: "2026-03-04T05:06:07.892Z" })).status).toBe(409);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).body).toBe(OLD_BODY);
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: "2026-03-04T08:06:07.891+03:00" })).status).toBe(200);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).body).toBe(NEW_BODY);
  });

  it("geçersiz / saklanamayacak sürüm 400 (500 değil), hiçbir şey yazılmaz", async () => {
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: "dün" })).status).toBe(400);
    expect((await patch(templateId, { ...form({ body: NEW_BODY }), expectedUpdatedAt: new Date(253402300800000).toISOString() })).status).toBe(400);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } })).body).toBe(OLD_BODY);
  });

  it("başka işletmenin şablonu sürüm ön şartıyla da 404 (kapsam değişmedi)", async () => {
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    const foreign = await prisma.messageTemplate.create({ data: { organizationId: other.id, title: "X", body: "yabancı metin", category: "general" } });
    const res = await patch(foreign.id, { ...form({ body: NEW_BODY }), expectedUpdatedAt: foreign.updatedAt.toISOString() });
    expect(res.status).toBe(404);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: foreign.id } })).body).toBe("yabancı metin");
  });
});
