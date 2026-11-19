import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { probeQueries, probeSummary } from "../helpers/query-probe";
import { seedRequestPathOrg, ownerSession } from "../helpers/request-path-fixture";

// ---------------------------------------------------------------------------
// İSTEK YOLU — SORGU SAYISI VE ŞELALE DERİNLİĞİ PİNLERİ (optimizasyon turu 11-19). Ev sahibinin açtığı sayfaların veritabanına kaç kez
// gittiği ve en uzun ARDIŞIK bekleme zinciri (`tests/helpers/query-probe.ts`: her Prisma çağrısına sabit gecikme; derinlik = birbirini
// bekleyen çağrı zinciri — makine yükünden bağımsız). Bağımsız okumalar aynı anda koşar; bir değişiklik onları yeniden sıraya dizerse ya
// da daire / rezervasyon sayısıyla büyüyen sorgu eklerse burası kırmızıya döner. Sınırlar ÖLÇÜLEN değer (pay yok — tek bir fazladan
// ardışık bekleme de yakalansın; derinlik saat değil çağrı sırası olduğundan kararlıdır): sınırı büyütmeden önce yeni beklemenin gerçekten
// öncekine BAĞLI olduğunu doğrulayın.
// Sayfa, entegrasyon testlerinin deseniyle çağrılır (gerçek test veritabanı, oturum taklit).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAuth: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { requireAuth } from "@/lib/auth";
import PropertyDetailPage from "@/app/(app)/properties/[id]/page";

const DELAY_MS = 12;
const sp = <T,>(v: T) => Promise.resolve(v);

describe("istek yolu: sorgu sayısı + şelale derinliği", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("/properties/[id]: bağımsız bölümler aynı anda okunur (eskiden ardışık 12 bekleme → 3)", async () => {
    const f = await seedRequestPathOrg({ properties: 2 });
    for (const id of f.propertyIds) await prisma.property.update({ where: { id }, data: { icalToken: `tok-${id}` } });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const r = await probeQueries(() => PropertyDetailPage({ params: sp({ id: f.propertyIds[0] }), searchParams: sp({}) }), { delayMs: DELAY_MS });
    // Ölçüm boş değil: sayfanın bütün bölümleri okundu (hafıza, kural, temizlikçi, otomatik mesaj, kardeş daireler…).
    expect(r.ops, probeSummary(r)).toBeGreaterThanOrEqual(14);
    expect(r.byOp["AutoMessageTemplate.findMany"], probeSummary(r)).toBe(1);
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(3);
  });

  it("/properties/[id] takvim anahtarı yokken: anahtar bütün okumalardan SONRA tek kez yazılır", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const r = await probeQueries(() => PropertyDetailPage({ params: sp({ id: f.propertyIds[0] }), searchParams: sp({}) }), { delayMs: DELAY_MS });
    const writes = r.timeline.filter((o) => o.op === "Property.updateMany");
    expect(writes, probeSummary(r)).toHaveLength(1);
    const reads = r.timeline.filter((o) => o.start < writes[0].start && o !== writes[0]);
    expect(reads.length).toBeGreaterThanOrEqual(14);
    expect(reads.every((o) => o.end <= writes[0].start)).toBe(true);
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(6);
  });
});
