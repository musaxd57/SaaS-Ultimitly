import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as CREATE } from "@/app/api/kb/route";
import { PATCH } from "@/app/api/kb/[id]/route";
import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { planLimitsFor } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// PLAN SINIRLARI HER YAZMA YOLUNDA GEÇERLİ (denetim, 07-31).
//
// Sınırlar (15/30/60 kayıt + 3.000 karakter) yalnız POST'ta uygulanıyordu.
// İki kaçış açıktı ve ikisi de tek istekle sömürülebiliyordu:
//   1. PATCH — adet sınırı YALNIZ aktif kayıtları sayar: 15 ekle → hepsini
//      pasife al → 15 daha ekle → eskileri geri aktifleştir = sınırsız.
//   2. PATCH — karakter tavanı hiç yoktu, zod 20.000'e izin veriyordu; yani
//      "her şeyi tek kayda doldur" kaçışı (tavanın VARLIK SEBEBİ) geri açıktı.
//   3. COPY — hedef daireye sayım yapmadan satır yaratıyordu.
//
// Bu dosya üçünü de kırmızı-önce pinler. Ayrıca EN ÖNEMLİSİ: tavan bugün
// yürürlüğe girdiği için eski uzun kayıtların DÜZENLENEBİLİR kalması gerekir —
// aksi hâlde kendi kaydını kaydedemeyen müşteri yaratırdık.
// ---------------------------------------------------------------------------

const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const createReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const copyReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb/x/copy", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

/** Deneme aboneliği yokken org "grandfathered" sayılır → en geniş plan. */
const LIMITS = planLimitsFor("business");

