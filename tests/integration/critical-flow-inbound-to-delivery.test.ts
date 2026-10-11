import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// KRİTİK AKIŞ — Inbound → sınıflandırma/AI → outbox → teslim → karar kaydı, TEK testte (kurucu talimatı 09-07, "Merkezi kritik akış
// matrisi"; `docs/TEST-EVIDENCE-CONTRACT.md` §3'teki ⚠️ "parça parça korunuyor, tek uçtan uca test yok" boşluğu — Haiku kapsam
// denetimi 10-11).
//
// Gerçek olan: sağlayıcı senkronu (`syncHospitable` → ingest yazma servisi → IngestEvent), model cevabı ayrıştırıcısı (`@/lib/ai`
// MOCK'LANMAZ), güvenlik kapısı, kalıcı gönderim kuyruğu (`enqueueOutbound`), kuyruk işçisi (`drainOutboxOnce`, VARSAYILAN bağımlılıklar:
// gerçek kimlik çözümü + `dispatchOutbound` + sağlayıcı istemcisi), karar kaydı (`RiskEvent`), PostgreSQL. Sahte olan YALNIZ dış sınırlar:
// okuma tarafında fake ingest adaptörü; HTTP'de adrese göre yönlendirilen tek `fetch` (OpenAI → model cevabı, sağlayıcının mesaj ucu →
// teslim kimliği, BİLİNMEYEN adres → test kırılır); alarm e-postası. Haiku 10-11: ilk sürüm işçinin `send` / `tokenFor`'unu taklit ediyor,
// ikinci tur iddiasını teslimden SONRA kuruyordu (boş iddia) ve model çağrı sayısını sabitlemiyordu.
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
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { emailService } from "@/lib/email";

const TOKEN = "tok-critical-flow";
const HP = "hp-critical-flow";
const fake = new FakeIngestProvider();
const mockEmail = vi.mocked(emailService.sendReporting);

/** Dış HTTP sınırı: OpenAI → verilen model cevabı; sağlayıcının mesaj ucu → teslim kimliği; başka her adres → hata (sessiz yeşil yok). */
function httpBoundary(modelContent: Record<string, unknown>) {
  const model: string[] = [];
  const provider: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://api.openai.com/")) {
        model.push(url);
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(modelContent) } }] }), {
          status: 200,
        });
      }
      if (url.includes("/reservations/res-cf/messages") && init?.method === "POST") {
        provider.push({ url, method: init.method, body: String(init.body ?? "") });
        return new Response(JSON.stringify({ data: { id: "prov-cf-1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`beklenmeyen dış çağrı: ${init?.method ?? "GET"} ${url}`);
    }),
  );
  return { model, provider };
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

  it("güvenli soru: kapı geçer → kuyruğa TEK satır → işçi sağlayıcının mesaj ucuna TEK POST → konuşma cevaplandı → karar kaydı auto_sent", async () => {
    const http = httpBoundary(SAFE);
    const { orgId, conversationId } = await ingestGuestMessage("Is there free parking at the building?");

    const decision = await applyChannelAutoReply(conversationId);
    expect(decision).toMatchObject({ sent: true, queued: true });
    // Model gerçekten çağrıldı (bugün tek model çağrısı: anlama / bekçi / embedding kapalı), cevap gerçek ayrıştırıcıdan geçti.
    expect(http.model).toHaveLength(1);
    expect(http.provider).toHaveLength(0); // karar anında sağlayıcıya hiçbir şey gitmez

    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { conversationId } });
    expect(row).toMatchObject({ organizationId: orgId, status: "pending" });
    // Teslim edilene kadar konuşma "cevaplandı" sayılmaz.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("new");

    // Teslimden ÖNCE ikinci tur: bekleyen satır varken ikinci cevap kuyruğa girmez, model yeniden çağrılmaz.
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(1);
    expect(http.model).toHaveLength(1);

    // İşçi VARSAYILAN bağımlılıklarla: gerçek kimlik çözümü + gerçek gönderim katmanı → sağlayıcının mesaj ucu.
    await drainOutboxOnce();
    expect(http.provider).toHaveLength(1);
    expect(http.provider[0].method).toBe("POST");
    expect(JSON.parse(http.provider[0].body).body.startsWith(SAFE.reply)).toBe(true);

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

    // Teslimden sonra: yeni tur yok, işçi yeniden göndermez.
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
    await drainOutboxOnce();
    expect(http.provider).toHaveLength(1);
    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(1);
  });

  it("KONTROL — iade talebi aynı zincirde: kuyruk satırı YOK, sağlayıcı çağrılmaz, giden mesaj yok, karar kaydı human_review (money_refund)", async () => {
    const http = httpBoundary(SAFE); // model "güvenli park sorusu" dese bile kod kapısı misafirin kendi sözüne bakar
    const { orgId, conversationId } = await ingestGuestMessage("I want a refund, please give my money back.");

    const decision = await applyChannelAutoReply(conversationId);
    expect(decision).toMatchObject({ sent: false, skippedReason: "low_confidence_or_risky" });
    expect(http.model).toHaveLength(1); // model çağrıldı ve "güvenli" dedi — tutan kod kapısı

    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(0);
    await drainOutboxOnce();
    expect(http.provider).toHaveLength(0);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);

    // Konuşmayı "sorunlu" yapan + ev sahibine e-posta atan ayrı alarm yoludur (`auto-reply-channel`, `alerts-*` testleri); bu zincirin
    // işi cevabı TUTMAK ve kararı kaydetmek.
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(ev).toMatchObject({ organizationId: orgId, finalDecision: "human_review", riskType: "money_refund", reason: "low_confidence_or_risky" });
    expect(JSON.stringify(ev)).not.toContain("refund, please");
  });
});
