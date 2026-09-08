import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  findKbGaps,
  GAP_WINDOW_DAYS,
  GAP_MIN_QUESTIONS,
  INTENT_TO_KB_CATEGORY,
  SETUP_CATEGORIES,
} from "@/modules/intelligence/recommendations/kb-gaps";

// ---------------------------------------------------------------------------
// A3 — EKSİK BİLGİ ANALİZİ, ÜÇ SINIF (09-08).
//
// Girdi zaten canlı akıyor: `Signal` (misafir NE sordu, PII'siz), `KnowledgeBaseItem`
// (o kategoride ONAYLI kalem var mı — A1), `RiskEvent` (getirildi mi/kullanıldı mı — A2).
// Sinyal ile karar kaydı AYNI mesaj kimliğinden bağlanır (`Signal.sourceEntityId`
// = `RiskEvent.triggerId`), yani "sorduğu şeye verilen cevap temellenmiş miydi"
// sorusu ÇIKARIMLA değil VERİYLE yanıtlanır.
//
// 🚨 ÜÇ SINIF AYRI: bilgi yokluğu (öneri üretilebilir) · temellendirme
// başarısızlığı (yeni kalem eklemek YANLIŞ cevaptır) · operasyonel talep
// (şikayet/para/insan — bilgi eksiği DEĞİL, iş).
// 🚨 HİÇBİRİ KESİN TESPİT DEĞİL: hepsi İNCELEME ADAYI (`decisive` yok).
// 🚨 BİLDİRİM YOK: liste okunur, mesaj başına uyarı üretilmez.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