describe("bilgi tabanı plan sınırları — tüm yazma yolları", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = {
      userId: "u",
      organizationId: orgId,
      role: "owner",
      email: "o@x.com",
      name: "O",
      sessionEpoch: 0,
    };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedItems(count: number, isActive = true) {
    for (let i = 0; i < count; i++) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId,
          category: "general",
          title: `k${i}`,
          content: "içerik",
          language: "tr",
          isActive,
        },
      });
    }
  }

  // ── 1. PATCH: pasif → aktif, adet sınırını delemez ────────────────────────
  it("PASİF bir kaydı aktifleştirmek sınıra takılır (aktifle-pasifle döngüsü kapandı)", async () => {
    await seedItems(LIMITS.kbItemsPerProperty, true);
    const passive = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "pasif",
        content: "içerik",
        language: "tr",
        isActive: false,
      },
    });

    const res = await PATCH(patchReq({ isActive: true }), ctxFor(passive.id));
    expect(res.status).toBe(400);

    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: passive.id } });
    expect(after.isActive).toBe(false); // gerçekten yazılmadı

    const activeCount = await prisma.knowledgeBaseItem.count({
      where: { propertyId, isActive: true },
    });
    expect(activeCount).toBe(LIMITS.kbItemsPerProperty);
  });

  it("sınır dolu DEĞİLKEN aktifleştirme normal çalışır (aşırı kısıtlama yok)", async () => {
    await seedItems(2, true);
    const passive = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "pasif",
        content: "içerik",
        language: "tr",
        isActive: false,
      },
    });
    const res = await PATCH(patchReq({ isActive: true }), ctxFor(passive.id));
    expect(res.status).toBe(200);
    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: passive.id } });
    expect(after.isActive).toBe(true);
  });

  it("ZATEN aktif bir kaydı düzenlemek sayımı tetiklemez (sınır doluyken bile)", async () => {
    await seedItems(LIMITS.kbItemsPerProperty - 1, true);
    const item = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "aktif",
        content: "içerik",
        language: "tr",
        isActive: true,
      },
    });
    // Aktif sayısı tam sınırda; başlık düzenlemesi reddedilmemeli.
    const res = await PATCH(patchReq({ title: "yeni başlık" }), ctxFor(item.id));
    expect(res.status).toBe(200);
  });

  // ── 2. PATCH: karakter tavanı ─────────────────────────────────────────────
  it("PATCH ile karakter tavanı AŞILAMAZ (zod'un 20.000'i artık kapı değil)", async () => {
    const item = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "k",
        content: "kısa",
        language: "tr",
        isActive: true,
      },
    });
    const res = await PATCH(
      patchReq({ content: "A".repeat(LIMITS.kbCharsPerItem + 1) }),
      ctxFor(item.id),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("karakter");

    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.content).toBe("kısa"); // yazılmadı
  });

  it("ESKİ uzun kayıt düzenlenebilir kalır: KISALTMA her zaman kabul edilir", async () => {
    // Tavan bugün yürürlüğe girdi; bundan önce yazılmış uzun kayıtlar var olabilir.
    const legacy = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "eski",
        content: "A".repeat(LIMITS.kbCharsPerItem + 5_000),
        language: "tr",
        isActive: true,
      },
    });

    // Hâlâ tavanın üstünde ama ÖNCEKİNDEN kısa → kabul (müşteri kilitlenmez).
    const shorter = "B".repeat(LIMITS.kbCharsPerItem + 100);
    const res = await PATCH(patchReq({ content: shorter }), ctxFor(legacy.id));
    expect(res.status).toBe(200);
    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.content).toBe(shorter);
  });

  it("ESKİ uzun kaydı DAHA DA uzatmak reddedilir", async () => {
    const legacy = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "eski",
        content: "A".repeat(LIMITS.kbCharsPerItem + 100),
        language: "tr",
        isActive: true,
      },
    });
    const res = await PATCH(
      patchReq({ content: "A".repeat(LIMITS.kbCharsPerItem + 200) }),
      ctxFor(legacy.id),
    );
    expect(res.status).toBe(400);
  });

  // ── 3. COPY: hedef daire sınırı ───────────────────────────────────────────
  it("KOPYALAMA, sınırı dolu daireyi ATLAR ve bunu çağırana SÖYLER", async () => {
    const target = await prisma.property.create({
      data: { organizationId: orgId, name: "hedef" },
    });
    // Hedef dairenin sınırı dolu.
    for (let i = 0; i < LIMITS.kbItemsPerProperty; i++) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: target.id,
          category: "general",
          title: `t${i}`,
          content: "x",
          language: "tr",
          isActive: true,
        },
      });
    }
    const source = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "wifi",
        title: "wifi",
        content: "şifre",
        language: "tr",
        isActive: true,
      },
    });

    const res = await COPY(copyReq({ targetPropertyIds: [target.id] }), ctxFor(source.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.skippedAtLimit).toBe(1);
    // Sessiz "başarılı" DEĞİL — host olmayan bir kaydı var sanmamalı.
    expect(body.notice).toContain("sınır");

    const count = await prisma.knowledgeBaseItem.count({ where: { propertyId: target.id } });
    expect(count).toBe(LIMITS.kbItemsPerProperty);
  });

  it("KOPYALAMA kısmi başarır: dolu daire atlanır, boş daireye kopyalanır", async () => {
    const full = await prisma.property.create({ data: { organizationId: orgId, name: "dolu" } });
    const empty = await prisma.property.create({ data: { organizationId: orgId, name: "boş" } });
    for (let i = 0; i < LIMITS.kbItemsPerProperty; i++) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: full.id,
          category: "general",
          title: `t${i}`,
          content: "x",
          language: "tr",
          isActive: true,
        },
      });
    }
    const source = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "wifi",
        title: "wifi",
        content: "şifre",
        language: "tr",
        isActive: true,
      },
    });

    const res = await COPY(copyReq({ targetPropertyIds: [full.id, empty.id] }), ctxFor(source.id));
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skippedAtLimit).toBe(1);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: empty.id } })).toBe(1);
  });

  it("PASİF kaydın kopyalanması sınırdan bağımsızdır (aktif sayımı değiştirmez)", async () => {
    const target = await prisma.property.create({
      data: { organizationId: orgId, name: "hedef" },
    });
    for (let i = 0; i < LIMITS.kbItemsPerProperty; i++) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: target.id,
          category: "general",
          title: `t${i}`,
          content: "x",
          language: "tr",
          isActive: true,
        },
      });
    }
    const source = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "wifi",
        title: "wifi",
        content: "şifre",
        language: "tr",
        isActive: false,
      },
    });
    const res = await COPY(copyReq({ targetPropertyIds: [target.id] }), ctxFor(source.id));
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skippedAtLimit).toBe(0);
  });

  // ── 4. POST hâlâ çalışıyor (regresyon pini) ───────────────────────────────
  it("POST kapıları bozulmadı: adet ve karakter hâlâ reddediyor", async () => {
    await seedItems(LIMITS.kbItemsPerProperty, true);
    const overCount = await CREATE(
      createReq({ propertyId, category: "general", title: "yeni", content: "x", isActive: true }),
      { params: Promise.resolve({}) },
    );
    expect(overCount.status).toBe(400);

    await prisma.knowledgeBaseItem.deleteMany({ where: { propertyId } });
    const overChars = await CREATE(
      createReq({
        propertyId,
        category: "general",
        title: "yeni",
        content: "A".repeat(LIMITS.kbCharsPerItem + 1),
        isActive: true,
      }),
      { params: Promise.resolve({}) },
    );
    expect(overChars.status).toBe(400);
  });
});
