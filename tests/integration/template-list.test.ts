import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// MESAJ ŞABLONU LİSTESİ — SUNUCU EN ÇOK 30 KAYIT GETİRİR (kurucu 11-19 akşam madde 1; bulgu T2-B8: liste ucu bütün şablonları tam gövdeyle
// döküyordu — 3.000 şablonda tek istek 284 MB yığın). Yönetim sayfası ve seçici AYNI sınırlı sorguyu kullanır (`lib/template-list.ts`);
// ilk yükte başlık / kategori / kısa önizleme, tam metin seçilince `GET /api/templates/[id]`. Arama işletmenin BÜTÜN şablonlarında.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as LIST } from "@/app/api/templates/route";
import { GET as DETAIL } from "@/app/api/templates/[id]/route";
import { listTemplatePage, TEMPLATE_PAGE_SIZE } from "@/lib/template-list";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

type Item = { id: string; title: string; preview: string; isDefault: boolean; propertyId: string | null; isActive: boolean; body?: string };
type Page = { items: Item[]; total: number; page: number; pageSize: number; hasMore: boolean };

const list = async (qs = "") => {
  const res = await LIST(new NextRequest(`http://localhost/api/templates${qs}`), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
};
const detail = (id: string) => DETAIL(new NextRequest(`http://localhost/api/templates/${id}`), { params: Promise.resolve({ id }) });

const T0 = new Date("2026-01-05T10:00:00.000Z");
/** `n` şablon; `createdAt` T0'dan dakika dakika ileri (i büyüdükçe daha yeni) — `sameInstant` ile hepsi AYNI an. */
async function seed(orgId: string, n: number, opts: { prefix?: string; body?: (i: number) => string; sameInstant?: boolean; propertyId?: string | null; isActive?: boolean } = {}) {
  const prefix = opts.prefix ?? "Şablon";
  for (let i = 0; i < n; i += 250) {
    await prisma.messageTemplate.createMany({
      data: Array.from({ length: Math.min(250, n - i) }, (_, k) => {
        const idx = i + k;
        return {
          organizationId: orgId,
          propertyId: opts.propertyId ?? null,
          category: "general",
          title: `${prefix} ${idx}`,
          body: opts.body ? opts.body(idx) : `Merhaba, bu ${idx}. metin.`,
          language: "tr",
          isActive: opts.isActive ?? true,
          createdAt: opts.sameInstant ? T0 : new Date(T0.getTime() + idx * 60_000),
        };
      }),
    });
  }
}

let orgId = "";
let propertyId = "";
beforeEach(async () => {
  await resetDb();
  ({ orgId, propertyId } = await makeOrgWithProperty());
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});

describe("GET /api/templates — sınırlı sayfa", () => {
  it("🚨 en çok 30 kalem; tam gövde YOK, kısa önizleme var; toplam ve devamı bildirilir", async () => {
    await seed(orgId, 45);
    const p1 = await list("?includeDefaults=false");
    expect(p1.items).toHaveLength(TEMPLATE_PAGE_SIZE);
    expect(TEMPLATE_PAGE_SIZE).toBe(30);
    expect(p1).toMatchObject({ total: 45, page: 1, pageSize: 30, hasMore: true });
    for (const it of p1.items) {
      expect(it).not.toHaveProperty("body");
      expect(it.preview).toMatch(/^Merhaba, bu \d+\. metin\.$/);
    }
    // En yeni önce (yönetim sayfasıyla aynı sıra).
    expect(p1.items[0]!.title).toBe("Şablon 44");
    const p2 = await list("?includeDefaults=false&page=2");
    expect(p2.items).toHaveLength(15);
    expect(p2).toMatchObject({ total: 45, page: 2, hasMore: false });
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(45);
  });

  it("🚨 yanıt boyu gövde boyundan bağımsız: 20.000 karakterlik 60 şablonda bile yanıt küçük (önizleme kesilir, '…')", async () => {
    await seed(orgId, 60, { body: (i) => `Uzun metin ${i} `.padEnd(20_000, "ş") });
    const res = await LIST(new NextRequest("http://localhost/api/templates?includeDefaults=false"), { params: Promise.resolve({}) });
    const text = await res.text();
    expect(text.length).toBeLessThan(30 * 600);
    const page = JSON.parse(text) as Page;
    expect(page.items).toHaveLength(30);
    expect(Array.from(page.items[0]!.preview)).toHaveLength(201); // 200 karakter + "…"
    expect(page.items[0]!.preview.endsWith("…")).toBe(true);
  });

  it("🚨 eşit oluşturma anında sayfalar AYRIK ve EKSİKSİZ (kimlik eşitlik bozucu)", async () => {
    await seed(orgId, 65, { sameInstant: true });
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) seen.push(...(await list(`?includeDefaults=false&page=${page}`)).items.map((i) => i.id));
    expect(seen).toHaveLength(65);
    expect(new Set(seen).size).toBe(65);
    const ids = (await prisma.messageTemplate.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((r) => r.id).sort().reverse();
    expect(seen).toEqual(ids);
  });

  it("🚨 arama işletmenin BÜTÜN şablonlarında: ilk 30'un dışındaki en eski şablon başlıktan ve gövdeden bulunur; büyük / küçük harf duyarsız", async () => {
    await seed(orgId, 40, { body: (i) => (i === 0 ? "Otopark girişi arka sokaktadır." : `Metin ${i}.`) });
    await prisma.messageTemplate.updateMany({ where: { organizationId: orgId, title: "Şablon 1" }, data: { title: "Havuz saatleri" } });
    expect((await list("?includeDefaults=false")).items.map((i) => i.title)).not.toContain("Şablon 0"); // ilk sayfada yok
    const byBody = await list(`?includeDefaults=false&q=${encodeURIComponent("OTOPARK")}`);
    expect(byBody.items.map((i) => i.title)).toEqual(["Şablon 0"]);
    expect(byBody).toMatchObject({ total: 1, hasMore: false });
    const byTitle = await list(`?includeDefaults=false&q=${encodeURIComponent("havuz")}`);
    expect(byTitle.items.map((i) => i.title)).toEqual(["Havuz saatleri"]);
  });

  it("arama metnindeki % _ \\ düz karakterdir (her şeyi eşleştirmez)", async () => {
    await seed(orgId, 3);
    await prisma.messageTemplate.create({ data: { organizationId: orgId, category: "general", title: "Erken giriş %50 indirim", body: "x" } });
    await prisma.messageTemplate.create({ data: { organizationId: orgId, category: "general", title: "alt_cizgi", body: "y" } });
    expect((await list(`?includeDefaults=false&q=${encodeURIComponent("%")}`)).items.map((i) => i.title)).toEqual(["Erken giriş %50 indirim"]);
    expect((await list(`?includeDefaults=false&q=${encodeURIComponent("_")}`)).items.map((i) => i.title)).toEqual(["alt_cizgi"]);
    expect((await list(`?includeDefaults=false&q=${encodeURIComponent("\\")}`)).items).toHaveLength(0);
  });

  it("🚨 kiracı yalıtımı: başka işletmenin şablonu listede ve aramada görünmez", async () => {
    const other = await makeOrgWithProperty();
    await seed(other.orgId, 5, { prefix: "Yabancı", body: () => "GIZLI-METIN" });
    await seed(orgId, 2);
    const page = await list("?includeDefaults=false");
    expect(page.total).toBe(2);
    expect((await list(`?includeDefaults=false&q=GIZLI`)).items).toHaveLength(0);
  });

  it("seçici kapsamı: yalnız ETKİN; daire verilince o dairenin + işletme geneli (başka dairenin şablonu yok)", async () => {
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
    await seed(orgId, 1, { prefix: "Genel" });
    await seed(orgId, 1, { prefix: "Bu daire", propertyId });
    await seed(orgId, 1, { prefix: "Öteki daire", propertyId: other.id });
    await seed(orgId, 1, { prefix: "Pasif", isActive: false });
    const scoped = await list(`?includeDefaults=false&propertyId=${propertyId}`);
    expect(scoped.items.map((i) => i.title).sort()).toEqual(["Bu daire 0", "Genel 0"]);
    // Daire verilmeyince (bugünkü uç gibi) daire süzgeci yok, pasif yine yok.
    const all = await list("?includeDefaults=false");
    expect(all.items.map((i) => i.title).sort()).toEqual(["Bu daire 0", "Genel 0", "Öteki daire 0"]);
  });

  it("hazır Lixus şablonları özel şablonların ARDINDAN aynı sayfalamaya girer (sayfa sınırını aşarak, tekrarsız); toplamda sayılır; yanıt en çok 30", async () => {
    await seed(orgId, 20);
    const n = DEFAULT_TEMPLATES.length;
    expect(n).toBeGreaterThan(10); // hazır şablonlar iki sayfaya bölünsün
    const pages: Page[] = [];
    for (let page = 1; page <= Math.ceil((20 + n) / 30); page++) pages.push(await list(page === 1 ? "" : `?page=${page}`));
    for (const p of pages) {
      expect(p.items.length).toBeLessThanOrEqual(30);
      expect(p.total).toBe(20 + n);
    }
    expect(pages[0]!.items).toHaveLength(30);
    expect(pages[0]!.hasMore).toBe(true);
    expect(pages.at(-1)!.hasMore).toBe(false);
    const all = pages.flatMap((p) => p.items);
    expect(all.slice(0, 20).every((i) => !i.isDefault)).toBe(true);
    expect(all.slice(20).map((i) => i.id)).toEqual(DEFAULT_TEMPLATES.map((t) => t.id));
    // Arama hazır şablonlarda da çalışır; includeDefaults=false onları çıkarır.
    const wifi = await list(`?q=${encodeURIComponent("wi-fi bilgi")}`);
    expect(wifi.items.some((i) => i.isDefault && i.id === "default-wifi-tr-1")).toBe(true);
    expect((await list("?includeDefaults=false")).total).toBe(20);
  });
});

describe("GET /api/templates/[id] — seçilince tam metin", () => {
  it("🚨 kendi şablonunun TAM gövdesi; başka işletmeninki 404 (gövde sızmaz)", async () => {
    const long = "Başlangıç ".padEnd(5_000, "x") + " SON";
    const mine = await prisma.messageTemplate.create({ data: { organizationId: orgId, category: "wifi", title: "Wi-Fi", body: long, isActive: false } });
    const res = await detail(mine.id);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ id: mine.id, body: long, isActive: false, isDefault: false, category: "wifi" });
    expect(d.updatedAt).toBe(mine.updatedAt.toISOString());

    const other = await makeOrgWithProperty();
    const foreign = await prisma.messageTemplate.create({ data: { organizationId: other.orgId, category: "general", title: "Yabancı", body: "GIZLI-METIN" } });
    const r404 = await detail(foreign.id);
    expect(r404.status).toBe(404);
    expect(await r404.text()).not.toContain("GIZLI");
  });

  it("hazır şablon kimliği koddaki sabiti döner", async () => {
    const t = DEFAULT_TEMPLATES[0]!;
    const res = await detail(t.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: t.id, body: t.body, isDefault: true, updatedAt: null });
    expect((await detail("default-yok")).status).toBe(404);
  });
});

