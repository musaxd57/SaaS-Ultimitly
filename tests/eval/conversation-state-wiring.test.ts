import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// KONUŞMA ANLAMA DURUMU EVAL'İ — BAĞLANTI PİNİ ("yüklem var, argüman yok" dersi). Ücretli koşunun her satırı bu
// fonksiyondan (`runScenario`) geçer; burada cevap modeli ve anlama katmanı SAHTE, gerisi (bilgi seçimi, tarih satırı
// kararı, durum kurucusu, kapı, kapanış yolları) ürünün kendisi. Pinlenenler: kapalı kolda özet ve tarih satırı YOK,
// açık kolda ikisi de var; geçmiş cevaplanan mesajı taşır (kanal yolu); sözcük yolu ve bitmiş konaklama modeli
// çağırmaz; anlam yolu anlama katmanının çıktısına bağlı; yedek düşüşünde bir kez yeniden deneme; kol ↔ bayrak uyuşmazlığı
// sessiz geçmez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai/semantic/understand", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/semantic/understand")>()),
  understandGuestMessages: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));

import { suggestReply } from "@/lib/ai";
import { understandGuestMessages, type UnderstandingOutcome } from "@/lib/ai/semantic/understand";
import type { UnderstandingIntent } from "@/lib/ai/semantic/understanding-schema";
import { runScenario, type CusDataset, type CusScenario } from "./conversation-state-harness";

const mockSuggest = vi.mocked(suggestReply);
const mockUnderstand = vi.mocked(understandGuestMessages);

const DATA: CusDataset = { version: 1, property: { name: "Lale Suites", checkInTime: "15:00", checkOutTime: "11:00" }, scenarios: [] };
const RUN_DAY = "2026-09-26";

