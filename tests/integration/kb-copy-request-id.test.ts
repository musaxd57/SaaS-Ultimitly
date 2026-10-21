import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
const { warmMock } = vi.hoisted(() => ({ warmMock: vi.fn() }));
vi.mock("@/lib/ai/embeddings/kb-warm", () => ({ warmPropertyKbVectorsBestEffort: warmMock }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { limitsForOrg } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// BİLGİ TABANI KOPYALAMA — TEKRAR GÜVENLİĞİ (idempotency denetimi 10-15, P1; migration YOK, 67'nin (mülk, kimlik) dizini).
// Ölçülen boşluk: "3 daireye kopyala" çift tık / bağlantı cevap anında koptu → her hedef dairede İKİ aynı kalem. Sözleşme:
//  · aynı istek kimliği (sıralı ya da EŞ ZAMANLI) → her hedefte tek kopya; kimliksiz eski istemci eski davranışta;
//  · yeniden denemeye eklenen yeni daire yazılır, öncekiler atlanır; ilk deneme sınırı doldurduysa yeniden deneme "atlandı" demez;
//  · aynı kimlik BAŞKA bir kaynağın kopyasını engellemez (anahtar kaynağı taşır); bozuk kimlik 400.
// ---------------------------------------------------------------------------

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RID2 = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

const copyReq = (sourceId: string, body: unknown) =>
  COPY(
    new NextRequest(`http://localhost/api/kb/${sourceId}/copy`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: sourceId }) },
  );

