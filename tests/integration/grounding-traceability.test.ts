import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { recordRiskEvent } from "@/lib/risk-events";
import { classifyGrounding } from "@/lib/ai/grounding";

// ---------------------------------------------------------------------------
// A2 — GETİRİLEN ↔ KULLANILAN KAYNAK İZLENEBİLİRLİĞİ (09-08).
//
// 🚨 Sözleşmenin çekirdeği: `usedSources` MODELİN BEYANIDIR ve tek başına
// "bilgi yok" ile "bilgi vardı ama kullanılmadı"yı AYIRMAZ — ikisi de aynı boş
// listeyi üretir. Ayrımı ancak KODUN bildiği "ne getirildi" ile modelin beyan
// ettiği "ne kullandım" yan yana durursa yapabiliriz.
//
// İkinci sözleşme: sayılar HÜKÜM DEĞİL. `classifyGrounding` bir ETİKET ve bir
// `decisive` bayrağı döndürür; tek bir sayıya bakıp "bilgi yokluğu" demek
// yasaktır (kurucu, 09-08). Ölçülmemiş alan NULL'dır, 0 değil.
// ---------------------------------------------------------------------------

describe("A2 — getirilen ↔ kullanılan kaynak izlenebilirliği", () => {
  let orgId: string;
  let propertyId: string;

  async function seedKb(overrides: Record<string, unknown>) {
    return prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "wifi",
        title: "Wi-Fi",
        content: "Şifre kapı arkasında.",
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
        ...overrides,
      },
    });
  }

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- kb-fetch: kodun BİLDİĞİ taraf -------------------------------------

  it("hiç kalem yoksa: retrieved 0, onay bekleyen 0, tazelik işareti NULL", async () => {
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(r.items).toEqual([]);
    expect(r.dropped).toBe(0);
    expect(r.pendingApproval).toBe(0);
    expect(r.newestUpdatedAt).toBeNull();
  });

  it("ONAY BEKLEYEN kalem ayrı sayılır — 'bilgi yok' ile karıştırılmaz", async () => {
    await seedKb({ source: "extracted_draft", reviewState: "draft" });
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    // Modele gitmez (A1) AMA yok sayılmaz: host'a "bilgi ekle" demek YANLIŞ
    // olurdu — bilgi VAR, onay bekliyor.
    expect(r.items).toEqual([]);
    expect(r.pendingApproval).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("tazelik işareti = isteme giren kalemlerin en yeni updatedAt'i (SÜRÜM KİMLİĞİ DEĞİL)", async () => {
    const old = await seedKb({ title: "Eski" });
    const fresh = await seedKb({ title: "Yeni", category: "parking" });
    await prisma.knowledgeBaseItem.update({
      where: { id: old.id },
      data: { updatedAt: new Date("2020-01-01T00:00:00Z") },
    });
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(r.newestUpdatedAt?.getTime()).toBe(row.updatedAt.getTime());
  });

  it("onay bekleyen kalem tazelik işaretini ileri TAŞIMAZ (istemde yoktu)", async () => {
    const approved = await seedKb({ title: "Onaylı" });
    await prisma.knowledgeBaseItem.update({
      where: { id: approved.id },
      data: { updatedAt: new Date("2020-01-01T00:00:00Z") },
    });
    await seedKb({ title: "Taslak", category: "parking", source: "extracted_draft", reviewState: "draft" });
    const r = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    expect(r.newestUpdatedAt?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  // --- RiskEvent: iki tarafın YAN YANA kaydı ------------------------------

  it("RiskEvent iki tarafı da saklar; ölçülmeyen alan NULL kalır (0 DEĞİL)", async () => {
    await recordRiskEvent({
      organizationId: orgId,
      surface: "guest_chat",
      triggerId: "m1",
      finalDecision: "human_review",
      reason: "low_confidence",
      kbRetrieved: 3,
      kbDropped: 1,
      kbPendingApproval: 2,
      srcDeclared: 2,
      srcVerified: 1,
    });
    const row = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "m1" } });
    expect(row.kbRetrieved).toBe(3);
    expect(row.kbDropped).toBe(1);
    expect(row.kbPendingApproval).toBe(2);
    expect(row.srcDeclared).toBe(2);
    expect(row.srcVerified).toBe(1);
    // Hiç geçilmeyen alan NULL — "ölçmedik" ile "sıfırdı" AYNI ŞEY DEĞİL.
    expect(row.kbNewestUpdatedAt).toBeNull();
  });

  it("hiçbir sayaç verilmezse HEPSİ NULL (eski çağıranlar sıfır uydurmaz)", async () => {
    await recordRiskEvent({
      organizationId: orgId,
      surface: "auto_reply",
      triggerId: "m2",
      finalDecision: "auto_sent",
      reason: "gate_passed",
    });
    const row = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "m2" } });
    expect(row.kbRetrieved).toBeNull();
    expect(row.srcDeclared).toBeNull();
    expect(row.srcVerified).toBeNull();
  });

  it("anlamsız sayaç (negatif / kesirli / NaN) NULL yazılır, kırpılmaz", async () => {
    await recordRiskEvent({
      organizationId: orgId,
      surface: "guest_chat",
      triggerId: "m3",
      finalDecision: "human_review",
      kbRetrieved: -1,
      kbDropped: 1.5,
      srcDeclared: Number.NaN,
      srcVerified: 2,
    });
    const row = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "m3" } });
    // Kırpma (örn. -1 → 0) sahte bir "ölçüm" üretirdi; hatanın kendisi kaybolurdu.
    expect(row.kbRetrieved).toBeNull();
    expect(row.kbDropped).toBeNull();
    expect(row.srcDeclared).toBeNull();
    expect(row.srcVerified).toBe(2);
  });

  it("BEYAN doğrulanandan az OLAMAZ — tutarsız çift ikisi de NULL yazılır", async () => {
    // `srcVerified` her zaman `srcDeclared`ın alt kümesidir (doğrulama eleme
    // yapar). Tersi bir çift, çağıranda bir hata demektir; yazılırsa "uydurma
    // atıf" istatistiği NEGATİF çıkar ve sessizce yanlış okunur.
    await recordRiskEvent({
      organizationId: orgId,
      surface: "guest_chat",
      triggerId: "m4",
      finalDecision: "human_review",
      srcDeclared: 1,
      srcVerified: 3,
    });
    const row = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "m4" } });
    expect(row.srcDeclared).toBeNull();
    expect(row.srcVerified).toBeNull();
  });

  // --- Sınıflandırma: HÜKÜM DEĞİL ----------------------------------------

  it("ölçüm yoksa sınıf 'unknown' ve KESİN DEĞİL", () => {
    const c = classifyGrounding({});
    expect(c.label).toBe("unknown");
    expect(c.decisive).toBe(false);
  });

  it("retrieved=0 + onay bekleyen VAR → 'awaiting_approval' (bilgi yokluğu DEĞİL)", () => {
    const c = classifyGrounding({ kbRetrieved: 0, kbPendingApproval: 2 });
    expect(c.label).toBe("awaiting_approval");
    // Host'a "bu bilgiyi ekle" denmemeli: bilgi zaten var, onay bekliyor.
    expect(c.reviewCandidate).toBe(false);
  });

  it("retrieved=0, onay bekleyen yok, tavan düşürmedi → 'absent' ve öneri üretilebilir", () => {
    const c = classifyGrounding({ kbRetrieved: 0, kbPendingApproval: 0, kbDropped: 0 });
    expect(c.label).toBe("absent");
    expect(c.reviewCandidate).toBe(true);
    // 🚨 Yine de KESİN değil: bu mülkte kalem yok demek, misafirin sorduğu ŞEYİN
    // eksik olduğunu kanıtlamaz (kategori eşlemesi ayrı iştir — A3).
    expect(c.decisive).toBe(false);
  });

  it("retrieved>0 ama doğrulanan 0 → 'ungrounded'; YENİ KALEM ÖNERİLMEZ", () => {
    const c = classifyGrounding({ kbRetrieved: 4, srcDeclared: 0, srcVerified: 0 });
    expect(c.label).toBe("ungrounded");
    // Bilgi vardı ve modele gitti; eksik olan bilgi değil, temellendirme.
    expect(c.reviewCandidate).toBe(false);
  });

  it("beyan VAR ama doğrulanmadı → 'fabricated_citation' (en ağır sınıf)", () => {
    const c = classifyGrounding({ kbRetrieved: 4, srcDeclared: 3, srcVerified: 0 });
    expect(c.label).toBe("fabricated_citation");
    expect(c.reviewCandidate).toBe(false);
  });

  it("tavan düşürdüyse ayrı kova — 'capacity', bilgi yokluğu diye sayılmaz", () => {
    const c = classifyGrounding({ kbRetrieved: 30, kbDropped: 12, srcDeclared: 0, srcVerified: 0 });
    expect(c.label).toBe("capacity");
    expect(c.reviewCandidate).toBe(false);
  });

  it("temellendirilmiş cevap → 'grounded'", () => {
    const c = classifyGrounding({ kbRetrieved: 4, kbDropped: 0, srcDeclared: 2, srcVerified: 2 });
    expect(c.label).toBe("grounded");
    expect(c.reviewCandidate).toBe(false);
  });
});
