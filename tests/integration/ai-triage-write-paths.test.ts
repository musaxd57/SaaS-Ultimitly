import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma, resetDb } from "../helpers/db";
import { parseMissingInfo } from "@/lib/ai/triage";

// ---------------------------------------------------------------------------
// m48 — ÜÇ ESCALATION YOLUNUN HER BİRİ AYRI AYRI PİNLENİR
//
// Tasarımın ilk iki turunda "model yolu + kelime yolu" ikilisi varsayılıyordu.
// Kod denetimi (08-09) ÜÇÜNCÜ bir yol buldu ve o yol MODEL DEĞİL:
//
//   1. `applyChannelAutoReply`    → "model"   · koşullu updateMany
//   2. `sendDueAlerts`            → "keyword" · koşullu updateMany
//   3. `applyInboundMessageRules` → "keyword" · KOŞULSUZ update + AYRI koşullu
//      triyaj yazması. Sınıflandırıcısı `classifyMessage` ve o fonksiyonun
//      gövdesi tek satır: `return classifyFallback(message)` — model HİÇ
//      koşmuyor, dolayısıyla kaynağı "model" yazmak arayüze yalan söyletirdi.
//
// Codex kısıtı: "üç yol için AYRI kırmızı-önce ve iki yönlü mutasyon testi."
// Her testin bir KONTROL iddiası var — onlar olmadan "hiç yazma" mutasyonu da
// yeşil geçerdi.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return { ...actual, suggestReply: vi.fn(), summarizeHostStyle: vi.fn() };
});
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { suggestReply } from "@/lib/ai";
import {
  applyChannelAutoReply,
  applyInboundMessageRules,
  sendDueAlerts,
} from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

/** Modelin yüksek riskli hükmü — escalation dalını tetikler ve ANALİZ taşır. */
const modelVerdict = {
  intent: "complaint",
  confidence: 0.91,
  reply: "Üzgünüz, ekibimiz ilgileniyor.",
  risk: "Kötü yorum tehdidi",
  priority: "urgent" as const,
  source: "openai" as const,
  actionSuggestion: "Ekibi bugün yönlendirin, misafirden fotoğraf isteyin.",
  riskLevel: "high" as const,
  detectedLanguage: "tr",
  riskType: "review_threat",
  usedSources: [],
  missingInfo: ["fotoğraf", "hangi oda"],
  statedCheckoutTime: null,
};

async function seedOrg() {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  return { orgId: org.id, propertyId: property.id };
}

async function seedThread(propertyId: string, body: string) {
  const when = new Date(Date.now() - 5 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: `res-${Math.random().toString(36).slice(2, 8)}`,
      status: "new",
      lastMessageAt: when,
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: when }] },
    },
    include: { messages: true },
  });
  return conversation;
}

describe("m48 YOL 1/3 — MODEL yolu (`applyChannelAutoReply`)", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(modelVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("escalate edilince ALTI alan da dolar; kaynak 'model'", async () => {
    const { propertyId } = await seedOrg();
    const conv = await seedThread(
      propertyId,
      "Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.",
    );

    const out = await applyChannelAutoReply(conv.id);
    expect(out.skippedReason).toBe("escalated_to_human"); // KONTROL: dal gerçekten koştu

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.aiTriageSource).toBe("model");
    expect(c.aiActionSuggestion).toBe(modelVerdict.actionSuggestion);
    expect(parseMissingInfo(c.aiMissingInfoJson)).toEqual(["fotoğraf", "hangi oda"]);
    expect(c.aiConfidence).toBe(0.91);
    // Tetikleyici mesaj: analizin AİT OLDUĞU mesaj — "son mesaj" diye yazma
    // anında yeniden okunmuyor (o, claim'in kapattığı yarışı geri açardı).
    expect(c.aiTriageTriggerMessageId).toBe(conv.messages[0].id);
    expect(c.aiTriagedAt).not.toBeNull();
  });

  it("🚨 ATOMİK YENİLEME: ikinci escalation ÖNCEKİ analizi bırakmaz", async () => {
    const { propertyId } = await seedOrg();
    const conv = await seedThread(propertyId, "Değerlendirmemi paylaşmadan önce görüşelim.");
    await applyChannelAutoReply(conv.id);
    const first = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(first.aiActionSuggestion).not.toBeNull(); // KONTROL

    // Konuşma yeniden "new"e döner ve model bu kez ANALİZSİZ bir hüküm verir.
    await prisma.conversation.update({ where: { id: conv.id }, data: { status: "new" } });
    mockSuggest.mockResolvedValue({ ...modelVerdict, actionSuggestion: null, missingInfo: [] });
    await applyChannelAutoReply(conv.id);

    const second = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    // ⬅️ `undefined` bırakılsaydı Prisma "dokunma" der ve ESKİ analiz yaşardı.
    expect(second.aiActionSuggestion).toBeNull();
    expect(second.aiMissingInfoJson).toBeNull();
    expect(second.aiTriageSource).toBe("model"); // kaynak yine yazıldı
  });
});

