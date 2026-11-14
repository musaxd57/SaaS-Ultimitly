import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { bootstrapMemoryFromKnowledgeBase } from "@/modules/intelligence";

// ---------------------------------------------------------------------------
// PASİF KALEMİN METNİ OKUNMAZ (sızma testi 11-14, L-8). Pasif bilgi tabanı kalemi plan sınırına sayılmaz (sayısı sınırsız); hafıza önyüklemesi
// her KB yazımında ve zamanlanmış geçişte BÜTÜN kalemlerin metnini belleğe alıyordu. Metin yalnız hafızaya yazılacak (etkin + okunabilir)
// kalemler için okunur. AYRI dosya: Prisma temsilcisine kurulan casus sonraki testlere sızar (CLAUDE.md).
// ---------------------------------------------------------------------------

// Prisma temsilcisi vekil (Proxy): çıplak `vi.spyOn` özgün yöntemi kaybeder → özgün yöntem ÖNCE bağlanır, casus onu çağırır (depodaki kalıp).
type FindArgs = { select?: Record<string, boolean>; where?: { id?: { in?: string[] } } };
const realFindMany = prisma.knowledgeBaseItem.findMany.bind(prisma.knowledgeBaseItem) as unknown as (a: FindArgs) => Promise<unknown>;
let recorded: FindArgs[] | null = null;
vi.spyOn(prisma.knowledgeBaseItem, "findMany").mockImplementation(((a: FindArgs) => {
  recorded?.push(a);
  return realFindMany(a);
}) as unknown as typeof prisma.knowledgeBaseItem.findMany);

describe("hafıza önyüklemesi — pasif kalemin metni okunmaz", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    recorded = null;
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ilk okuma metin seçmez; metin yalnız etkin + okunabilir kalemler için istenir; sonuç (hafıza satırları) aynı", async () => {
    const active = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı LaleNet.", isActive: true, reviewState: "approved", source: "manual" },
    });
    for (let i = 0; i < 3; i++) {
      await prisma.knowledgeBaseItem.create({
        data: { propertyId, category: "general", title: `Pasif ${i}`, content: "x".repeat(2000), isActive: false, reviewState: "approved", source: "manual" },
      });
    }
    recorded = [];
    const out = await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    const calls = recorded;
    recorded = null;
    // Hiçbir okuma pasif kalemin metnini istemez.
    const textCalls = calls.filter((c) => c.select?.content);
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]!.where?.id?.in).toEqual([active.id]);
    expect(out.created).toBe(1);
    const mem = await prisma.propertyMemory.findMany({ where: { organizationId: orgId, source: "kb_item" } });
    expect(mem.map((m) => [m.sourceRef, m.body, m.status])).toEqual([[active.id, "Ağ adı LaleNet.", "active"]]);
  });

  it("KONTROL: hiç etkin kalem yoksa metin okuması hiç yapılmaz; var olan hafıza satırı emekliye ayrılır", async () => {
    const item = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı LaleNet.", isActive: true, reviewState: "approved", source: "manual" },
    });
    await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    await prisma.knowledgeBaseItem.update({ where: { id: item.id }, data: { isActive: false } });
    recorded = [];
    const out = await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    const textCalls = recorded.filter((c) => c.select?.content);
    recorded = null;
    expect(textCalls).toHaveLength(0);
    expect(out.retired).toBe(1);
  });
});
