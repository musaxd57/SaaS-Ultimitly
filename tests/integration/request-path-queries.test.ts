import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { probeQueries, probeSummary } from "../helpers/query-probe";
import { seedRequestPathOrg, ownerSession } from "../helpers/request-path-fixture";

// ---------------------------------------------------------------------------
// İSTEK YOLU — SORGU SAYISI VE ŞELALE DERİNLİĞİ PİNLERİ (optimizasyon turu 11-19). Ev sahibinin açtığı sayfaların veritabanına kaç kez
// gittiği ve en uzun ARDIŞIK bekleme zinciri (`tests/helpers/query-probe.ts`: her Prisma çağrısına sabit gecikme; derinlik = birbirini
// bekleyen çağrı zinciri — makine yükünden bağımsız). Bağımsız okumalar aynı anda koşar; bir değişiklik onları yeniden sıraya dizerse ya
// da daire / rezervasyon sayısıyla büyüyen sorgu eklerse burası kırmızıya döner. Sınırlar ÖLÇÜLEN değer (pay yok — tek bir fazladan
// ardışık bekleme de yakalansın); yalnız çok dallı yüzeylerde bir basamak pay (↓ `DELAY_MS`). Sınırı büyütmeden önce yeni beklemenin
// gerçekten öncekine BAĞLI olduğunu doğrulayın.
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
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import DashboardPage from "@/app/(app)/dashboard/page";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import TasksPage from "@/app/(app)/tasks/page";

// Gecikme, kritik yol boyunca biriken sorgu süresi farkından büyük olmalı: 12 ms'de pano ölçümü 10 / 11 arasında oynuyordu (dallar arası
// kayma sahte bağımlılık üretiyordu); 30-50 ms'de sekiz tekrarda sabit. Yük altında (dört çekirdeğin üçü dolu) pano yine nadiren +1 →
// çok dallı yüzeylerde (pano, Girişler) sınır ölçülenin bir üstü.
const DELAY_MS = 40;
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

  it("/inbox/[id] (30 sn'de bir yenilenir): işletme okuması konuşmayı, sözler / iç notlar / dönen misafir ana turu beklemez (7 → 3)", async () => {
    const f = await seedRequestPathOrg({ properties: 2 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const r = await probeQueries(() => ConversationPage({ params: sp({ id: f.arrivalConversationIds[0] }), searchParams: sp({}) }), { delayMs: DELAY_MS });
    expect(r.byOp["GuestCommitment.findMany"], probeSummary(r)).toBe(1);
    expect(r.byOp["InternalNote.findMany"], probeSummary(r)).toBe(1);
    expect(r.ops, probeSummary(r)).toBeGreaterThanOrEqual(15);
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(3);
  });

  it("/inbox/[id] başka işletmenin / olmayan konuşma: 404 (işletme okuması öne alındı ama sonuç beklenmez)", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    await expect(ConversationPage({ params: sp({ id: "yok" }), searchParams: sp({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("findAttentionItems (pano 'Dikkat'): işletme saat dilimi bir kez, bacaklar aynı turda (12 → 7); sorgu sayısı daire sayısına bağlı değil", async () => {
    const measure = async (n: number) => {
      await resetDb();
      const f = await seedRequestPathOrg({ properties: n });
      return probeQueries(() => findAttentionItems(f.orgId), { delayMs: DELAY_MS });
    };
    const three = await measure(3);
    const six = await measure(6);
    expect(three.result.length, probeSummary(three)).toBeGreaterThan(0);
    // Çıkış günü + söz saati AYNI satırı okurdu (eskiden 2 okuma); öteki okuma müsaitlik bacağının kendi okuması.
    expect(three.byOp["Organization.findUnique"], probeSummary(three)).toBe(2);
    expect(three.depth, probeSummary(three)).toBeLessThanOrEqual(7);
    expect(six.sql, `${probeSummary(three)}\n${probeSummary(six)}`).toBe(three.sql);
  });

  it("/dashboard: kurulum + Dikkat + Bugün + özet turu işletme satırını ve ilk turu beklemez", async () => {
    const f = await seedRequestPathOrg({ properties: 3 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const r = await probeQueries(() => DashboardPage(), { delayMs: DELAY_MS });
    expect(r.ops, probeSummary(r)).toBeGreaterThanOrEqual(60);
    // Ölçülen 10 (Girişler'in olgu havuzu kritik yol); bir basamak pay (↑ `DELAY_MS`).
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(11);
  });

  it("Girişler (loadArrivalReadiness), otomatik giriş açık: bağlantı + silme kaydı bir kez; gönderim zinciri olgu havuzunu beklemez", async () => {
    const f = await seedRequestPathOrg({ properties: 3 });
    await prisma.organization.update({ where: { id: f.orgId }, data: { autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 25 * 86_400_000) } });
    for (const p of f.propertyIds) await prisma.autoMessageTemplate.create({ data: { organizationId: f.orgId, propertyId: p, kind: "checkin", body: "Hoş geldiniz." } });
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("PRIMARY_ORG_ID", f.orgId);
    vi.stubEnv("HOSPITABLE_API_TOKEN", "test-token");
    try {
      const r = await probeQueries(() => loadArrivalReadiness(f.orgId, new Date()), { delayMs: DELAY_MS });
      expect(r.result.rows, probeSummary(r)).toHaveLength(3);
      // Otomatik giriş ve elle gönderim düğmesi AYNI bağlantı okumasını paylaşır (eskiden iki kez).
      expect(r.byOp["ChannelConnection.findUnique"], probeSummary(r)).toBe(1);
      expect(r.byOp["ErasureTombstone.findMany"], probeSummary(r)).toBe(1);
      expect(r.byOp["MessageOutbox.findMany"], probeSummary(r)).toBe(1);
      // Ölçülen 10 (eskiden 18: gönderim zinciri olgu havuzunu bekliyordu); bir basamak pay (↑ `DELAY_MS`).
      expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(11);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("/tasks (temizlikçinin ana sayfası): görev okumaları saat dilimini, yardımcı okumalar birbirini beklemez (yönetici 6 → 4, personel 6 → 3)", async () => {
    const f = await seedRequestPathOrg({ properties: 3 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const manager = await probeQueries(() => TasksPage({ searchParams: sp({}) }), { delayMs: DELAY_MS });
    expect(manager.byOp["User.findMany"], probeSummary(manager)).toBe(1);
    expect(manager.depth, probeSummary(manager)).toBeLessThanOrEqual(4);
    const staff = await prisma.user.create({ data: { organizationId: f.orgId, email: "rp-staff@test.local", name: "Zeynep", passwordHash: "x" } });
    await prisma.task.update({ where: { id: `${f.propertyIds[0]}-t1` }, data: { assignedToId: staff.id } });
    vi.mocked(requireAuth).mockResolvedValue({ ...ownerSession(f), userId: staff.id, role: "staff" } as never);
    const own = await probeQueries(() => TasksPage({ searchParams: sp({}) }), { delayMs: DELAY_MS });
    expect(own.byOp["User.findMany"] ?? 0, probeSummary(own)).toBe(0);
    expect(own.depth, probeSummary(own)).toBeLessThanOrEqual(3);
  });
});
