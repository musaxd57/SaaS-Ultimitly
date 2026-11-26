import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, resetDb } from "../helpers/db";
import {
  LEAD_PAGE_SIZE,
  decodeLeadCursor,
  encodeLeadCursor,
  leadPageHref,
  leadPageQuery,
  parseLeadPageParams,
  splitLeadPage,
  type LeadStatus,
} from "@/lib/admin/lead-page";

// K27-K16a: operatör paneli demo talepleri — eskiden yalnız en yeni 50 (süzgeç / sayfa yok). Pinlenen: "daha eski" imleciyle HER talep
// tam BİR kez görünür (eşit damgalı satırlar sayfa sınırında kaybolmaz / yinelenmez), durum süzgeci sorguda, bozuk parametre ilk sayfa.

async function seed(n: number, status: (i: number) => LeadStatus, sameStampEvery = 0) {
  const base = Date.now() - 10 * 24 * 3600_000;
  const data = Array.from({ length: n }, (_, i) => ({
    name: `Talep ${i}`,
    email: `t${i}@example.test`,
    status: status(i),
    // Bir kısmı AYNI damgayı paylaşır → sıralama id ile kesinleşmeli.
    createdAt: new Date(base + (sameStampEvery > 0 ? Math.floor(i / sameStampEvery) : i) * 60_000),
  }));
  await prisma.lead.createMany({ data });
}

async function walk(status: LeadStatus | null) {
  const seen: string[] = [];
  let before: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const params = parseLeadPageParams({ ...(status ? { talepDurum: status } : {}), ...(before ? { talepOnce: before } : {}) });
    const page = splitLeadPage(await prisma.lead.findMany(leadPageQuery(params)));
    expect(page.rows.length).toBeLessThanOrEqual(LEAD_PAGE_SIZE);
    seen.push(...page.rows.map((r) => r.id));
    if (!page.nextCursor) return seen;
    before = page.nextCursor;
  }
  throw new Error("sayfa döngüsü bitmedi");
}

describe("operatör paneli — demo talepleri sayfası", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("130 talep (eşit damgalar dahil): imleçle hepsi tam bir kez, en yeniden eskiye", async () => {
    await seed(130, () => "new", 7);
    const seen = await walk(null);
    expect(seen).toHaveLength(130);
    expect(new Set(seen).size).toBe(130);
    const all = await prisma.lead.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    expect(seen).toEqual(all.map((r) => r.id));
  });

  it("durum süzgeci sorguda: 51. ve daha eski 'Yeni' talepler de bulunur; başka durum karışmaz", async () => {
    await seed(160, (i) => (i % 3 === 0 ? "new" : "won"));
    const seen = await walk("new");
    const expected = await prisma.lead.count({ where: { status: "new" } });
    expect(expected).toBeGreaterThan(LEAD_PAGE_SIZE);
    expect(seen).toHaveLength(expected);
    const rows = await prisma.lead.findMany({ where: { id: { in: seen } }, select: { status: true } });
    expect(rows.every((r) => r.status === "new")).toBe(true);
  });

  it("tam 50 talep: sonraki sayfa bağlantısı yok", async () => {
    await seed(LEAD_PAGE_SIZE, () => "new");
    const page = splitLeadPage(await prisma.lead.findMany(leadPageQuery(parseLeadPageParams({}))));
    expect(page.rows).toHaveLength(LEAD_PAGE_SIZE);
    expect(page.nextCursor).toBeNull();
  });

  it("bozuk / bilinmeyen parametre ilk sayfa + tüm durumlar", () => {
    expect(parseLeadPageParams({ talepDurum: "hacked", talepOnce: "x';--" })).toEqual({ status: null, before: null });
    expect(parseLeadPageParams({ talepDurum: ["won", "new"] }).status).toBe("won");
    expect(decodeLeadCursor("9".repeat(16) + "_abc")).toBeNull();
    const c = { createdAt: new Date(1_700_000_000_000), id: "clxyz123" };
    expect(decodeLeadCursor(encodeLeadCursor(c))).toEqual(c);
    expect(leadPageHref("demo", "1_a")).toBe("/admin?talepDurum=demo&talepOnce=1_a#talepler");
    expect(leadPageHref(null, null)).toBe("/admin#talepler");
  });

  it("panel bu sorguyu kullanıyor (eski 'take: 50' geri gelmedi)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/admin/page.tsx"), "utf8");
    expect(src).toContain("prisma.lead.findMany(leadPageQuery(leadParams))");
    expect(src).toContain("splitLeadPage(leadRows)");
    expect(src).not.toMatch(/prisma\.lead\.findMany\(\{[^}]*take:\s*50/);
  });
});
