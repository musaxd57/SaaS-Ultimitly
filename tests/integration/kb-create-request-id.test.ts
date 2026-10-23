import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET, POST as CREATE } from "@/app/api/kb/route";
import { PATCH } from "@/app/api/kb/[id]/route";
import { planLimitsFor } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// KB İÇE AKTARIM TEKRAR GÜVENLİĞİ (migration 67, kurucu 10-14 "İstek kimliği"; Y10 dış incelemesinin açık kalanı).
//
// Eski girdi: "Metinden bilgi çıkar" → Ekle; sunucu kalemi YAZDI ama cevap misafirin (ev sahibinin) tarayıcısına ulaşmadan bağlantı koptu.
// Eski sonuç: ekran kalemi "eklenemedi" sanıp önizlemede tutuyordu → "tekrar dene" AYNI kalemi İKİNCİ kez ekliyordu (iki Wi-Fi kaydı;
// biri sonra düzeltilirse yapay zekâ eski değeri de okuyabilir). Yeni sonuç: istemci kalem başına kimlik yollar; aynı mülk + aynı kimlik
// ikinci kalem açmaz, ilk kalem döner. Gerçek PostgreSQL + gerçek rota.
// ---------------------------------------------------------------------------

const createReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const create = (body: unknown) => CREATE(createReq(body), { params: Promise.resolve({}) });
const wifi = (propertyId: string, extra: Record<string, unknown> = {}) => ({
  propertyId,
  category: "wifi",
  title: "Wi-Fi",
  content: "Ağ adı: Lale_5G — şifre ev sahibinde.",
  language: "tr",
  isActive: true,
  ...extra,
});

