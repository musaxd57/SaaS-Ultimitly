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
import { __kbCapHooks } from "@/lib/kb/cap-lock";
import { kbContentFingerprint } from "@/lib/kb/copy-fingerprint";

// ---------------------------------------------------------------------------
// KURUCU D2 + Opus O9 — BELİRLENİMCİ yarış. `kb-copy-update-d2.test.ts`teki gerçek eşzamanlı iki istek hangi isteğin kazanacağını ve
// kaybedenin hangi dala (ön okuma / tekil dizin) düşeceğini seçemez: mutasyon turunda (10-15) "kazanan aynı içerik mi" karşılaştırması
// `false` yapılınca o test YEŞİL kaldı. Burada kopyanın `create` çağrısından hemen önce başka bir istek (kimliksiz) aynı daireye bağlı
// kopyayı yazar → kaybeden HER ZAMAN `(propertyId, copiedFromId)` tekil dizin dalına düşer.
// 11-04: kopya artık plan kilidi altında İŞLEM istemcisinden yazılıyor (Codex 11-04 P2, `kb/cap-lock.ts`) — genel temsilciye kurulan
// `create` casusu onu görmüyordu (yarış hiç kurulmadı, test kırmızı). Araya girme, kilitli bölgenin test kancasından (`afterCount`: sayımdan
// sonra, yazmadan önce) — kazanan satır BAŞKA bağlantıdan yazılır, kaybedenin yazması tekil dizine çarpar.
// ---------------------------------------------------------------------------

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const copy = (sourceId: string, body: unknown) =>
  COPY(new NextRequest(`http://localhost/api/kb/${sourceId}/copy`, json(body)), { params: Promise.resolve({ id: sourceId }) });

/** `null`: yarış yok. `"same"`: kazanan aynı içerik izini yazar. Diğer dize: kazanan o içerik izini yazar. */
let race: string | null = null;
/** Yarışın kaynağı (kazanan bu kalemin kopyasını yazar). */
let raceSourceId = "";
__kbCapHooks.afterCount = async (propertyId: string) => {
  if (race === null) return;
  const hash = race;
  race = null;
  const s = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: raceSourceId } });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId,
      category: s.category,
      title: s.title,
      content: s.content,
      language: s.language,
      isActive: s.isActive,
      copiedFromId: s.id,
      copiedContentHash: hash === "same" ? kbContentFingerprint(s) : hash,
      clientRequestId: null,
    },
  });
};

describe("bilgi tabanı kopyalama — eşzamanlı ikinci kopyanın sonucu (kurucu D2, Opus O9)", () => {
  let src: string;
  let a: string;
  const itemsIn = (propertyId: string) => prisma.knowledgeBaseItem.findMany({ where: { propertyId }, select: { id: true, content: true } });

  beforeEach(async () => {
    race = null;
    await resetDb();
    const made = await makeOrgWithProperty();
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    a = (await prisma.property.create({ data: { organizationId: made.orgId, name: "Lale 2" } })).id;
    src = (await prisma.knowledgeBaseItem.create({ data: { propertyId: made.propertyId, category: "faq", title: "Havuz", content: "Havuz 09:00–20:00 açık.", isActive: true } })).id;
    raceSourceId = src;
  });
  afterAll(async () => {
    __kbCapHooks.afterCount = null;
    await prisma.$disconnect();
  });

  it("🚨 kazanan AYNI içeriği yazdıysa kaybeden 'güncel' sayar (atlandı DEMEZ), dairede tek kopya", async () => {
    race = "same";
    const res = await copy(src, { targetPropertyIds: [a], requestId: RID });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, unchanged: 1, skippedModified: [] });
    expect(race).toBeNull(); // yarış gerçekten kuruldu
    expect((await itemsIn(a)).length).toBe(1);
  });

  it("kazanan BAŞKA içerik yazdıysa kaybeden 'tam şu anda değişti' der, üzerine yazmaz", async () => {
    race = "baska-bir-icerik-izi";
    const body = (await (await copy(src, { targetPropertyIds: [a], requestId: RID })).json()) as {
      created: number;
      unchanged: number;
      skippedModified: { reason: string }[];
    };
    expect(body).toMatchObject({ created: 0, unchanged: 0 });
    expect(body.skippedModified.map((x) => x.reason)).toEqual(["concurrent"]);
    expect(race).toBeNull();
    expect((await itemsIn(a)).length).toBe(1);
  });

  it("yarış yoksa (kontrol) kopya normal yazılır", async () => {
    const res = await copy(src, { targetPropertyIds: [a], requestId: RID });
    expect(await res.json()).toMatchObject({ created: 1, unchanged: 0 });
  });
});
