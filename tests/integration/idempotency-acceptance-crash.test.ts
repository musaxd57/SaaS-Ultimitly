import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue({ notified: false, throttled: false, configured: false }) }));

import { POST as COPY } from "@/app/api/kb/[id]/copy/route";

// ---------------------------------------------------------------------------
// TEKRAR GÜVENLİĞİ — KISMİ KOPYALAMA, ÇÖKME ORTASINDA (kurucu 10-15 madde 4). A / B yazıldı, C'nin yazması DÜŞTÜ (veritabanı hatası →
// 500); istemci AYNI kimlikle yeniden dener → yalnız eksik daire(ler) yazılır, A / B'ye ikinci kopya gitmez. Hedef sırası veritabanına
// bağlı olduğu için iddia sıradan bağımsız: ilk denemede yazılanlar + yeniden denemede yazılanlar = 3, her dairede TAM 1 kopya.
// AYRI DOSYA: Prisma temsilcisine casus sonraki testlere sızmasın (CLAUDE.md dersi).
// ---------------------------------------------------------------------------

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const copy = (sourceId: string, body: unknown) =>
  COPY(
    new NextRequest(`http://localhost/api/kb/${sourceId}/copy`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: sourceId }) },
  );

describe("4 · Kısmi kopyalama — C'nin yazması düştü", () => {
  let propertyId: string;
  let a: string;
  let b: string;
  let c: string;
  let srcId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    const mk = (name: string) => prisma.property.create({ data: { organizationId: made.orgId, name } }).then((p) => p.id);
    a = await mk("Lale 2");
    b = await mk("Lale 3");
    c = await mk("Lale 4");
    srcId = (await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Metin.", isActive: true } })).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ilk deneme C'de 500 ile düşer; aynı kimlikle yeniden deneme YALNIZ eksikleri yazar — her dairede tam bir kopya", async () => {
    const realCreate = prisma.knowledgeBaseItem.create.bind(prisma.knowledgeBaseItem);
    let failedOnce = false;
    vi.spyOn(prisma.knowledgeBaseItem, "create").mockImplementation(((args: { data: { propertyId: string } }) => {
      if (args.data.propertyId === c && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error("connection reset"));
      }
      return realCreate(args as never);
    }) as never);

    const first = await copy(srcId, { targetPropertyIds: [a, b, c], requestId: RID }).catch(() => null);
    expect(first === null || first.status >= 500).toBe(true); // ilk deneme düştü (yanıt yok ya da 5xx)
    expect(failedOnce).toBe(true);
    const writtenFirst = await prisma.knowledgeBaseItem.count({ where: { propertyId: { in: [a, b, c] } } });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: c } })).toBe(0); // C yazılmadı

    const retry = await copy(srcId, { targetPropertyIds: [a, b, c], requestId: RID });
    expect(retry.status).toBe(200);
    const { created } = (await retry.json()) as { created: number };
    expect(created).toBe(3 - writtenFirst); // yalnız eksikler
    for (const p of [a, b, c]) expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: p } })).toBe(1);
  });
});
