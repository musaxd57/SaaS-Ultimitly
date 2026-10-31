import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/ai/embeddings/kb-warm", () => ({ warmPropertyKbVectorsBestEffort: vi.fn() }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { PATCH as EDIT } from "@/app/api/kb/[id]/route";

// ---------------------------------------------------------------------------
// KURUCU D2 (10-15, aynen): "Eski kopyayı güncelle seçeneğini onaylıyorum. Yalnız seçtiğim hedeflerde, bu kaynaktan geldiği doğrulanmış
// ve son kopyalamadan beri yerelde değiştirilmemiş kalem güncellensin. Yerel değişiklik varsa üzerine yazma; hangi dairede neden
// atlandığını göster. Eşzamanlı düzenlemeyi de koru. Kaynak bağı bilinmeyen eski kayıtları benzerliğe göre eşleştirme."
// ---------------------------------------------------------------------------

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RID2 = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const copy = (sourceId: string, body: unknown) =>
  COPY(new NextRequest(`http://localhost/api/kb/${sourceId}/copy`, json(body)), { params: Promise.resolve({ id: sourceId }) });
const edit = (id: string, body: unknown) =>
  EDIT(new NextRequest(`http://localhost/api/kb/${id}`, { ...json(body), method: "PATCH" }), { params: Promise.resolve({ id }) });