describe("A3 — eksik bilgi analizi", () => {
  let orgId: string;
  let propertyId: string;

  async function askedAbout(category: string, times: number, daysAgo = 1) {
    for (let i = 0; i < times; i++) {
      await prisma.signal.create({
        data: {
          organizationId: orgId,
          propertyId,
          source: "guest_message",
          kind: "message.intent",
          category,
          severity: 0.2,
          confidence: 0.55,
          occurredAt: new Date(Date.now() - daysAgo * DAY),
          sourceEntityType: "message",
          sourceEntityId: `msg-${category}-${i}-${Math.random().toString(36).slice(2)}`,
          dedupeKey: `${orgId}:message.intent:${category}:${i}:${Math.random().toString(36).slice(2)}`,
        },
      });
    }
  }

  async function kbItem(category: string, over: Record<string, unknown> = {}) {
    return prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category,
        title: `${category} bilgisi`,
        content: "İçerik.",
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
        ...over,
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

  // --- sözleşme sabitleri -------------------------------------------------

  it("eşleme KAPALI küme: operasyonel ve belirsiz niyetler hedef kategoriye BAĞLANMAZ", () => {
    // Şikayet/para/insan talebi bir BİLGİ eksiği değildir; "şikayet" diye bir KB
    // kategorisi yok ve olsaydı bile host'a "şikayet bilgisi ekle" demek saçma olurdu.
    for (const operational of ["complaint", "refund", "human_request", "early_departure"]) {
      expect(INTENT_TO_KB_CATEGORY, operational).not.toHaveProperty(operational);
    }
    // `early_checkin`/`late_checkout` de dışarıda: cevabı KB'de değil, devir
    // planında (komşu rezervasyon) — yanlış yere bilgi yazdırırdık.
    expect(INTENT_TO_KB_CATEGORY).not.toHaveProperty("early_checkin");
    expect(INTENT_TO_KB_CATEGORY).not.toHaveProperty("late_checkout");
    // `amenity` bilinçli DIŞARIDA: net bir hedef kategorisi yok ("faq" demek
    // host'a bulanık tavsiye üretirdi). Sayılır, öneri üretmez.
    expect(INTENT_TO_KB_CATEGORY).not.toHaveProperty("amenity");
    expect(GAP_WINDOW_DAYS).toBe(90);
    expect(GAP_MIN_QUESTIONS).toBe(3);
  });

  // --- kurulum (soru olmasa da) -------------------------------------------

  it("KURULUM: hiç soru olmasa da temel kategorilerde eksik kalem listelenir", async () => {
    const gaps = await findKbGaps(orgId);
    const setup = gaps.filter((g) => g.kind === "setup");
    expect(setup.map((g) => g.category).sort()).toEqual([...SETUP_CATEGORIES].sort());
    // Kurulum eksikleri de İNCELEME ADAYI — "kesin tespit" değil.
    expect(setup.every((g) => g.reviewCandidate)).toBe(true);
    expect(setup.every((g) => g.questionCount === 0)).toBe(true);
  });

  it("kalem eklenince o kurulum satırı listeden DÜŞER", async () => {
    await kbItem("wifi");
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "wifi")).toBe(false);
  });

  it("TASLAK kalem kurulum eksiğini KAPATMAZ ama sınıfı değişir (onay bekliyor)", async () => {
    await kbItem("wifi", { source: "extracted_draft", reviewState: "draft" });
    const gaps = await findKbGaps(orgId);
    const wifi = gaps.find((g) => g.category === "wifi");
    expect(wifi?.label).toBe("awaiting_approval");
    // Host'a "bilgi ekle" DENMEZ: bilgi zaten yazılmış, onay bekliyor.
    expect(wifi?.reviewCandidate).toBe(false);
  });

  // --- gerçek sorulardan (asked) ------------------------------------------

  it("EŞİK ALTI soru öneri üretmez (tek gözlem kanıt değildir)", async () => {
    await kbItem("location"); // kurulum listesinde olmayan kategori
    await askedAbout("location", GAP_MIN_QUESTIONS - 1);
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "location")).toBe(false);
  });

  it("EŞİK ÜSTÜ soru + ONAYLI kalem YOK → 'absent', inceleme adayı", async () => {
    await askedAbout("location", GAP_MIN_QUESTIONS);
    const gaps = await findKbGaps(orgId);
    const g = gaps.find((x) => x.category === "location");
    expect(g?.kind).toBe("asked");
    expect(g?.label).toBe("absent");
    expect(g?.reviewCandidate).toBe(true);
    expect(g?.questionCount).toBe(GAP_MIN_QUESTIONS);
  });

  it("PENCERE DIŞI sorular sayılmaz", async () => {
    await askedAbout("location", 5, GAP_WINDOW_DAYS + 5);
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "location")).toBe(false);
  });

  it("OPERASYONEL talep (şikayet) ne kadar tekrarlarsa tekrarlasın öneri üretmez", async () => {
    await askedAbout("complaint", 10);
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "complaint")).toBe(false);
    // Ama GÖRÜNMEZ de olmaz: ayrı sayaçta durur (host "10 şikayet var" bilgisini
    // kaybetmesin; çözümü bilgi eklemek DEĞİL diye öneriye girmiyor).
    const ops = await findKbGaps(orgId, { includeCounters: true });
    expect(ops.find((g) => g.category === "complaint")).toBeUndefined();
  });

  it("EŞLENMEMİŞ niyet (amenity) öneri üretmez", async () => {
    await askedAbout("amenity", 8);
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "amenity")).toBe(false);
  });

  // --- temellendirme başarısızlığı (üçüncü sınıf) -------------------------

  it("ONAYLI kalem VAR ama cevaplar temellenmemiş → 'ungrounded', ÖNERİ DEĞİL teşhis", async () => {
    await kbItem("location");
    // Aynı mesaj kimliğiyle hem sinyal hem karar kaydı: soru ile cevabın bağı
    // ÇIKARIM değil VERİ.
    for (let i = 0; i < GAP_MIN_QUESTIONS; i++) {
      const messageId = `msg-loc-${i}`;
      await prisma.signal.create({
        data: {
          organizationId: orgId,
          propertyId,
          source: "guest_message",
          kind: "message.intent",
          category: "location",
          severity: 0.2,
          confidence: 0.55,
          occurredAt: new Date(Date.now() - DAY),
          sourceEntityType: "message",
          sourceEntityId: messageId,
          dedupeKey: `${orgId}:message.intent:${messageId}`,
        },
      });
      await prisma.riskEvent.create({
        data: {
          organizationId: orgId,
          propertyId,
          surface: "guest_chat",
          triggerId: messageId,
          finalDecision: "human_review",
          kbRetrieved: 4,
          srcDeclared: 0,
          srcVerified: 0,
        },
      });
    }
    const gaps = await findKbGaps(orgId);
    const g = gaps.find((x) => x.category === "location");
    expect(g?.label).toBe("ungrounded");
    // 🚨 Bu sınıfta host'a "bilgi ekle" demek YANLIŞ CEVAPTIR: bilgi vardı,
    // modele gitti, kullanılmadı. Yeni kalem eklemek sorunu çözmez.
    expect(g?.reviewCandidate).toBe(false);
  });

  it("kalem VAR ve cevaplar temellenmiş → hiç listelenmez", async () => {
    await kbItem("location");
    for (let i = 0; i < GAP_MIN_QUESTIONS; i++) {
      const messageId = `msg-ok-${i}`;
      await prisma.signal.create({
        data: {
          organizationId: orgId,
          propertyId,
          source: "guest_message",
          kind: "message.intent",
          category: "location",
          severity: 0.2,
          confidence: 0.55,
          occurredAt: new Date(Date.now() - DAY),
          sourceEntityType: "message",
          sourceEntityId: messageId,
          dedupeKey: `${orgId}:message.intent:${messageId}`,
        },
      });
      await prisma.riskEvent.create({
        data: {
          organizationId: orgId,
          propertyId,
          surface: "guest_chat",
          triggerId: messageId,
          finalDecision: "auto_sent",
          kbRetrieved: 4,
          srcDeclared: 1,
          srcVerified: 1,
        },
      });
    }
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "location")).toBe(false);
  });

  // --- tekilleştirme, sıralama, kiracı izolasyonu -------------------------

  it("mülk × kategori TEK satır (tekilleştirme)", async () => {
    await askedAbout("location", 6);
    const gaps = await findKbGaps(orgId);
    const keys = gaps.map((g) => `${g.propertyId}:${g.category}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("SORULAN eksikler kurulum eksiklerinin ÖNÜNDE, çok sorulan önce", async () => {
    await askedAbout("location", 9);
    await askedAbout("cleaning", 4);
    const gaps = await findKbGaps(orgId);
    const asked = gaps.filter((g) => g.kind === "asked").map((g) => g.category);
    expect(asked).toEqual(["location", "cleaning"]);
    expect(gaps.findIndex((g) => g.kind === "asked")).toBeLessThan(
      gaps.findIndex((g) => g.kind === "setup"),
    );
  });

  it("BAŞKA ORG'un sinyali/kalemi sızmaz", async () => {
    const other = await makeOrgWithProperty();
    await prisma.signal.create({
      data: {
        organizationId: other.orgId,
        propertyId: other.propertyId,
        source: "guest_message",
        kind: "message.intent",
        category: "location",
        severity: 0.2,
        confidence: 0.55,
        occurredAt: new Date(),
        sourceEntityType: "message",
        sourceEntityId: "other-msg",
        dedupeKey: `${other.orgId}:message.intent:other-msg`,
      },
    });
    const gaps = await findKbGaps(orgId);
    expect(gaps.every((g) => g.propertyId === propertyId)).toBe(true);
  });

  it("hiçbir satır KESİN TESPİT değildir", async () => {
    await askedAbout("location", 5);
    const gaps = await findKbGaps(orgId);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.decisive === false)).toBe(true);
  });
});
