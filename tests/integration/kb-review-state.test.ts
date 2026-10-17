import { describe, it, expect, beforeEach, vi } from "vitest";
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
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { bootstrapMemoryFromKnowledgeBase } from "@/modules/intelligence";

// ---------------------------------------------------------------------------
// A1 — KB ONAY SÖZLEŞMESİ (09-08).
//
// İki şeyi aynı anda kanıtlar:
//  1. DAVRANIŞ KORUNUR — sözleşme öncesi satırlar (`legacy`) modele GİTMEYE
//     DEVAM EDER. Bu bir konfor değil, canlı ürünün kendisi: filtreden düşseler
//     her mülkün bilgi tabanı bir migration ile boşalırdı.
//  2. TASLAK MODELE ASLA GİTMEZ — kurucunun "host onayından önce aktifleşmesin"
//     şartının kod karşılığı. Kapı `fetchKnowledgeBaseForPrompt` içinde, yani
//     dört AI yüzeyi de (oto-yanıt · inbox öneri · test kartı · QR) tek yerden
//     geçer ve çağıran filtreyi EZEMEZ.
//
// 🚨 ESKİ SATIRLARIN ONAYI VARSAYILMAZ: mevcut satırlar `host_manual`+`approved`
// DAMGALANMAZ (kurucu, 09-08). Onların gerçekte kim tarafından yazıldığı kayıt
// altında değil; "onaylandı" yazmak veriye sonradan sahte gerçek eklemek olurdu.
// ---------------------------------------------------------------------------

const createReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb/x", {
    method: "PATCH",
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

describe("KB onay sözleşmesi — legacy okunur, draft modele gitmez", () => {
  let orgId: string;
  let propertyId: string;

  async function seed(overrides: Record<string, unknown>) {
    return prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "general",
        title: "Otopark",
        content: "Bina altı otopark ücretsiz.",
        isActive: true,
        ...overrides,
      },
    });
  }

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
    } as SessionPayload;
  });

  it("sözleşme ÖNCESİ satır (legacy) modele GİTMEYE DEVAM EDER", async () => {
    await seed({ source: "legacy", reviewState: "legacy", approvedAt: null, title: "Eski kayıt" });
    const { items, dropped } = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(items.map((i) => i.title)).toEqual(["Eski kayıt"]);
    expect(dropped).toBe(0);
  });

  it("TASLAK kalem modele GİTMEZ ve 'yer sınırı yüzünden düştü' diye de SAYILMAZ", async () => {
    await seed({ source: "extracted_draft", reviewState: "draft", title: "Taslak çıkarım" });
    await seed({ source: "host_manual", reviewState: "approved", title: "Onaylı" });
    const { items, dropped } = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(items.map((i) => i.title)).toEqual(["Onaylı"]);
    // ⚠️ `dropped` modele "N kalem yer sınırı nedeniyle alınamadı, insana devret"
    // diye gidiyor. Taslak oraya sayılsaydı ürün, HİÇ VAR OLMAYAN bir bilgi için
    // konuşmayı insana devrederdi — taslak eksik bilgi değil, HENÜZ BİLGİ DEĞİL.
    expect(dropped).toBe(0);
  });

  it("çağıran filtreyi EZEMEZ: where'de reviewState:'draft' istense bile taslak gelmez", async () => {
    await seed({ source: "extracted_draft", reviewState: "draft", title: "Taslak" });
    const { items } = await fetchKnowledgeBaseForPrompt({
      propertyId,
      isActive: true,
      // Beşinci bir yüzey (ya da bir hata) bunu yazsa bile kapı kapalı kalmalı.
      reviewState: "draft",
    });
    expect(items).toEqual([]);
  });

  it("POST: host'un kendi yazdığı kalem host_manual + approved + approvedAt doğar", async () => {
    const res = await CREATE(
      createReq({ propertyId, category: "wifi", title: "Wi-Fi", content: "Şifre kapı arkasında." }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(201);
    const row = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId } });
    expect(row.source).toBe("host_manual");
    expect(row.reviewState).toBe("approved");
    expect(row.approvedAt).toBeInstanceOf(Date);
  });

  it("PATCH onay İDDİASI üretmez: legacy satır düzenlenince de legacy kalır", async () => {
    const item = await seed({ source: "legacy", reviewState: "legacy", approvedAt: null });
    const res = await PATCH(patchReq({ content: "Otopark artık ücretli." }), ctxFor(item.id));
    expect(res.status).toBe(200);
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.content).toBe("Otopark artık ücretli.");
    // Bir düzenlemeden "host bunu onayladı" sonucunu çıkarmak, kurucunun
    // yasakladığı varsayımın ta kendisi. Onay YALNIZ açık onay yolundan gelir.
    expect(row.source).toBe("legacy");
    expect(row.reviewState).toBe("legacy");
    expect(row.approvedAt).toBeNull();
  });

  it("PATCH bir TASLAĞI onaylıya çeviremez (istemci kendini onaylayamaz)", async () => {
    const item = await seed({ source: "extracted_draft", reviewState: "draft" });
    const res = await PATCH(patchReq({ reviewState: "approved", isActive: true }), ctxFor(item.id));
    expect(res.status).toBe(200);
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.reviewState).toBe("draft");
    const { items } = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(items).toEqual([]);
  });

  it("COPY onay soyunu DEVRALIR: legacy kaynaktan legacy kopya (sahte onay yok)", async () => {
    const item = await seed({ source: "legacy", reviewState: "legacy", approvedAt: null });
    const target = await prisma.property.create({
      data: { organizationId: orgId, name: "Daire 2", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    const res = await COPY(copyReq({ targetPropertyIds: [target.id] }), ctxFor(item.id));
    expect(res.status).toBe(200);
    const copied = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: target.id } });
    expect(copied.source).toBe("legacy");
    expect(copied.reviewState).toBe("legacy");
    expect(copied.approvedAt).toBeNull();
  });

  it("COPY bir taslağı kopyalayarak onaylıya ÇEVİREMEZ", async () => {
    const item = await seed({ source: "extracted_draft", reviewState: "draft" });
    const target = await prisma.property.create({
      data: { organizationId: orgId, name: "Daire 3", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    await COPY(copyReq({ targetPropertyIds: [target.id] }), ctxFor(item.id));
    const copied = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: target.id } });
    expect(copied.reviewState).toBe("draft");
    const { items } = await fetchKnowledgeBaseForPrompt({ propertyId: target.id, isActive: true });
    expect(items).toEqual([]);
  });

  it("TASLAK mülk hafızasına da GİRMEZ (hafıza 'mülk gerçeği' demektir)", async () => {
    await seed({ source: "extracted_draft", reviewState: "draft", title: "Taslak" });
    await seed({ source: "legacy", reviewState: "legacy", title: "Eski gerçek" });
    await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    const memories = await prisma.propertyMemory.findMany({
      where: { organizationId: orgId, source: "kb_item" },
      select: { title: true, status: true },
    });
    expect(memories.map((m) => m.title)).toEqual(["Eski gerçek"]);
  });

  it("onaylıyken hafızaya giren kalem TASLAĞA çekilirse hafıza retired olur", async () => {
    const item = await seed({ source: "host_manual", reviewState: "approved", title: "Onaylı" });
    await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    expect(await prisma.propertyMemory.count({ where: { status: "active" } })).toBe(1);
    await prisma.knowledgeBaseItem.update({
      where: { id: item.id },
      data: { reviewState: "draft" },
    });
    await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    const mem = await prisma.propertyMemory.findFirstOrThrow({ where: { sourceRef: item.id } });
    expect(mem.status).toBe("retired");
  });
});