describe("bilgi tabanı yeniden kopyalama — eski kopyayı güncelle (kurucu D2)", () => {
  let orgId: string;
  let src: string;
  let a: string;
  let b: string;
  let c: string;
  const itemsIn = (propertyId: string) => prisma.knowledgeBaseItem.findMany({ where: { propertyId }, select: { id: true, content: true } });

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    const mk = (name: string) => prisma.property.create({ data: { organizationId: orgId, name } }).then((p) => p.id);
    a = await mk("Lale 2");
    b = await mk("Lale 3");
    c = await mk("Lale 4");
    src = (await prisma.knowledgeBaseItem.create({ data: { propertyId: made.propertyId, category: "faq", title: "Havuz", content: "Havuz 09:00–20:00 açık.", isActive: true } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 gece-4 S5-05: kaynak 'yerine koy' ile YENİ kimlikli kaleme geçti → yeni kalemin kopyalanması eski kopyayı günceller (ikinci etkin kopya yok)", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    // Geçmişten öğren L2 "eskisinin yerine koy": yeni kalem açılır, eskisi emekli (pasif + supersededById).
    const srcProp = (await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: src } })).propertyId;
    const replacement = await prisma.knowledgeBaseItem.create({
      data: { propertyId: srcProp, category: "faq", title: "Havuz", content: "Havuz 08:00–23:00 açık.", isActive: true },
    });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { isActive: false, supersededById: replacement.id, supersededAt: new Date() } });

    const res = await copy(replacement.id, { targetPropertyIds: [a], requestId: RID2 });

    expect(await res.json()).toMatchObject({ created: 0, updated: 1, skippedModified: [] });
    const inA = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: a }, select: { content: true, isActive: true, copiedFromId: true } });
    expect(inA).toEqual([{ content: "Havuz 08:00–23:00 açık.", isActive: true, copiedFromId: replacement.id }]);
    // Bağ taşındı: bir sonraki kopyalama doğrudan bulur, "güncel" der.
    expect(await (await copy(replacement.id, { targetPropertyIds: [a] })).json()).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it("gece-4 S5-05 ayna: hedefteki kopya yerelde YERİNE KONMUŞSA (emekli) güncellenmiş sayılmaz — atlandı (elle değiştirildi), seçilen yeni kalem korunur", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    const copyInA = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: a, copiedFromId: src } });
    const localNew = await prisma.knowledgeBaseItem.create({
      data: { propertyId: a, category: "faq", title: "Havuz", content: "Havuz bu dairede 10:00–18:00.", isActive: true },
    });
    await prisma.knowledgeBaseItem.update({ where: { id: copyInA.id }, data: { isActive: false, supersededById: localNew.id, supersededAt: new Date() } });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });

    const body = await (await copy(src, { targetPropertyIds: [a], requestId: RID2 })).json();

    expect(body).toMatchObject({ created: 0, updated: 0, skippedModified: [{ propertyId: a, reason: "modified" }] });
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: localNew.id } })).content).toBe("Havuz bu dairede 10:00–18:00.");
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: copyInA.id } })).content).toBe("Havuz 09:00–20:00 açık.");
  });

  it("🚨 kaynak değişti → yeniden kopyalama A ve B'deki KOPYAYI günceller (ikinci kalem yok; çelişkili iki bilgi kalmaz)", async () => {
    await copy(src, { targetPropertyIds: [a, b], requestId: RID });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    const res = await copy(src, { targetPropertyIds: [a, b], requestId: RID2 });
    expect(await res.json()).toMatchObject({ created: 0, updated: 2, skippedModified: [] });
    for (const p of [a, b]) expect((await itemsIn(p)).map((x) => x.content)).toEqual(["Havuz 09:00–22:00 açık."]);
  });

  it("🚨 dairede elle düzenlenmiş kopyanın ÜZERİNE YAZILMAZ; hangi dairede neden atlandığı söylenir; diğeri güncellenir", async () => {
    await copy(src, { targetPropertyIds: [a, b], requestId: RID });
    const [bCopy] = await itemsIn(b);
    expect((await edit(bCopy.id, { content: "Havuz 09:00–21:00 (cumartesi 23:00)." })).status).toBe(200);
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    const res = await copy(src, { targetPropertyIds: [a, b], requestId: RID2 });
    const body = (await res.json()) as { updated: number; notice?: string; skippedModified: { name: string; reason: string }[] };
    expect(body.updated).toBe(1);
    expect(body.skippedModified).toEqual([{ propertyId: b, name: "Lale 3", reason: "modified" }]);
    expect(body.notice).toContain("Lale 3");
    expect((await itemsIn(a)).map((x) => x.content)).toEqual(["Havuz 09:00–22:00 açık."]);
    expect((await itemsIn(b)).map((x) => x.content)).toEqual(["Havuz 09:00–21:00 (cumartesi 23:00)."]);
  });

  it("🚨 GÜNCELLEME dalında da tekrar güvenliği: A güncellendi, C düştü, kaynak ARADA değişti → aynı kimlikle tekrar 409, hiçbir şey yazılmaz (Codex 10-16)", async () => {
    const RID3 = "1234567890abcdef1234567890abcdef";
    await copy(src, { targetPropertyIds: [a, c], requestId: RID }); // A ve C'de eski kopyalar (20:00)
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    // Yeni işlem A'yı güncelledi, C'ye gelmeden kesildi (aynı sonuç: yalnız A hedefli ilk deneme).
    expect(await (await copy(src, { targetPropertyIds: [a], requestId: RID3 })).json()).toMatchObject({ updated: 1 });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–23:00 açık." } });
    const res = await copy(src, { targetPropertyIds: [a, c], requestId: RID3 });
    expect(res.status).toBe(409); // ⬅️ ESKİDE 200 + iki kopya da 23:00
    expect((await itemsIn(a)).map((x) => x.content)).toEqual(["Havuz 09:00–22:00 açık."]);
    expect((await itemsIn(c)).map((x) => x.content)).toEqual(["Havuz 09:00–20:00 açık."]);
  });

  it("KONTROL: aynı kimlikle tekrar, kaynak DEĞİŞMEDİYSE kaldığı yerden sürer (A atlanır, C güncellenir)", async () => {
    const RID3 = "1234567890abcdef1234567890abcdef";
    await copy(src, { targetPropertyIds: [a, c], requestId: RID });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    await copy(src, { targetPropertyIds: [a], requestId: RID3 });
    const res = await copy(src, { targetPropertyIds: [a, c], requestId: RID3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, updated: 1 });
    for (const p of [a, c]) expect((await itemsIn(p)).map((x) => x.content)).toEqual(["Havuz 09:00–22:00 açık."]);
  });

  it("aşırı uygulama yok: yalnız SEÇİLEN hedefler güncellenir; seçilmeyen dairedeki kopya eski metinde kalır", async () => {
    await copy(src, { targetPropertyIds: [a, b], requestId: RID });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    await copy(src, { targetPropertyIds: [a], requestId: RID2 });
    expect((await itemsIn(b)).map((x) => x.content)).toEqual(["Havuz 09:00–20:00 açık."]);
  });

  it("🚨 kaynak bağı bilinmeyen ESKİ kayıt benzerliğe göre eşleştirilmez (aynı metin olsa da) → yeni kopya açılır, eskiye dokunulmaz", async () => {
    const legacy = await prisma.knowledgeBaseItem.create({ data: { propertyId: c, category: "faq", title: "Havuz", content: "Havuz 09:00–20:00 açık.", isActive: true } });
    const res = await copy(src, { targetPropertyIds: [c], requestId: RID });
    expect(await res.json()).toMatchObject({ created: 1, updated: 0 });
    expect((await itemsIn(c)).length).toBe(2);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: legacy.id } })).copiedFromId).toBeNull();
  });

  it("kopya başka KAYNAĞIN kopyasıyla karışmaz: farklı kaynaktan gelen kalem güncellenmez", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    const other = await prisma.knowledgeBaseItem.create({ data: { propertyId: b, category: "faq", title: "Otopark", content: "Arkada.", isActive: true } });
    await copy(other.id, { targetPropertyIds: [a], requestId: RID2 });
    const contents = (await itemsIn(a)).map((x) => x.content).sort();
    expect(contents).toEqual(["Arkada.", "Havuz 09:00–20:00 açık."]);
  });

  it("🚨 Opus O10a: aynı kimliğin yeniden denemesinde HEDEF kopya arada elle düzenlendiyse 'kaynak değişti' (409) DENMEZ — kaynak değişmedi", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    const [copyA] = await itemsIn(a);
    expect((await edit(copyA.id, { content: "Havuz 09:00–21:00 açık (cumartesi 23)." })).status).toBe(200);
    const retry = await copy(src, { targetPropertyIds: [a, b], requestId: RID });
    expect(retry.status).toBe(200);
    expect((await itemsIn(a)).map((x) => x.content)).toEqual(["Havuz 09:00–21:00 açık (cumartesi 23)."]);
    expect((await itemsIn(b)).map((x) => x.content)).toEqual(["Havuz 09:00–20:00 açık."]);
  });

  it("🚨 Opus O9: farklı kimlikli iki kopyalama AYNI ANDA → dairede TEK bağlı kopya (tekil dizin; kaybeden 'güncel' sayılır)", async () => {
    const [r1, r2] = await Promise.all([copy(src, { targetPropertyIds: [a], requestId: RID }), copy(src, { targetPropertyIds: [a], requestId: RID2 })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: a, copiedFromId: src } })).toBe(1);
    // Kaybedenin hangi dala düştüğünü bu gerçek yarış seçemez — belirlenimci iki yarış `kb-copy-race-d2.test.ts`te.
  });

  it("tekrar güvenliği: aynı yeniden kopyalama tekrar gönderilirse ikinci güncelleme / kalem yok (güncel → dokunulmaz)", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    await copy(src, { targetPropertyIds: [a], requestId: RID2 });
    const again = await copy(src, { targetPropertyIds: [a], requestId: RID2 });
    expect(await again.json()).toMatchObject({ created: 0, updated: 0 });
    expect((await itemsIn(a)).length).toBe(1);
  });

  it("🚨 eşzamanlı düzenleme korunur: kopya okunduktan sonra ev sahibi düzenlerse güncelleme YAZILMAZ ('tam şu anda düzenlendi')", async () => {
    await copy(src, { targetPropertyIds: [a], requestId: RID });
    await prisma.knowledgeBaseItem.update({ where: { id: src }, data: { content: "Havuz 09:00–22:00 açık." } });
    const [aCopy] = await itemsIn(a);
    // Kopyalama kopyayı okuduktan hemen sonra ev sahibi düzenler: updateMany çağrısından ÖNCE satırı değiştiren tek seferlik araya girme.
    const realUpdateMany = prisma.knowledgeBaseItem.updateMany.bind(prisma.knowledgeBaseItem);
    const spy = vi.spyOn(prisma.knowledgeBaseItem, "updateMany").mockImplementationOnce((async (args: Parameters<typeof realUpdateMany>[0]) => {
      await prisma.knowledgeBaseItem.update({ where: { id: aCopy.id }, data: { content: "Ev sahibinin yeni metni." } });
      return realUpdateMany(args);
    }) as never);
    try {
      const res = await copy(src, { targetPropertyIds: [a], requestId: RID2 });
      const body = (await res.json()) as { updated: number; skippedModified: { reason: string }[] };
      expect(body.updated).toBe(0);
      expect(body.skippedModified.map((x) => x.reason)).toEqual(["concurrent"]);
    } finally {
      spy.mockRestore();
    }
    expect((await itemsIn(a)).map((x) => x.content)).toEqual(["Ev sahibinin yeni metni."]);
  });
});
