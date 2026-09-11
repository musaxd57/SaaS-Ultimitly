import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Template creation — pinned around the user-reported bug: the "Tüm mülkler"
// (org-wide) option submits propertyId: null, which the old string-only zod
// shape REJECTED, so every org-wide template creation 400'd with a bare
// "Doğrulama hatası".

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/templates/route";
import { PATCH } from "@/app/api/templates/[id]/route";

const ctx = { params: Promise.resolve({}) };

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const patchReq = (id: string, body: unknown) =>
  new NextRequest(`http://localhost/api/templates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patchCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: "tpl@x.com", passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  return { orgId, propertyId };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("POST /api/templates", () => {
  it("creates an ORG-WIDE template when propertyId is null (the form's 'Tüm mülkler' shape)", async () => {
    const { orgId } = await seed();
    const res = await POST(req({ title: "Hoş geldiniz", body: "hoşgeldiniz.", category: "general", language: "tr", propertyId: null }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.propertyId).toBeNull();
    expect(row.title).toBe("Hoş geldiniz");
  });

  it("empty-string propertyId also normalizes to org-wide (null)", async () => {
    const { orgId } = await seed();
    const res = await POST(req({ title: "Kurallar", body: "Sigara içilmez.", category: "rules", propertyId: "" }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.propertyId).toBeNull();
  });

  it("property-scoped creation still works and foreign property is rejected", async () => {
    const { propertyId } = await seed();
    const ok = await POST(req({ title: "Wi-Fi", body: "Şifre: 1234", category: "wifi", propertyId }), ctx);
    expect(ok.status).toBe(201);

    const foreign = await prisma.organization.create({ data: { name: "Başka Org" } });
    const foreignProp = await prisma.property.create({
      data: { organizationId: foreign.id, name: "yabancı daire" },
    });
    const bad = await POST(req({ title: "Sızma", body: "deneme metni", category: "general", propertyId: foreignProp.id }), ctx);
    expect(bad.status).toBe(400); // tenant isolation: property must belong to the org
  });

  it("missing title returns a FIELD error the UI can show (not just a bare top-level error)", async () => {
    await seed();
    const res = await POST(req({ title: "", body: "içerik metni", category: "general", propertyId: null }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields?.title).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/templates/[id] — DÜZENLEME.
//
// Kurucu bildirdi (09-11): "bunlar gözükmüyor düzenlenmiyr bile". Rota VARDI,
// ekranda DÜĞME YOKTU; rotanın kendisinde de bir boşluk vardı — şema
// `propertyId` alanını hiç tanımıyordu, yani düzenleme formunun gönderdiği
// mülk seçimi SESSİZCE YUTULUYORDU.
// ---------------------------------------------------------------------------
describe("PATCH /api/templates/[id]", () => {
  it("org geneli şablonu TEK MÜLKE taşır (form mülk seçimi artık yutulmuyor)", async () => {
    const { orgId, propertyId } = await seed();
    const row = await prisma.messageTemplate.create({
      data: { organizationId: orgId, propertyId: null, category: "wifi", title: "Wi-Fi", body: "Şifre: 1234" },
    });

    const res = await PATCH(patchReq(row.id, { propertyId }), patchCtx(row.id));
    expect(res.status).toBe(200);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: row.id } })).propertyId).toBe(propertyId);
  });

  it("mülke bağlı şablon 'Tüm mülkler'e geri alınabilir (null yönü de çalışır)", async () => {
    const { orgId, propertyId } = await seed();
    const row = await prisma.messageTemplate.create({
      data: { organizationId: orgId, propertyId, category: "wifi", title: "Wi-Fi", body: "Şifre: 1234" },
    });

    const res = await PATCH(patchReq(row.id, { propertyId: null }), patchCtx(row.id));
    expect(res.status).toBe(200);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: row.id } })).propertyId).toBeNull();
  });

  it("🚨 propertyId GÖNDERİLMEYEN istek mülk bağını BOZMAZ", async () => {
    // Regresyon kapanı: create şemasındaki `.nullish().transform(v => v || null)`
    // buraya kopyalanırsa zod `undefined`'ı `null`'a çevirir VE anahtarı çıktıya
    // koyar — yalnız başlığı değiştiren bir istek şablonu sessizce org geneline
    // taşırdı. Bu satır o kopyalamayı yakalar.
    const { orgId, propertyId } = await seed();
    const row = await prisma.messageTemplate.create({
      data: { organizationId: orgId, propertyId, category: "wifi", title: "Eski", body: "Şifre: 1234" },
    });

    const res = await PATCH(patchReq(row.id, { title: "Yeni başlık" }), patchCtx(row.id));
    expect(res.status).toBe(200);
    const after = await prisma.messageTemplate.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.title).toBe("Yeni başlık");
    expect(after.propertyId, "mülk bağı sessizce koptu").toBe(propertyId);
  });

  it("🚨 BAŞKA ORG'un mülküne taşıma 400 döner ve satıra DOKUNMAZ", async () => {
    const { orgId, propertyId } = await seed();
    const row = await prisma.messageTemplate.create({
      data: { organizationId: orgId, propertyId, category: "wifi", title: "Wi-Fi", body: "Şifre: 1234" },
    });
    const foreign = await prisma.organization.create({ data: { name: "Başka Org" } });
    const foreignProp = await prisma.property.create({
      data: { organizationId: foreign.id, name: "yabancı daire" },
    });

    const res = await PATCH(patchReq(row.id, { propertyId: foreignProp.id }), patchCtx(row.id));
    expect(res.status).toBe(400);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: row.id } })).propertyId).toBe(propertyId);
  });

  it("🚨 BAŞKA ORG'un şablonu düzenlenemez (404, içerik değişmez)", async () => {
    await seed(); // oturum A org'una ait
    const foreign = await prisma.organization.create({ data: { name: "Başka Org" } });
    const foreignRow = await prisma.messageTemplate.create({
      data: { organizationId: foreign.id, propertyId: null, category: "wifi", title: "Yabancı", body: "GIZLI-METIN" },
    });

    const res = await PATCH(patchReq(foreignRow.id, { body: "ELE GECIRILDI" }), patchCtx(foreignRow.id));
    expect(res.status).toBe(404);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: foreignRow.id } })).body).toBe("GIZLI-METIN");
  });

  it("başlık/içerik/dil güncellenir", async () => {
    const { orgId } = await seed();
    const row = await prisma.messageTemplate.create({
      data: { organizationId: orgId, propertyId: null, category: "general", title: "Eski", body: "Eski metin", language: "tr" },
    });

    const res = await PATCH(patchReq(row.id, { title: "Yeni", body: "Yeni metin", language: "en" }), patchCtx(row.id));
    expect(res.status).toBe(200);
    const after = await prisma.messageTemplate.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.title, after.body, after.language]).toEqual(["Yeni", "Yeni metin", "en"]);
  });
});