describe("m48 YOL 2/3 — KELİME yolu (`sendDueAlerts`)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kaynak 'keyword'; analiz alanları NULL (uydurma değer YAZILMAZ)", async () => {
    const { orgId, propertyId } = await seedOrg();
    const conv = await seedThread(propertyId, "Daire çok pisti, paramı geri istiyorum!");

    await sendDueAlerts(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.status).toBe("problem"); // KONTROL: kelime dalı gerçekten koştu
    expect(c.aiTriageSource).toBe("keyword");
    // 🚨 Model HİÇ koşmadı → analiz uydurulmaz.
    expect(c.aiActionSuggestion).toBeNull();
    expect(c.aiMissingInfoJson).toBeNull();
    expect(c.aiConfidence).toBeNull();
    // …ama damga ve tetikleyici YAZILIR: "modele sorulmadı" ile "model sorulup
    // sonuç alınamadı" ayrımı artık NULL'a değil kaynak kolonuna bağlı.
    expect(c.aiTriagedAt).not.toBeNull();
    expect(c.aiTriageTriggerMessageId).toBe(conv.messages[0].id);
  });
});

describe("m48 YOL 3/3 — KOŞULSUZ yol (`applyInboundMessageRules`)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kaynak 'keyword' — bu yol MODEL DEĞİL (`classifyMessage` → `classifyFallback`)", async () => {
    const { propertyId } = await seedOrg();
    const COMPLAINT = "Klima çalışmıyor ve daire çok pis, berbat durumda.";
    const conv = await seedThread(propertyId, COMPLAINT);

    const out = await applyInboundMessageRules(conv.id, COMPLAINT);
    expect(out.isComplaint).toBe(true); // KONTROL: escalate dalı koştu

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.status).toBe("problem");
    expect(c.aiTriageSource).toBe("keyword");
    expect(c.aiActionSuggestion).toBeNull();
    expect(c.aiTriagedAt).not.toBeNull();
    expect(c.aiTriageTriggerMessageId).toBe(conv.messages[0].id);
  });

  it("KONTROL: normal akışta triyaj YAZILIR (kapı 'hiç yazma'ya dönmedi)", async () => {
    const COMPLAINT = "Klima çalışmıyor ve daire çok pis, berbat durumda.";
    const { propertyId } = await seedOrg();
    const conv = await seedThread(propertyId, COMPLAINT);
    await applyInboundMessageRules(conv.id, COMPLAINT);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.aiTriageSource).toBe("keyword");
    expect(c.aiTriagedAt).not.toBeNull();
  });

  it("🚨 YARIŞ KORUMASI: triyaj yazması KENDİ tazelik çapasına koşullu", () => {
    // ⚠️ DÜRÜST SINIR: gerçek bir interleaving (fonksiyonun okuması ile yazması
    // ARASINA mesaj sokmak) deterministik olarak kurulamıyor — `findUnique` ile
    // `$transaction` arasında test'in tutunabileceği bir askı noktası yok ve
    // Prisma istemcisi proxy tabanlı olduğu için `vi.spyOn` onu bozuyor
    // (denendi: sonraki testte "findUnique is not a function"). O yüzden burada
    // YAPISAL pin var; koşulun SEMANTİĞİ aşağıdaki sorgu testiyle ölçülüyor.
    //
    // Pin, İKİ şeyi birden söylüyor:
    //  (a) triyaj yazması `lastMessageAt` çapasını taşıyor — yani üstteki
    //      claim'in `status` koşulu KÖRLEMESİNE kopyalanmadı (Codex kısıtı),
    //  (b) status yazması KOŞULSUZ kaldı — mevcut davranış değişmedi.
    const src = readFileSync("src/lib/automation.ts", "utf8");
    const at = src.indexOf("buildTriageData({\n          source: \"keyword\",\n          triggerMessageId: conversation.messages[0]");
    expect(at, "YOL 3 triyaj yazması bulunamadı — çapa kaymış olabilir").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 600), at);
    expect(block).toMatch(/lastMessageAt: conversation\.lastMessageAt/);
    // Ve status yazması hâlâ koşulsuz `update` (updateMany DEĞİL).
    expect(src).toMatch(/prisma\.conversation\.update\(\{\s*\n\s*where: \{ id: conversationId \},\s*\n\s*data: \{ status: "problem", priority: "urgent" \}/);
  });

  it("çapa eşleşmezse yazma 0 satır etkiler (koşulun semantiği)", async () => {
    const { propertyId } = await seedOrg();
    const conv = await seedThread(propertyId, "Merhaba");
    const stale = await prisma.conversation.updateMany({
      where: { id: conv.id, lastMessageAt: new Date(0) }, // bayat çapa
      data: { aiTriageSource: "keyword", aiTriagedAt: new Date() },
    });
    expect(stale.count).toBe(0);
    // KONTROL: DOĞRU çapayla aynı yazma 1 satır etkiler — yani sorgu şekli
    // "her zaman 0" değil.
    const fresh = await prisma.conversation.updateMany({
      where: { id: conv.id, lastMessageAt: conv.lastMessageAt },
      data: { aiTriageSource: "keyword", aiTriagedAt: new Date() },
    });
    expect(fresh.count).toBe(1);
  });
});