const REPLY = {
  intent: "general",
  confidence: 0.9,
  reply: "Havlular yatak odasındaki dolapta.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};

function understood(intents: UnderstandingIntent[], stay: { requested: boolean; kind: string } = { requested: false, kind: "none" }): UnderstandingOutcome {
  return {
    status: "ok",
    ms: 1,
    cached: false,
    value: {
      language: "tr",
      requests: intents.map((intent) => ({ intent, queryTr: "", queryOriginal: "" })),
      stay: { requested: stay.requested, kind: stay.kind as never, checkinTime: null, checkoutTime: null },
    },
  };
}

const scenario = (over: Partial<CusScenario>): CusScenario => ({
  id: "w",
  class: "resolvable",
  lang: "tr",
  reservation: { arrivalInDays: -1, nights: 3 },
  message: "Havlular nerede?",
  expect: {},
  ...over,
});

const saved = process.env.AI_CONVERSATION_STATE_ENABLED;
beforeEach(() => {
  mockSuggest.mockReset();
  mockUnderstand.mockReset();
  delete process.env.AI_CONVERSATION_STATE_ENABLED;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AI_CONVERSATION_STATE_ENABLED;
  else process.env.AI_CONVERSATION_STATE_ENABLED = saved;
});

describe("Konuşma Anlama Durumu eval'i — ürüne bağlantı", () => {
  it("KAPALI kol: özet YOK, tarih satırı YOK · AÇIK kol: karar kaydından özet + rezervasyon günlü tarih satırı · geçmiş son mesajı taşır", async () => {
    const s = scenario({
      class: "pending_followup",
      reservation: { arrivalInDays: 1, nights: 2 },
      history: [{ direction: "inbound", body: "Yarın 11'de girebilir miyiz?", decision: { finalDecision: "human_review", stay: "early_checkin/defers" } }],
      message: "Bir gelişme var mı?",
    });
    mockUnderstand.mockResolvedValue(understood(["early_checkin"], { requested: true, kind: "early_checkin" }));
    mockSuggest.mockResolvedValue(REPLY);

    const off = await runScenario(DATA, s, "off", RUN_DAY, { retryDelayMs: 0 });
    const offInput = mockSuggest.mock.calls[0][0];
    expect(offInput.conversationState).toEqual({ isFirstOperatorReply: true, records: undefined });
    expect(mockUnderstand.mock.calls[0][0]).not.toHaveProperty("dateLine");
    const last = offInput.history?.at(-1);
    expect([last?.direction, last?.body, last?.author]).toEqual(["inbound", "Bir gelişme var mı?", "guest"]);
    expect(offInput.history).toHaveLength(2);
    // F14: satırın yazıldığı an eval aracının saatinden (varsayılan: cevaplanan mesaj bir dakika önce); cevaplanan
    // mesajın anı AYRI alanda da gider (kanal yoluyla aynı).
    expect(offInput.guestMessageAt?.getTime()).toBe(last?.at?.getTime());
    expect(offInput.now!.getTime() - offInput.guestMessageAt!.getTime()).toBe(60_000);
    expect(off.records).toBeUndefined();

    process.env.AI_CONVERSATION_STATE_ENABLED = "1";
    const on = await runScenario(DATA, s, "on", RUN_DAY, { retryDelayMs: 0 });
    const onInput = mockSuggest.mock.calls[1][0];
    expect(onInput.conversationState?.records?.items).toEqual([{ topic: "early_checkin", status: "pending_host" }]);
    expect(mockUnderstand.mock.calls[1][0].dateLine).toMatch(/check-in day/);
    expect(on.records).toBe(1);
    // Aynı gün ve saat iki kolda (tarih satırı kolla değişir, "şimdi" değişmez).
    expect(onInput.now?.toISOString()).toBe(offInput.now?.toISOString());
  });

  it("F14: senaryodaki yazar + yazıldığı an (dün 22:10 → bugün 09:05) modele kanal yoluyla aynı alanlardan gider", async () => {
    mockUnderstand.mockResolvedValue(understood(["checkin"]));
    mockSuggest.mockResolvedValue(REPLY);
    await runScenario(
      DATA,
      scenario({
        localTime: "10:00",
        history: [
          { direction: "inbound", body: "Yarın 11'de girebilir miyiz?", at: { daysAgo: 1, time: "22:10" } },
          { direction: "outbound", author: "host", body: "Kontrol edip yazacağım.", at: { daysAgo: 1, time: "22:30" } },
        ],
        message: "Bir gelişme var mı?",
        messageAt: { daysAgo: 0, time: "09:05" },
      }),
      "off",
      RUN_DAY,
      { retryDelayMs: 0 },
    );
    const input = mockSuggest.mock.calls[0][0];
    // İstanbul (+03:00): 25.09 22:10 = 19:10Z · 22:30 = 19:30Z · 26.09 09:05 = 06:05Z.
    expect(input.history?.map((h) => [h.author, h.at?.toISOString()])).toEqual([
      ["guest", "2026-09-25T19:10:00.000Z"],
      ["host", "2026-09-25T19:30:00.000Z"],
      ["guest", "2026-09-26T06:05:00.000Z"],
    ]);
    expect(input.guestMessageAt?.toISOString()).toBe("2026-09-26T06:05:00.000Z");
  });

  it("kol ile bayrak uyuşmazlığı sessiz karışık ölçüm olmaz — FIRLATIR", async () => {
    await expect(runScenario(DATA, scenario({}), "on", RUN_DAY)).rejects.toThrow(/uyuşmuyor/);
    process.env.AI_CONVERSATION_STATE_ENABLED = "1";
    await expect(runScenario(DATA, scenario({}), "off", RUN_DAY)).rejects.toThrow(/uyuşmuyor/);
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("kapanış sözcük yolu ve bitmiş konaklama: model de anlama katmanı da ÇAĞRILMAZ", async () => {
    const closing = await runScenario(
      DATA,
      scenario({
        class: "closing",
        history: [
          { direction: "inbound", body: "Wi-Fi şifresi nedir?" },
          { direction: "outbound", body: "Şifre Lale2025." },
        ],
        message: "Teşekkürler 🙏",
      }),
      "off",
      RUN_DAY,
    );
    expect([closing.silent, closing.modelRan, closing.ok]).toEqual(["lexical", false, true]);
    const ended = await runScenario(DATA, scenario({ reservation: { arrivalInDays: -6, nights: 2 } }), "off", RUN_DAY);
    expect([ended.silent, ended.modelRan]).toEqual(["reservation_ended", false]);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockUnderstand).not.toHaveBeenCalled();
  });

  it("kapanış anlam yolu anlama katmanının çıktısına bağlı: yalnız teşekkür → sessiz; ikizinde konu var → sessiz DEĞİL", async () => {
    const s = scenario({
      class: "closing",
      history: [
        { direction: "inbound", body: "Otopark var mı?" },
        { direction: "outbound", body: "Evet, bina önünde ücretsiz otopark var." },
      ],
      message: "Kolay gelsin",
    });
    const courtesy = { ...REPLY, confidence: 0.2, reply: "Rica ederiz." };
    mockSuggest.mockResolvedValue(courtesy);
    mockUnderstand.mockResolvedValue(understood(["greeting_thanks"]));
    const silent = await runScenario(DATA, s, "off", RUN_DAY, { retryDelayMs: 0 });
    expect([silent.silent, silent.auto, silent.gate]).toEqual(["semantic", false, "blocked"]);

    mockUnderstand.mockResolvedValue(understood(["parking"]));
    const twin = await runScenario(DATA, s, "off", RUN_DAY, { retryDelayMs: 0 });
    expect([twin.silent, twin.auto]).toEqual([null, false]);
  });

  it("model çıktısı satıra aynen: beyan, duruş, kayıtlı çıkış (SS:DD), anlama türü; anlama düşerse tür yok + durum 'failed'", async () => {
    mockSuggest.mockResolvedValue({ ...REPLY, statedCheckoutTime: "9:30", stayChange: { asked: "early_checkin", stance: "defers" } });
    mockUnderstand.mockResolvedValue(understood(["early_checkin"], { requested: true, kind: "early_checkin" }));
    const row = await runScenario(DATA, scenario({}), "off", RUN_DAY, { retryDelayMs: 0 });
    expect([row.asked, row.stance, row.stated, row.uKind, row.uStatus]).toEqual(["early_checkin", "defers", "09:30", "early_checkin", "ok"]);

    mockUnderstand.mockResolvedValue({ status: "failed", ms: 1 });
    const failed = await runScenario(DATA, scenario({}), "off", RUN_DAY, { retryDelayMs: 0 });
    expect([failed.uKind, failed.uStatus]).toEqual([null, "failed"]);
  });

  it("yedeğe düşüşte BİR kez yeniden dener; ikincisi de yedekse satır geçersiz", async () => {
    mockUnderstand.mockResolvedValue(understood(["cleaning_linen"]));
    mockSuggest.mockResolvedValueOnce({ ...REPLY, source: "fallback" as never }).mockResolvedValueOnce(REPLY);
    const row = await runScenario(DATA, scenario({}), "off", RUN_DAY, { retryDelayMs: 0 });
    expect([row.retried, row.ok, mockSuggest.mock.calls.length]).toEqual([true, true, 2]);

    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue({ ...REPLY, source: "fallback" as never });
    const bad = await runScenario(DATA, scenario({}), "off", RUN_DAY, { retryDelayMs: 0 });
    expect([bad.retried, bad.ok, mockSuggest.mock.calls.length]).toEqual([true, false, 2]);
  });
});