describe("yönetim sayfası kapsamı (aynı sorgu)", () => {
  it("pasifler dahil, bütün daireler, daire adıyla; en çok 30; arama bütün şablonlarda", async () => {
    await seed(orgId, 31, { prefix: "Genel" });
    await seed(orgId, 1, { prefix: "Pasif", isActive: false });
    await seed(orgId, 1, { prefix: "Daire", propertyId });
    const p1 = await listTemplatePage(orgId, { scope: { kind: "manage" }, page: 1 });
    expect(p1.items).toHaveLength(30);
    expect(p1.total).toBe(33);
    expect(p1.items.every((i) => !i.isDefault)).toBe(true);
    const daire = await listTemplatePage(orgId, { scope: { kind: "manage" }, query: "daire 0" });
    expect(daire.items).toMatchObject([{ title: "Daire 0", propertyId, propertyName: "Test Property" }]);
    const pasif = await listTemplatePage(orgId, { scope: { kind: "manage" }, query: "pasif" });
    expect(pasif.items).toMatchObject([{ title: "Pasif 0", isActive: false }]);
  });

  it("🚨 sınırı AŞMIŞ işletme: hiçbir şablon gizlenmez — toplam bütün satırlar, son sayfa da okunur, tam metin okunur", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "10");
    try {
      await seed(orgId, 35);
      const p = await listTemplatePage(orgId, { scope: { kind: "manage" }, page: 2 });
      expect(p.total).toBe(35);
      expect(p.items).toHaveLength(5);
      expect((await detail(p.items[4]!.id)).status).toBe(200);
      expect((await list("?includeDefaults=false")).total).toBe(35);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
