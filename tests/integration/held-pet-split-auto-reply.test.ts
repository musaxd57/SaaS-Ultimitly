import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// S3 (kurucu kararı 11-11; anahtar `AI_HELD_PET_SPLIT_ENABLED`, VARSAYILAN KAPALI) — KANAL OTO-YANITI UÇTAN UCA.
//
// "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?" → bugün cevabın TAMAMI ev sahibine kalıyor (evcil hayvan kemeri tutulan öğeyi de
// "hayvan turu" sayıyor). Anahtar açıkken öteki sorunun cevabı gider, evcil hayvan isteği ev sahibinde AÇIK kalır ve ev sahibine bildirilir; cevap o
// isteğe dair onay / ret / ima taşıyorsa yine gitmez. Model çağrıları sahte (cevap modeli + anlama katmanı), veritabanı gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "m", effort: null })),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
  replyPromptVersion: vi.fn((b: { mode: boolean; held: boolean }) => `v-${b.mode ? 1 : 0}${b.held ? 1 : 0}`),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandingEnabled: () => true, understandGuestMessages: vi.fn() };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply } from "@/lib/automation";
import { hasOpenHostWork } from "@/lib/conversation-attention";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);

// Öteki soru bilerek sır içermiyor (otopark): rezervasyonsuz konuşmada şifre taşıyan kalem modele hiç gösterilmez (sır kapısı).
const BOTH = "Köpeğimizi getirebilir miyiz? Otopark var mı?";
const WIFI_ANSWER = "Otopark ücretsizdir, binanın arkasındadır.";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(requests: { intent: string; message: number }[]): MessageUnderstanding {
  const u = parseUnderstanding(
    { language: "tr", requests: requests.map((r) => ({ query_tr: `${r.intent} sorusu`, query_original: "q", ...r })), stay_change: STAY_NONE, withdrawn: [] },
    { items: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const understands = (requests: { intent: string; message: number }[]) =>
  mockUnderstand.mockResolvedValueOnce({ status: "ok", value: understood(requests), ms: 1, cached: false });

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "parking",
    confidence: 0.95,
    reply: WIFI_ANSWER,
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    answeredRequests: { ok: true, refs: ["R1"] },
    ...over,
  };
}

async function seed(message: string, kb: { title: string; content: string }[] = [{ title: "Otopark", content: "Otopark ücretsizdir; binanın arkasındadır." }]) {
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
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  for (const item of kb) {
    // Onaylı kalem (A1): onaysız kalem cevap modeline gitmez — o zaman hiçbir cevabın dayanağı olmaz.
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, category: "general", title: item.title, content: item.content, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: message, createdAt }] },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

async function itemsOf(conversationId: string) {
  const rows = await prisma.conversationItem.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({ kind: r.kind, sensitivity: r.sensitivity, status: r.status }));
}
const sentBodies = () => mockSend.mock.calls.map((c) => String((c[0] as { body?: string }).body ?? c[1] ?? ""));
const outboundCount = (conversationId: string) => prisma.message.count({ where: { conversationId, direction: "outbound" } });
const PETS_AND_WIFI = [
  { intent: "pets", message: 1 },
  { intent: "parking", message: 1 },
];

