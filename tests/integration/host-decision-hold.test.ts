import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// "EV SAHİBİNİZİN KARARIDIR" MİSAFİRE GİTMEZ — KANAL OTO-YANITI UÇTAN UCA (kurucu kararı 10-01: "hiç bir şekilde gitmemeli,
// sussa bile daha iyi … ertelemeyi gönderme"; gece notu: "host'a bir bildirim gider; tekrar tekrar gönderilmez").
// Anahtar `AI_HOST_DECISION_HOLD_ENABLED` VARSAYILAN KAPALI. Cevap modeli MOCK, DB gerçek, bekçi sahte fetch.
// Pinlenen: anahtar kapalıyken bugünkü davranış (ev sahibinin KENDİ sesiyle kanıtlı erteleme gider; ev sahibinden üçüncü kişi olarak söz
// eden erteleme kurucu 10-30 "mesajı ev sahibi yazıyor" kuralıyla anahtardan bağımsız tutulur — reply_host_voice); açıkken kanıtlı
// erteleme ve ev sahibi kararı cümlesi TUTULUR, ev sahibine mesaj başına TEK "Misafir cevabınızı bekliyor" e-postası, bilgi sorusu
// cevabı yine gider.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);
const replyWaitingMails = () => mockMail.mock.calls.filter((c) => /^Misafir cevabınızı bekliyor/.test(String(c[1])));

const BASE = {
  confidence: 0.9,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  riskType: null,
  usedSources: ["property:checkInTime"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(messages: { direction: "inbound" | "outbound"; body: string }[]) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      timezone: "Europe/Istanbul",
      alertEmail: "host@example.test",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const t0 = Date.now() - (messages.length + 1) * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: {
        create: messages.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : "Host",
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

async function decision(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] });
  return ev;
}

/** Bekçi: hassas konaklama isteği + cevap ERTELİYOR (ikinci model). */
const guardDefers = (kind: string, checkin: string | null, checkout: string | null) => ({
  guest_requests_change: true,
  kind,
  requested_checkin_time: checkin,
  requested_checkout_time: checkout,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: true,
  reply_refuses: false,
  reply_amounts: [],
  reply_price_terms: false,
});

function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}

const GERMAN_ASK = [{ direction: "inbound" as const, body: "Können wir noch eine Nacht bleiben?" }];
const GERMAN_DEFERRAL = {
  ...BASE,
  intent: "extend_stay",
  detectedLanguage: "de",
  reply: "Das muss Ihr Gastgeber entscheiden.",
  stayChange: { asked: "extend" as const, stance: "defers" as const },
};
// Ev sahibinin kendi sesiyle aynı erteleme (kurucu 10-30): ses kapısı tutmaz, yalnız anahtar ayırır.
const GERMAN_DEFERRAL_OWN_VOICE = { ...GERMAN_DEFERRAL, reply: "Das muss ich noch entscheiden." };

