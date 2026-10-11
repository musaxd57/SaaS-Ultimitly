import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// KRİTİK AKIŞ — Inbound → sınıflandırma/AI → outbox → teslim → karar kaydı, TEK testte (kurucu talimatı 09-07, "Merkezi kritik akış
// matrisi"; `docs/TEST-EVIDENCE-CONTRACT.md` §3'teki ⚠️ "parça parça korunuyor, tek uçtan uca test yok" boşluğu — Haiku kapsam
// denetimi 10-11).
//
// Gerçek olan: sağlayıcı senkronu (`syncHospitable` → ingest yazma servisi → IngestEvent), model cevabı ayrıştırıcısı (`@/lib/ai`
// MOCK'LANMAZ), güvenlik kapısı, kalıcı gönderim kuyruğu (`enqueueOutbound`), kuyruk işçisi (`drainOutboxOnce`), karar kaydı
// (`RiskEvent`), PostgreSQL. Sahte olan YALNIZ dış sınırlar: sağlayıcı (fake ingest adaptörü + işçinin `send` fonksiyonu), OpenAI
// HTTP'si (fetch), alarm e-postası.
//
// İki yön birlikte: güvenli soru uçtan uca TESLİM EDİLİR; aynı zincirde iade talebi HİÇBİR ŞEY göndermez (kuyruk satırı yok, sağlayıcı
// çağrılmaz, konuşma insana, ev sahibine e-posta). Biri tek başına yeşil kalamaz (boru hattı erken vetolanıp hiçbir şey iddia etmeden
// geçemesin diye kontrol aynı tohumla).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => ({ ok: true })), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));

import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { applyChannelAutoReply } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { emailService } from "@/lib/email";

const TOKEN = "tok-critical-flow";
const HP = "hp-critical-flow";
const fake = new FakeIngestProvider();
const mockEmail = vi.mocked(emailService.sendReporting);

/** OpenAI HTTP'si: her çağrıya aynı yapılandırılmış cevap (ayrıştırıcı ve kapı GERÇEK). */
function openAiReturns(content: Record<string, unknown>) {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const SAFE = {
  intent: "parking",
  confidence: 0.95,
  reply: "Yes, there is free parking under the building.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["kb:general"],
  missingInfo: [],
  statedCheckoutTime: null,
};

/** Sağlayıcıdan gelen tek misafir mesajı → GERÇEK senkronla veritabanına iner. */
async function ingestGuestMessage(guestText: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: `owner-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "general", title: "Otopark", content: "Bina altında ücretsiz otopark var.", isActive: true },
  });
  await setOrgHospitableToken(orgId, TOKEN, "A");
  fake.addProperty(TOKEN, HP, "Test Property");
  fake.setReservations(HP, [
    canonicalReservation({
      externalId: "res-cf",
      code: "HMCF",
      arrivalDate: daysFromNow(2),
      departureDate: daysFromNow(5),
      conversationExternalId: "conv-cf",
      conversationLanguage: "en",
      lastMessageAt: new Date(Date.now() - 60_000),
    }),
  ]);
  fake.setMessages("res-cf", [canonicalMessage({ externalId: "m-cf-1", body: guestText, createdAt: new Date(Date.now() - 60_000) })]);

  const sync = await syncHospitable(orgId);
  expect(sync.messages).toBe(1);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { propertyId, externalReservationId: "res-cf" } });
  // Gelen mesaj ingest sözleşmesinden geçti: PII'siz olay kaydı aynı işlemde yazıldı.
  expect(await prisma.ingestEvent.count({ where: { organizationId: orgId, kind: { startsWith: "message." } } })).toBe(1);
  return { orgId, conversationId: conversation.id };
}

describe("🚨 kritik akış — inbound → yapay zekâ → kuyruk → teslim → karar kaydı (tek test)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    fake.reset();
    resetPrimaryOrgCache();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    __setIngestAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetPrimaryOrgCache();
  });

  it("güvenli soru: kapı geçer → kuyruğa TEK satır → işçi sağlayıcıya TEK kez teslim eder → konuşma cevaplandı → karar kaydı auto_sent", async () => {
    const fetchSpy = openAiReturns(SAFE);
    const { orgId, conversationId } = await ingestGuestMessage("Is there free parking at the building?");

    const decision = await applyChannelAutoReply(conversationId);
    expect(decision).toMatchObject({ sent: true, queued: true });
    expect(fetchSpy).toHaveBeenCalled(); // model gerçekten çağrıldı (sahte HTTP), cevap gerçek ayrıştırıcıdan geçti

    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { conversationId } });
    expect(row).toMatchObject({ organizationId: orgId, status: "pending" });
    // Teslim edilene kadar konuşma "cevaplandı" sayılmaz.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("new");

    const send: OutboxSendFn = vi.fn(async () => ({ ok: true as const, providerMessageId: "prov-cf-1" }));
    await drainOutboxOnce({ send, tokenFor: async () => TOKEN });
    expect(send).toHaveBeenCalledTimes(1);
    const [sentRow] = vi.mocked(send).mock.calls[0];
    expect(sentRow.id).toBe(row.id);

    const delivered = await prisma.message.findUniqueOrThrow({ where: { id: row.messageId! } });
    expect(delivered).toMatchObject({ direction: "outbound", authorType: "ai", senderName: "GuestOps AI", externalId: "prov-cf-1" });
    // Teslim edilen metin = model cevabı + otomatik asistan açıklaması (açıklama kuyruktan da geçer).
    expect(delivered.body.startsWith(SAFE.reply)).toBe(true);
    expect(delivered.body).toContain("automated assistant");
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sent");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("answered");

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev).toMatchObject({ organizationId: orgId, finalDecision: "auto_sent" });
    expect(JSON.stringify(ev)).not.toContain("parking at the building"); // karar kaydı misafir metni taşımaz
    expect(mockEmail).not.toHaveBeenCalled();

    // İkinci tur: aynı mesaja ikinci cevap kuyruğa girmez, işçi yeniden göndermez.
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
    await drainOutboxOnce({ send, tokenFor: async () => TOKEN });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(1);
  });

  it("KONTROL — iade talebi aynı zincirde: kuyruk satırı YOK, sağlayıcı çağrılmaz, giden mesaj yok, karar kaydı human_review (money_refund)", async () => {
    openAiReturns(SAFE); // model "güvenli park sorusu" dese bile kod kapısı misafirin kendi sözüne bakar
    const { orgId, conversationId } = await ingestGuestMessage("I want a refund, please give my money back.");

    const decision = await applyChannelAutoReply(conversationId);
    expect(decision).toMatchObject({ sent: false, skippedReason: "low_confidence_or_risky" });

    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(0);
    const send: OutboxSendFn = vi.fn(async () => ({ ok: true as const, providerMessageId: "never" }));
    await drainOutboxOnce({ send, tokenFor: async () => TOKEN });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);

    // Konuşmayı "sorunlu" yapan + ev sahibine e-posta atan ayrı alarm yoludur (`auto-reply-channel`, `alerts-*` testleri); bu zincirin
    // işi cevabı TUTMAK ve kararı kaydetmek.
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev).toMatchObject({ organizationId: orgId, finalDecision: "human_review", riskType: "money_refund", reason: "low_confidence_or_risky" });
    expect(JSON.stringify(ev)).not.toContain("refund, please");
  });
});