describe("KB oluşturma — istek kimliğiyle tekrar güvenliği", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const count = () => prisma.knowledgeBaseItem.count({ where: { propertyId } });

  it("🚨 aynı kimlikle yeniden deneme İKİNCİ kalem açmaz; ilk kalem döner (200)", async () => {
    const first = await create(wifi(propertyId, { requestId: RID }));
    expect(first.status).toBe(201);
    const a = (await first.json()) as { id: string };
    expect(a).not.toHaveProperty("clientRequestId"); // iç alan yanıtta yok (Opus 10-15 B3)
    const again = await create(wifi(propertyId, { requestId: RID }));
    expect(again.status).toBe(200);
    const b = (await again.json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(b).not.toHaveProperty("clientRequestId");
    expect(await count()).toBe(1);
    // Liste ve düzenleme yanıtları da iç alanı taşımaz.
    const list = (await (await GET(new NextRequest(`http://localhost/api/kb?propertyId=${propertyId}`), { params: Promise.resolve({}) })).json()) as Record<string, unknown>[];
    expect(list.length).toBe(1);
    expect(list[0]).not.toHaveProperty("clientRequestId");
    const patched = await PATCH(
      new NextRequest(`http://localhost/api/kb/${a.id}`, { method: "PATCH", body: JSON.stringify({ title: "Wi-Fi 2" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(await patched.json()).not.toHaveProperty("clientRequestId");
  });

  it("🚨 iki yeniden deneme AYNI ANDA → tek kalem, ikisi de aynı kalemi alır", async () => {
    const [r1, r2] = await Promise.all([
      create(wifi(propertyId, { requestId: RID })),
      create(wifi(propertyId, { requestId: RID })),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const ids = new Set([((await r1.json()) as { id: string }).id, ((await r2.json()) as { id: string }).id]);
    expect(ids.size).toBe(1);
    expect(await count()).toBe(1);
  });

  it("🚨 plan sınırı DOLUYKEN yeniden deneme: ilk deneme yazdıysa başarı döner (sınır hatası değil, ikinci kalem değil)", async () => {
    const limit = planLimitsFor("business").kbItemsPerProperty;
    for (let i = 0; i < limit - 1; i++) {
      await prisma.knowledgeBaseItem.create({ data: { propertyId, title: `k${i}`, content: "x".repeat(10), isActive: true } });
    }
    expect((await create(wifi(propertyId, { requestId: RID }))).status).toBe(201); // sınır şimdi dolu
    const retry = await create(wifi(propertyId, { requestId: RID }));
    expect(retry.status).toBe(200);
    expect(await count()).toBe(limit);
    // Kontrol: YENİ kimlikle ekleme sınırdan döner.
    expect((await create(wifi(propertyId, { requestId: "f".repeat(32) }))).status).toBe(400);
  });

  it("🚨 ilk istek kalemi yazıp eşitlemeden önce kesildiyse yeniden deneme mülk hafızasını TAMAMLAR (Haiku 10-14)", async () => {
    // İlk isteğin yalnız INSERT'i oldu (süreç hafıza eşitlemesinden önce düştü): kalem var, hafıza satırı yok.
    const orphan = await prisma.knowledgeBaseItem.create({
      // İçerik isteğin AYNISI (kurucu 10-15 sonrası: aynı kimlik + farklı içerik açık uyuşmazlıktır, `idempotency-acceptance.test.ts`).
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_5G — şifre ev sahibinde.", language: "tr", isActive: true, source: "host_manual", reviewState: "approved", approvedAt: new Date(), clientRequestId: RID },
    });
    expect(await prisma.propertyMemory.count({ where: { propertyId, sourceRef: orphan.id } })).toBe(0);
    const retry = await create(wifi(propertyId, { requestId: RID }));
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { id: string }).id).toBe(orphan.id);
    expect(await prisma.propertyMemory.count({ where: { propertyId, sourceRef: orphan.id } })).toBe(1);
  });

  it("KONTROL: kimliksiz (elle ekleme) eski davranış — iki istek iki kalem", async () => {
    expect((await create(wifi(propertyId))).status).toBe(201);
    expect((await create(wifi(propertyId))).status).toBe(201);
    expect(await count()).toBe(2);
    const rows = await prisma.knowledgeBaseItem.findMany({ where: { propertyId } });
    expect(rows.every((r) => r.clientRequestId === null)).toBe(true);
  });

  it("KONTROL: farklı kimlik = farklı kalem; aynı kimlik BAŞKA mülkte ayrı kalem", async () => {
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Daire B" } });
    expect((await create(wifi(propertyId, { requestId: RID }))).status).toBe(201);
    expect((await create(wifi(propertyId, { requestId: "b".repeat(32) }))).status).toBe(201);
    expect((await create(wifi(other.id, { requestId: RID }))).status).toBe(201);
    expect(await count()).toBe(2);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: other.id } })).toBe(1);
  });

  it("🚨 başka işletmenin mülküne kimlikle istek: mülk reddi (kimlik başka işletmenin kalemini DÖNDÜRMEZ)", async () => {
    expect((await create(wifi(propertyId, { requestId: RID }))).status).toBe(201);
    const foreign = await makeOrgWithProperty();
    session = { ...session, organizationId: foreign.orgId };
    const res = await create(wifi(propertyId, { requestId: RID }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("Lale_5G");
  });

  it("biçimsiz kimlik reddedilir; düzenleme (PATCH) kimliği kabul etmez / değiştirmez", async () => {
    expect((await create(wifi(propertyId, { requestId: "kısa" }))).status).toBe(400);
    expect((await create(wifi(propertyId, { requestId: "x".repeat(65) }))).status).toBe(400);
    const made = (await (await create(wifi(propertyId, { requestId: RID }))).json()) as { id: string };
    // Düzenleme rotası ayrıştırılan veriyi DOĞRUDAN yazar (`data: d`): alan şemadan çıkarılmasa bilinmeyen alan → 500 olurdu.
    const patched = await PATCH(patchReq({ title: "Wi-Fi 2", requestId: "c".repeat(32) }), { params: Promise.resolve({ id: made.id }) });
    expect(patched.status).toBe(200);
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.title).toBe("Wi-Fi 2");
    expect(row.clientRequestId).toBe(RID);
  });
});