describe("kanal oto-yanıtı — ev sahibi kararı tutulur (AI_HOST_DECISION_HOLD_ENABLED)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: anahtar kapalıyken iki modelin doğruladığı erteleme (ev sahibinin kendi sesi) gider, 'cevap bekliyor' e-postası YOK (bugünkü davranış)", async () => {
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: guardDefers("extend", null, null) }));
    mockSuggest.mockResolvedValue(GERMAN_DEFERRAL_OWN_VOICE);
    const id = await seed(GERMAN_ASK);
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(replyWaitingMails()).toHaveLength(0);
  });

  it("🚨 kurucu 10-30: anahtar kapalıyken de ev sahibinden üçüncü kişi olarak söz eden erteleme GİTMEZ (reply_host_voice); 'cevap bekliyor' e-postası yok", async () => {
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: guardDefers("extend", null, null) }));
    mockSuggest.mockResolvedValue(GERMAN_DEFERRAL);
    const id = await seed(GERMAN_ASK);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await decision(id);
    expect(JSON.parse(ev.kbEvidenceJson ?? "{}").g?.d).toBe("reply_host_voice");
    expect(ev.reason).toBe("low_confidence_or_risky");
    expect(replyWaitingMails()).toHaveLength(0);
  });

  it("🚨 açıkken ev sahibini adlandıran kanıtlı erteleme GİTMEZ; karar kaydı handoff_notice (çıktı vetosu önce düşer); ev sahibine TEK e-posta (ikinci geçişte yinelenmez)", async () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: guardDefers("extend", null, null) }));
    mockSuggest.mockResolvedValue(GERMAN_DEFERRAL);
    const id = await seed(GERMAN_ASK);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).reason).toBe("handoff_notice");
    expect(replyWaitingMails()).toHaveLength(1);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv.status).not.toBe("answered");

    // Aynı mesaj yeniden değerlendirilir (eşzamanlı geçiş / yeniden adaylık): ikinci e-posta YOK.
    await prisma.conversation.update({ where: { id }, data: { autoReplyAttemptedAt: null } });
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(replyWaitingMails()).toHaveLength(1);
  });

  it("🚨 açıkken ev sahibini ADLANDIRMAYAN kanıtlı erteleme de (müsaitlik / temizliğe bağlı) gitmez", async () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: guardDefers("early_checkin", "13:00", null) }));
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "early_checkin",
      detectedLanguage: "tr",
      reply: "Standart giriş saati 15:00. Saat 13:00'te giriş müsaitlik ve temizlik programına bağlı.",
      stayChange: { asked: "early_checkin" as const, stance: "defers" as const },
    });
    const id = await seed([{ direction: "inbound", body: "Saat 13:00'te giriş yapabilir miyiz?" }]);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).reason).toBe("availability_unconfirmed");
    expect(replyWaitingMails()).toHaveLength(1);
  });

  it("açıkken konaklama dışı 'ev sahibinin kararı' cevabı da tutulur: karar kaydı handoff_notice + tek e-posta", async () => {
    // Konu bilerek evcil hayvan DEĞİL: kurucu 10-23 akşam 4.4 (A) evcil hayvandan söz eden cevabı anahtardan bağımsız tutar (↓ ayrı satır);
    // bu test yalnız "ev sahibinin kararıdır" cümlesinin anahtarını sınar.
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const reply = {
      ...BASE,
      intent: "general",
      detectedLanguage: "en",
      reply: "Whether the rooftop terrace can be used is the host's call.",
      stayChange: { asked: "none" as const, stance: "none" as const },
    };
    mockSuggest.mockResolvedValue(reply);
    const id = await seed([{ direction: "inbound", body: "Can we use the rooftop terrace?" }]);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).reason).toBe("handoff_notice");
    expect(replyWaitingMails()).toHaveLength(1);

    // KONTROL: anahtar kapalıyken de aynı cevap GİTMEZ — kurucu 10-30 ("mesajı ev sahibi yazıyor"): "the host's call" ev sahibinden
    // üçüncü kişi olarak söz eder → ses kapısı anahtardan bağımsız tutar (g.d reply_host_voice). Ev sahibi kararı yolu (handoff_notice +
    // tek e-posta) yalnız anahtarla.
    await resetDb();
    mockMail.mockClear();
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "");
    const off = await seed([{ direction: "inbound", body: "Can we use the rooftop terrace?" }]);
    await applyChannelAutoReply(off);
    expect(mockSend).not.toHaveBeenCalled();
    const offEv = await decision(off);
    expect(JSON.parse(offEv.kbEvidenceJson ?? "{}").g?.d).toBe("reply_host_voice");
    expect(offEv.reason).toBe("low_confidence_or_risky");
    expect(replyWaitingMails()).toHaveLength(0);
    // Ev sahibinin kendi sesiyle aynı cevap anahtar kapalıyken gider (anahtarın kendi etkisi).
    await resetDb();
    mockSuggest.mockResolvedValue({ ...reply, reply: "Whether the rooftop terrace can be used is our call." });
    const own = await seed([{ direction: "inbound", body: "Can we use the rooftop terrace?" }]);
    await applyChannelAutoReply(own);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(replyWaitingMails()).toHaveLength(0);

    // 🚨 4.4 (A): evcil hayvan cevabı anahtar KAPALIYKEN de gitmez (bilgi tabanı ücretsiz kabul demiyor) — eskiden buradaki kontrol
    // "Whether pets are allowed is the host's call." cevabının gittiğini sabitliyordu.
    await resetDb();
    mockSend.mockClear();
    mockSuggest.mockResolvedValue({ ...reply, reply: "Whether pets are allowed is the host's call." });
    const pet = await seed([{ direction: "inbound", body: "Can we bring our small dog?" }]);
    await applyChannelAutoReply(pet);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("açıkken bilgi sorusunun cevabı (ev sahibi kararı yok) gider; e-posta YOK", async () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch({}));
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "checkin",
      detectedLanguage: "en",
      reply: "Check-in is from 15:00.",
      stayChange: { asked: "none" as const, stance: "none" as const },
    });
    const id = await seed([{ direction: "inbound", body: "What time is check-in?" }]);
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(replyWaitingMails()).toHaveLength(0);
  });
});