describe("kanal oto-yanıtı — evcil hayvan + başka soru (S3)", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    mockSend.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("anahtar KAPALI (bugün): otopark cevabı da GİTMEZ; iki istek de ev sahibinde", async () => {
    const { conversationId } = await seed(BOTH);
    understands(PETS_AND_WIFI);
    mockSuggest.mockResolvedValueOnce(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundCount(conversationId)).toBe(0);
    expect((await itemsOf(conversationId)).map((i) => i.status)).not.toContain("answered");
  });

  it("🚨 anahtar AÇIK: otopark cevabı GİDER; evcil hayvan isteği ev sahibinde açık kalır ve ev sahibine bildirilir", async () => {
    vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", "1");
    const { orgId, conversationId } = await seed(BOTH);
    understands(PETS_AND_WIFI);
    mockSuggest.mockResolvedValueOnce(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true); // ⬅️ ESKİDE false: cevabın tamamı tutuluyordu
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0]).toContain("Otopark ücretsizdir");
    expect(sentBodies()[0]).not.toMatch(/köpe|evet|getirebilir/iu);
    expect(await itemsOf(conversationId)).toEqual([
      { kind: "pets", sensitivity: "sensitive", status: "pending_host" },
      { kind: "parking", sensitivity: "none", status: "answered" },
    ]);
    // Ev sahibi evcil hayvan sorusundan haberdar (tutulan öğenin bugünkü bildirimi) ve konuşmada açık iş duruyor.
    expect(mockMail).toHaveBeenCalledTimes(1);
    const messages = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(await hasOpenHostWork(orgId, messages)).toBe(true);
    // Cevap modeline giden istekte evcil hayvan kuralı işareti var (kural + kapı çifti).
    expect(mockSuggest.mock.calls[0]![0]).toMatchObject({ conversationItems: { petHeldRule: true, held: [{ kind: "pets" }] } });
  });

  it("🚨 anahtar AÇIK: cevap izin / onay / hayvan sözü taşıyorsa yine GİTMEZ (otopark 'cevaplandı' YAZILMAZ)", async () => {
    vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", "1");
    for (const reply of [`Evet, getirebilirsiniz. ${WIFI_ANSWER}`, `Tabii! ${WIFI_ANSWER}`, `${WIFI_ANSWER} Köpeğiniz için ayrıca döneceğiz.`]) {
      await resetDb();
      mockSend.mockClear();
      const { conversationId } = await seed(BOTH);
      understands(PETS_AND_WIFI);
      // İlk taslak tutulunca akış bir kez daha deneyebilir — her çağrıda aynı sızıntılı cevap.
      mockSuggest.mockResolvedValue(verdict({ reply }));
      const out = await applyChannelAutoReply(conversationId);
      expect([reply, out.sent]).toEqual([reply, false]);
      expect(mockSend).not.toHaveBeenCalled();
      expect((await itemsOf(conversationId)).map((i) => i.status)).not.toContain("answered");
      mockSuggest.mockReset();
    }
  });

  it("🚨 anahtar AÇIK: yanındaki sorunun cevabı bilgi tabanında YOKSA modelin uydurduğu cevap GİTMEZ; iki istek de ev sahibinde kalır", async () => {
    vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", "1");
    // Bilgi tabanında yalnız otopark var; misafir kahvaltıyı soruyor. Ölçüm 11-12: model bu durumda "Kahvaltı servisi bulunmuyor." uydurdu.
    const { conversationId } = await seed("Köpeğimizi getirebilir miyiz? Kahvaltı veriyor musunuz?");
    mockUnderstand.mockResolvedValueOnce({
      status: "ok",
      ms: 1,
      cached: false,
      value: (() => {
        const u = parseUnderstanding(
          {
            language: "tr",
            requests: [
              { intent: "pets", message: 1, query_tr: "evcil hayvan köpek kabul", query_original: "köpeğimizi getirebilir miyiz" },
              { intent: "amenities", message: 1, query_tr: "kahvaltı var mı", query_original: "Kahvaltı veriyor musunuz?" },
            ],
            stay_change: STAY_NONE,
            withdrawn: [],
          },
          { items: true },
        );
        if (!u) throw new Error("fixture");
        return u;
      })(),
    });
    mockSuggest.mockResolvedValue(verdict({ intent: "general", reply: "Kahvaltı servisi bulunmuyor." }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false); // ⬅️ dayanak şartı olmasaydı uydurma cevap misafire giderdi
    expect(mockSend).not.toHaveBeenCalled();
    expect((await itemsOf(conversationId)).map((i) => i.status)).not.toContain("answered");
    const events = await prisma.riskEvent.findMany({ where: { conversationId }, select: { finalDecision: true, kbEvidenceJson: true } });
    expect(events.map((e) => e.finalDecision)).toEqual(["human_review"]);
    expect(events[0]!.kbEvidenceJson ?? "").toContain("items_answer_ungrounded"); // tutma gerekçesi karar kaydında
  });

  it("anahtar AÇIK olsa da: anlama katmanı evcil hayvan isteğini ÇIKARAMADIYSA (yalnız otopark öğesi) cevap bugünkü gibi tutulur", async () => {
    vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", "1");
    const { conversationId } = await seed(BOTH);
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValue(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL: evcil hayvan sorusu olmayan turda anahtar hiçbir şeyi değiştirmez (otopark cevabı iki durumda da gider; istem işareti yok)", async () => {
    for (const flag of ["", "1"]) {
      await resetDb();
      mockSend.mockClear();
      mockSuggest.mockReset();
      vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", flag);
      const { conversationId } = await seed("Otopark var mı?");
      understands([{ intent: "parking", message: 1 }]);
      mockSuggest.mockResolvedValueOnce(verdict());
      expect([flag, (await applyChannelAutoReply(conversationId)).sent]).toEqual([flag, true]);
      expect((mockSuggest.mock.calls[0]![0] as { conversationItems?: { petHeldRule?: true } }).conversationItems?.petHeldRule).toBeUndefined();
    }
  });
});
