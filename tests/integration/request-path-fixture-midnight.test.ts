import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedRequestPathOrg } from "../helpers/request-path-fixture";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";

// ---------------------------------------------------------------------------
// TEST ZAMAN BOMBASI — İSTEK YOLU FİKSTÜRÜ İSTANBUL GECE YARISINDA (G1 tur 3 T3-B4, 11-20; ürün DEĞİL).
// Fikstür işletmeyi Europe/Istanbul kurup konaklamaları UTC GÜNÜNE göre yazıyordu: İstanbul 00:00–02:59 (UTC 21:00–23:59) arasında "bugün
// giriş" ürünün (doğru) okumasında dünün girişiydi, `request-path-queries.test.ts`in iki testi o saatlerde kırmızıydı (gerçek gece yarısında
// koşuldu: 23:47 yeşil, 00:01 kırmızı). Fikstür artık işletme diliminin takvim gününe göre kurar (`stayDayInZone`). Burada aynı fikstür +
// aynı yükleyici iki sabit anda: İstanbul öğlen ve İstanbul 00:30 — ikisinde de "bugün giriş" üç satır.
// ---------------------------------------------------------------------------

const today = new Date();
const y = today.getUTCFullYear();
const m = today.getUTCMonth();
const d = today.getUTCDate();
/** İstanbul 12:00 (UTC 09:00) ve İstanbul ertesi gün 00:30 (aynı UTC gününün 21:30'u). */
const NOON_ISTANBUL = new Date(Date.UTC(y, m, d, 9, 0));
const AFTER_MIDNIGHT_ISTANBUL = new Date(Date.UTC(y, m, d, 21, 30));

async function rowsAt(now: Date): Promise<number> {
  const f = await seedRequestPathOrg({ properties: 3, now });
  await prisma.organization.update({ where: { id: f.orgId }, data: { autoCheckin: true, autoCheckinEnabledAt: new Date(now.getTime() - 25 * 86_400_000) } });
  for (const p of f.propertyIds) await prisma.autoMessageTemplate.create({ data: { organizationId: f.orgId, propertyId: p, kind: "checkin", body: "Hoş geldiniz." } });
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  vi.stubEnv("PRIMARY_ORG_ID", f.orgId);
  vi.stubEnv("HOSPITABLE_API_TOKEN", "test-token");
  return (await loadArrivalReadiness(f.orgId, now)).rows.length;
}

describe("istek yolu fikstürü — İstanbul gece yarısından sonra da 'bugün giriş' bugündür", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("İstanbul öğlen: üç 'bugün giriş' konaklaması listede", async () => {
    expect(await rowsAt(NOON_ISTANBUL)).toBe(3);
  });

  it("🚨 İstanbul 00:30 (UTC günü bir gün geride): aynı üç konaklama listede", async () => {
    expect(await rowsAt(AFTER_MIDNIGHT_ISTANBUL)).toBe(3);
  });
});
