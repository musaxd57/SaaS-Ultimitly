import { describe, it, expect } from "vitest";
import { lexicalClosingOnly, semanticClosingOnly, CLOSING_MAX_MODEL_CONFIDENCE } from "@/lib/ai/closing-turn";
import { isClosingHandled, CLOSING_HANDLED_REASON } from "@/lib/conversation-attention";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";

// ---------------------------------------------------------------------------
// KAPANIŞA SESSİZLİK (kurucu kuralı 09-25): "Guest yalnızca 'Teşekkürler', 'Tamamdır', '👍', 'Harika', 'Anladım' gibi
// conversation-closing acknowledgment gönderiyorsa ve açıkta cevaplanmamış başka bir soru/istek yoksa AI hiçbir şey
// göndermesin." Saf yüklemler; bağlantı (kanal + QR) `tests/integration/closing-silence.test.ts`.
// ---------------------------------------------------------------------------

const THANKS_ONLY: MessageUnderstanding = {
  language: "tr",
  requests: [{ intent: "greeting_thanks", queryTr: null, queryOriginal: null }],
  stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
} as unknown as MessageUnderstanding;

const CLOSING_REPLY = { intent: "general", confidence: 0.3, source: "openai" };

describe("sözcük yolu — cevapsız mesajların HEPSİ kapanış", () => {
  it("teşekkür / onay / emoji / övgü tek başına kapanıştır", () => {
    for (const t of ["Teşekkürler!", "Tamamdır", "👍", "Harika!", "Her şey harikaydı, çok teşekkürler!"]) {
      expect(lexicalClosingOnly([t]), t).toBe(true);
    }
  });

  it("🚨 cevapsız GERÇEK bir istek varsa kapanış DEĞİL (tek mesaja değil tümüne bakılır)", () => {
    expect(lexicalClosingOnly(["Bir gece daha kalabilir miyiz?", "Teşekkürler!"])).toBe(false);
    expect(lexicalClosingOnly(["Teşekkürler!", "Wifi şifresi nedir?"])).toBe(false);
    expect(lexicalClosingOnly(["Anladım teşekkürler ama 12'de gelebilir miyiz?"])).toBe(false);
  });

  it("boş liste / yalnız boşluk kapanış sayılmaz (sessizlik için en az bir kapanış mesajı gerekir)", () => {
    expect(lexicalClosingOnly([])).toBe(false);
    expect(lexicalClosingOnly(["   "])).toBe(false);
    // Boş gövdeler (sistem satırı vb.) sayılmaz; kalanlar kapanışsa kapanış.
    expect(lexicalClosingOnly(["", "Teşekkürler"])).toBe(true);
  });
});

describe("anlam yolu — iki bağımsız model 'yalnız teşekkür/kapanış' diyor", () => {
  const ok = { unanswered: ["Anladım, kolay gelsin"], understood: THANKS_ONLY, reply: CLOSING_REPLY };

  it("anlama katmanı yalnız selam/teşekkür + cevap modeli genel niyet ve düşük güven → kapanış", () => {
    expect(semanticClosingOnly(ok)).toBe(true);
  });

  it("anlama katmanı yoksa / koşmadıysa / istek bulmadıysa hüküm YOK", () => {
    expect(semanticClosingOnly({ ...ok, understood: null })).toBe(false);
    expect(semanticClosingOnly({ ...ok, understood: undefined })).toBe(false);
    expect(semanticClosingOnly({ ...ok, understood: { ...THANKS_ONLY, requests: [] } })).toBe(false);
  });

  it("anlama katmanı selamın yanında BAŞKA bir niyet görürse kapanış değil", () => {
    const withAsk = {
      ...THANKS_ONLY,
      requests: [...THANKS_ONLY.requests, { intent: "wifi", queryTr: "wifi şifresi", queryOriginal: "wifi" }],
    } as unknown as MessageUnderstanding;
    expect(semanticClosingOnly({ ...ok, understood: withAsk })).toBe(false);
  });

  it("anlama katmanı konaklama isteği gördüyse (niyet etiketi selam olsa bile) kapanış değil", () => {
    const stay = { ...THANKS_ONLY, stay: { ...THANKS_ONLY.stay, requested: true, kind: "early_checkin" } } as unknown as MessageUnderstanding;
    expect(semanticClosingOnly({ ...ok, understood: stay })).toBe(false);
  });

  it("cevap modeli kendi kapanış kuralına uymadıysa (başka niyet / güven ≥ 0.4 / model değil / sonsuz) kapanış değil", () => {
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, intent: "checkin" } })).toBe(false);
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, confidence: CLOSING_MAX_MODEL_CONFIDENCE } })).toBe(false);
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, confidence: 0.39 } })).toBe(true);
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, source: "fallback" } })).toBe(false);
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, confidence: Number.NaN } })).toBe(false);
  });

  it("anlama katmanının göremediği mesaj varsa hüküm YOK (pencere 5 mesaj; uzun mesaj)", () => {
    const six = Array.from({ length: 6 }, () => "Anladım");
    expect(semanticClosingOnly({ ...ok, unanswered: six })).toBe(false);
    expect(semanticClosingOnly({ ...ok, unanswered: six.slice(0, 5) })).toBe(true);
    expect(semanticClosingOnly({ ...ok, unanswered: ["Anladım " + "x".repeat(300)] })).toBe(false);
    expect(semanticClosingOnly({ ...ok, unanswered: [] })).toBe(false);
  });
});

describe("'cevap gerekmedi' hâli — durum değişmez, TÜRETİLİR", () => {
  const at = new Date("2026-09-25T10:00:00Z");
  const base = { status: "new", skippedReason: CLOSING_HANDLED_REASON, autoReplyAttemptedAt: at, lastMessageAt: at };

  it("kapanış kararı + damga son mesaja yetişmiş → cevap gerekmedi", () => {
    expect(isClosingHandled(base)).toBe(true);
    expect(isClosingHandled({ ...base, status: "waiting" })).toBe(true);
    // QR sohbeti her zaman `answered` tutulur: sessiz kalınan teşekkürü "Dikkat gerektirenler" cevapsız saymamalı.
    expect(isClosingHandled({ ...base, status: "answered" })).toBe(true);
  });

  it("misafir YENİDEN yazınca (son mesaj damgayı geçti) hâl kendiliğinden düşer", () => {
    expect(isClosingHandled({ ...base, lastMessageAt: new Date(at.getTime() + 1) })).toBe(false);
  });

  it("🚨 'Sorunlu' ASLA gizlenmez; başka gerekçe / damgasız konuşma bu hâlde değil", () => {
    expect(isClosingHandled({ ...base, status: "problem" })).toBe(false);
    expect(isClosingHandled({ ...base, skippedReason: "low_confidence_or_risky" })).toBe(false);
    expect(isClosingHandled({ ...base, skippedReason: null })).toBe(false);
    expect(isClosingHandled({ ...base, autoReplyAttemptedAt: null })).toBe(false);
  });
});