describe("KB kopyalama — istek kimliği", () => {
  let orgId: string;
  let sourceProp: string;
  let a: string;
  let b: string;
  let c: string;
  let sourceId: string;

  const copiesIn = (propertyId: string) => prisma.knowledgeBaseItem.count({ where: { propertyId, title: "Wi-Fi" } });

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    sourceProp = made.propertyId;
    const mk = (name: string) => prisma.property.create({ data: { organizationId: orgId, name } }).then((p) => p.id);
    a = await mk("Lale 2");
    b = await mk("Lale 3");
    c = await mk("Lale 4");
    sourceId = (
      await prisma.knowledgeBaseItem.create({
        data: { propertyId: sourceProp, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_5G.", isActive: true },
      })
    ).id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 aynı kimlikle iki sıralı istek → her hedefte TEK kopya; ikinci cevap created 0, uyarı yok", async () => {
    const r1 = await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ created: 2, skippedAtLimit: 0 });
    const r2 = await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID });
    expect(r2.status).toBe(200);
    const j2 = (await r2.json()) as Record<string, unknown>;
    expect(j2).toMatchObject({ created: 0, skippedAtLimit: 0 });
    expect(j2.notice).toBeUndefined();
    expect(await copiesIn(a)).toBe(1);
    expect(await copiesIn(b)).toBe(1);
  });

  it("🚨 aynı kimlikle EŞ ZAMANLI iki istek (gerçek PostgreSQL) → her hedefte TEK kopya, ikisi de 200", async () => {
    const [r1, r2] = await Promise.all([
      copyReq(sourceId, { targetPropertyIds: [a, b, c], requestId: RID }),
      copyReq(sourceId, { targetPropertyIds: [a, b, c], requestId: RID }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const created = ((await r1.json()) as { created: number }).created + ((await r2.json()) as { created: number }).created;
    expect(created).toBe(3);
    for (const p of [a, b, c]) expect(await copiesIn(p)).toBe(1);
  });

  it("kurucu D2 (10-15): farklı kimlikle ya da kimliksiz yeniden kopyalama bu kaynağın kopyası olan dairede İKİNCİ kalem açmaz (eski kopya güncel → dokunulmaz)", async () => {
    await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    const again = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID2 });
    expect(await again.json()).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(await copiesIn(a)).toBe(1);
    await copyReq(sourceId, { targetPropertyIds: [b] });
    await copyReq(sourceId, { targetPropertyIds: [b] });
    expect(await copiesIn(b)).toBe(1);
  });

  it("yeniden deneme, ilk istek eşitlemeden ÖNCE kesildiyse hedeflerin vektör eşitlemesini tamamlar (Opus B2)", async () => {
    // İlk istek kopyayı yazdı ama eşitleme koşmadı (süreç düştü): kopya satırı doğrudan konur.
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: a, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_5G.", isActive: true, clientRequestId: `copy:${sourceId}:${RID}` },
    });
    warmMock.mockClear();
    const r = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    expect(await r.json()).toMatchObject({ created: 0 });
    expect(warmMock).toHaveBeenCalledWith(a);
  });

  it("yeniden denemeye eklenen daire yazılır, öncekiler atlanır", async () => {
    await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID });
    const r = await copyReq(sourceId, { targetPropertyIds: [a, b, c], requestId: RID });
    expect(await r.json()).toMatchObject({ created: 1, skippedAtLimit: 0 });
    for (const p of [a, b, c]) expect(await copiesIn(p)).toBe(1);
  });

  it("🚨 ilk deneme hedefin sınırını doldurduysa yeniden deneme 'sınır nedeniyle atlandı' DEMEZ", async () => {
    const limit = (await limitsForOrg(orgId)).kbItemsPerProperty;
    for (let i = 0; i < limit - 1; i++) {
      await prisma.knowledgeBaseItem.create({ data: { propertyId: a, title: `k${i}`, content: "x".repeat(10), isActive: true } });
    }
    const r1 = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    expect(await r1.json()).toMatchObject({ created: 1, skippedAtLimit: 0 });
    const r2 = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    const j2 = (await r2.json()) as Record<string, unknown>;
    expect(j2).toMatchObject({ created: 0, skippedAtLimit: 0 });
    expect(j2.notice).toBeUndefined();
    // Aynı kaynağın YENİ kimlikle yeniden kopyası (kurucu D2): dairedeki değişmemiş kopya güncel sayılır — ikinci kopya açılmaz.
    const r3 = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID2 });
    expect(await r3.json()).toMatchObject({ created: 0, unchanged: 1, skippedAtLimit: 0 });
    // Aşırı uygulama kontrolü: sınır kapısı BAŞKA bir kaynağın yeni kopyasında hâlâ çalışır.
    const other = await prisma.knowledgeBaseItem.create({
      data: { propertyId: sourceProp, category: "parking", title: "Otopark", content: "Bina önünde.", isActive: true },
    });
    const r4 = await copyReq(other.id, { targetPropertyIds: [a], requestId: RID2 });
    expect(await r4.json()).toMatchObject({ created: 0, skippedAtLimit: 1 });
  });

  it("aynı kimlik başka kaynağın kopyasını engellemez (anahtar kaynağı taşır)", async () => {
    const other = await prisma.knowledgeBaseItem.create({
      data: { propertyId: sourceProp, category: "parking", title: "Otopark", content: "Bina önünde.", isActive: true },
    });
    await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    const r = await copyReq(other.id, { targetPropertyIds: [a], requestId: RID });
    expect(await r.json()).toMatchObject({ created: 1 });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: a } })).toBe(2);
  });

  it.each([["kısa", "abc"], ["iki nokta (uzunluğu yeterli — yalnız ':' yüzünden)", "copy:abcdefgh01234567"], ["sayı", 12345678]])("bozuk kimlik (%s) → 400, hiçbir şey yazılmaz", async (_n, rid) => {
    const r = await copyReq(sourceId, { targetPropertyIds: [a], requestId: rid });
    expect(r.status).toBe(400);
    expect(await copiesIn(a)).toBe(0);
  });

  it("ekleme rotasının kimliği kopya anahtarıyla çakışmaz (aynı dairede aynı kimlik iki yolda iki kalem)", async () => {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: a, category: "wifi", title: "Elle", content: "x", isActive: true, clientRequestId: RID },
    });
    const r = await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID });
    expect(await r.json()).toMatchObject({ created: 1 });
    expect(await copiesIn(a)).toBe(1);
  });

  it("🚨 Codex 10-21: araya BAŞKA kopyalama girip kalemdeki kimliği değiştirse de eski işlem unutulmaz — kaynak değiştiyse eski kimlikle tekrar 409, hiçbir şey yazılmaz", async () => {
    // A işlemi (RID) iki daireye eski metni yazar.
    expect((await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID })).status).toBe(200);
    // Kaynak değişir; B işlemi (RID2) yeni metni yazar → kalemlerin kimliği RID2 olur.
    await prisma.knowledgeBaseItem.update({ where: { id: sourceId }, data: { content: "Ağ adı: Lale_6G." } });
    expect((await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID2 })).status).toBe(200);
    const before = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: { in: [a, b] } }, select: { id: true, content: true, updatedAt: true }, orderBy: { id: "asc" } });
    // Eski A sekmesi aynı kimlikle yeniden dener: kaynak A'nın ilk denemesinden beri değişti → 409, daireler olduğu gibi.
    const retry = await copyReq(sourceId, { targetPropertyIds: [a, b], requestId: RID });
    expect(retry.status).toBe(409);
    const after = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: { in: [a, b] } }, select: { id: true, content: true, updatedAt: true }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
  });

  it("KONTROL: kaynak DEĞİŞMEDEN aynı kimlikle tekrar 200 (araya başka işlem girse de)", async () => {
    expect((await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID })).status).toBe(200);
    expect((await copyReq(sourceId, { targetPropertyIds: [b], requestId: RID2 })).status).toBe(200);
    expect((await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID })).status).toBe(200);
    expect(await prisma.kbCopyOperation.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("işlem kaydı 30 günden eskiyse temizlenir (işletme kapsamı)", async () => {
    await prisma.kbCopyOperation.create({
      data: { organizationId: orgId, sourceItemId: "eski", requestId: RID, sourceHash: "x", createdAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    await copyReq(sourceId, { targetPropertyIds: [a], requestId: RID2 });
    expect(await prisma.kbCopyOperation.count({ where: { organizationId: orgId, sourceItemId: "eski" } })).toBe(0);
  });
});

