import { describe, it, expect } from "vitest";
import {
  closingMayHide,
  hasAckSignal,
  hasPriorReply,
  lexicalClosingOnly,
  semanticClosingOnly,
  CLOSING_MAX_MODEL_CONFIDENCE,
  type ClosingThreadMessage,
} from "@/lib/ai/closing-turn";
import { isPositiveFeedback } from "@/lib/ai/fallback";
import { isClosingHandled, CLOSING_HANDLED_REASON, CLOSING_OPEN_REASON } from "@/lib/conversation-attention";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";

// ---------------------------------------------------------------------------
// KAPANIŞA SESSİZLİK (kurucu kuralı 09-25): "Guest yalnızca 'Teşekkürler', 'Tamamdır', '👍', 'Harika', 'Anladım' gibi
// conversation-closing acknowledgment gönderiyorsa ve açıkta cevaplanmamış başka bir soru/istek yoksa AI hiçbir şey
// göndermesin." Saf yüklemler; bağlantı (kanal + QR) `tests/integration/closing-silence.test.ts`.
// İnceleme 09-25 (P1/P2): övgü listesi soru işaretsiz soruyu kabul ediyordu; anlam yolu tek modelin hükmüne ve kesilmiş
// istek listesine kalıyordu; selam susturuluyordu; teklif kabulü / devirden sonraki teşekkür konuşmayı GİZLİYORDU.
// ---------------------------------------------------------------------------

const THANKS_ONLY: MessageUnderstanding = {
  language: "tr",
  requests: [{ intent: "greeting_thanks", queryTr: null, queryOriginal: null }],
  stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
} as unknown as MessageUnderstanding;

const CLOSING_REPLY = { intent: "general", confidence: 0.3, source: "openai", missingInfo: [], actionSuggestion: null };

describe("sözcük yolu — cevapsız mesajların HEPSİ teşekkür/onay", () => {
  it("teşekkür / onay / emoji tek başına kapanıştır", () => {
    for (const t of ["Teşekkürler!", "Tamamdır", "👍", "Harika!", "Got it, thanks!"]) {
      expect(lexicalClosingOnly([t]), t).toBe(true);
    }
  });

  it("🚨 P1: övgü listesi bu yolda YOK — soru işaretsiz İngilizce soru / varış bildirimi susturulmaz", () => {
    for (const t of [
      "is the apartment clean",
      "Is it clean",
      "Is the house comfortable",
      "Recommend a place",
      "Great we are here",
      "Perfect, we are here",
    ]) {
      expect(lexicalClosingOnly([t]), t).toBe(false);
      // Kök neden de kapandı: övgü dedektörü bunları övgü SAYMAZ (nezaket cevabı yolu da düzeldi).
      expect(isPositiveFeedback(t), t).toBe(false);
    }
    // Gerçek övgü hâlâ övgüdür (nezaket cevabı yolu), ama sessizlik yolu değildir → modele gider.
    expect(isPositiveFeedback("Her şey harikaydı, çok teşekkürler!")).toBe(true);
    expect(lexicalClosingOnly(["Her şey harikaydı, çok teşekkürler!"])).toBe(false);
    expect(isPositiveFeedback("We loved the place, highly recommend!")).toBe(true);
  });

  it("🚨 cevapsız GERÇEK bir istek varsa kapanış DEĞİL (tek mesaja değil tümüne bakılır)", () => {
    expect(lexicalClosingOnly(["Bir gece daha kalabilir miyiz?", "Teşekkürler!"])).toBe(false);
    expect(lexicalClosingOnly(["Teşekkürler!", "Wifi şifresi nedir?"])).toBe(false);
    expect(lexicalClosingOnly(["Anladım teşekkürler ama 12'de gelebilir miyiz?"])).toBe(false);
  });

  it("boş liste / yalnız boşluk kapanış sayılmaz (sessizlik için en az bir kapanış mesajı gerekir)", () => {
    expect(lexicalClosingOnly([])).toBe(false);
    expect(lexicalClosingOnly(["   "])).toBe(false);
    expect(lexicalClosingOnly(["", "Teşekkürler"])).toBe(true);
  });
});

describe("teşekkür/onay sinyali (anlam yolunun GEREKLİ koşulu, tek başına susturmaz)", () => {
  it("birçok dilde teşekkür / onay / veda / övgü + Türkçe büyük harf", () => {
    for (const t of [
      "Anladım",
      "Anladım, kolay gelsin",
      "TEŞEKKÜRLER",
      "İyi akşamlar",
      "Understood",
      "Muchas gracias",
      "Спасибо, понятно",
      "شكرا جزيلا",
      "👍",
      "Harika bir konaklamaydı",
    ]) {
      expect(hasAckSignal(t), t).toBe(true);
    }
  });

  it("🚨 P2: selam / soru habercisi / sorun bildirimi teşekkür sinyali taşımaz", () => {
    for (const t of ["Merhaba, bir sorum olacaktı", "Hi, are you there", "Merhaba", "Kapı kodu çalışmıyor", "Selam"]) {
      expect(hasAckSignal(t), t).toBe(false);
    }
  });
});

describe("anlam yolu — iki model 'yalnız teşekkür' + hiçbir sözcüksel itiraz yok", () => {
  const ok = { unanswered: ["Anladım, kolay gelsin"], hasPriorReply: true, understood: THANKS_ONLY, reply: CLOSING_REPLY };

  it("anlama katmanı yalnız selam/teşekkür + cevap modeli genel niyet ve düşük güven → kapanış", () => {
    expect(semanticClosingOnly(ok)).toBe(true);
  });

  it("🚨 P2: önceki cevap yoksa (ilk mesaj) hüküm YOK — ilk 'Merhaba'/'İyi akşamlar' selamdır", () => {
    expect(semanticClosingOnly({ ...ok, hasPriorReply: false })).toBe(false);
  });

  it("🚨 P2: soru işareti (Latin / tam genişlik / İspanyolca / Arapça) susturmayı engeller", () => {
    for (const q of ["Anladım, eczane var mı?", "Anladım？", "¿Entendido", "شكرا؟"]) {
      expect(semanticClosingOnly({ ...ok, unanswered: [q] }), q).toBe(false);
    }
  });

  it("🚨 P2: teşekkür/onay sinyali olmayan mesaj susturulmaz (iki model 'yalnız selam' dese de)", () => {
    expect(semanticClosingOnly({ ...ok, unanswered: ["Merhaba, bir sorum olacaktı"] })).toBe(false);
    // Birden çok mesajda HER biri sinyal taşımalı.
    expect(semanticClosingOnly({ ...ok, unanswered: ["Merhaba", "Anladım"] })).toBe(false);
  });

  it("🚨 P2: kelime ağı bir niyet görüyorsa susturulmaz (birleşim: hiçbir katmanın 'yok'u öbürünün 'var'ını silmez)", () => {
    expect(semanticClosingOnly({ ...ok, unanswered: ["Anladım, klima çalışmıyor"] })).toBe(false);
  });

  it("🚨 P2: anlama katmanı istek tavanına ulaştıysa (liste KESİLMİŞ olabilir) hüküm YOK", () => {
    const five = { ...THANKS_ONLY, requests: Array.from({ length: 5 }, () => THANKS_ONLY.requests[0]) } as MessageUnderstanding;
    expect(semanticClosingOnly({ ...ok, understood: five })).toBe(false);
    const four = { ...THANKS_ONLY, requests: Array.from({ length: 4 }, () => THANKS_ONLY.requests[0]) } as MessageUnderstanding;
    expect(semanticClosingOnly({ ...ok, understood: four })).toBe(true);
  });

  it("🚨 P2: cevap modeli eksik bilgi ya da bir eylem önerisi bildirdiyse susturulmaz", () => {
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, missingInfo: ["eczane"] } })).toBe(false);
    expect(semanticClosingOnly({ ...ok, reply: { ...CLOSING_REPLY, actionSuggestion: { type: "task" } } })).toBe(false);
  });

  it("anlama katmanı yoksa / koşmadıysa / istek bulmadıysa hüküm YOK", () => {
    expect(semanticClosingOnly({ ...ok, understood: null })).toBe(false);
    expect(semanticClosingOnly({ ...ok, understood: undefined })).toBe(false);
    expect(semanticClosingOnly({ ...ok, understood: { ...THANKS_ONLY, requests: [] } })).toBe(false);
  });

  it("anlama katmanı selamın yanında BAŞKA bir niyet ya da konaklama isteği görürse kapanış değil", () => {
    const withAsk = {
      ...THANKS_ONLY,
      requests: [...THANKS_ONLY.requests, { intent: "wifi", queryTr: "wifi şifresi", queryOriginal: "wifi" }],
    } as unknown as MessageUnderstanding;
    expect(semanticClosingOnly({ ...ok, understood: withAsk })).toBe(false);
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

describe("gizleme kapısı (`closingMayHide`) — yalnız açık iş olmadığı KESİNSE", () => {
  const g = (body: string): ClosingThreadMessage => ({ direction: "inbound", senderName: "Alex", authorType: "guest", body });
  const ai = (body: string, aiIntent: string | null = "wifi"): ClosingThreadMessage => ({
    direction: "outbound",
    senderName: "GuestOps AI",
    authorType: "ai",
    body,
    aiIntent,
  });
  const host = (body: string): ClosingThreadMessage => ({ direction: "outbound", senderName: "Ayşe", authorType: "host", body });
  const hide = (messages: ClosingThreadMessage[], openHostWork = false) => closingMayHide({ messages, openHostWork });

  it("düz bir cevaptan sonraki teşekkür gizlenebilir (yapay zekâ ya da ev sahibi cevabı)", () => {
    expect(hide([g("Wifi?"), ai("Şifre kılavuzda."), g("Teşekkürler")])).toBe(true);
    expect(hide([g("Wifi?"), host("Şifre kılavuzda."), g("Teşekkürler")])).toBe(true);
  });

  it("🚨 P1: ev sahibine bırakılmış mesaj varsa (karar kaydı) gizlenmez", () => {
    expect(hide([g("Otopark?"), ai("Hoş geldiniz!", null), g("Teşekkürler")], true)).toBe(false);
  });

  it("🚨 P1: son cevap yapay zekânın DEVİR (insan talebi) ya da BEKLETME (şikâyet) cevabıysa gizlenmez", () => {
    expect(hide([g("Ev sahibiyle konuşabilir miyim?"), ai("Mesajınız kaydedildi.", "human_request"), g("Tamam teşekkürler")])).toBe(false);
    expect(hide([g("Klima bozuk"), ai("Mesajınızı aldık.", "complaint"), g("Tamam")])).toBe(false);
  });

  it("🚨 P1: son cevap bir SORU ya da TEKLİF taşıyorsa ('Tamam olur' bir kabuldür) gizlenmez", () => {
    expect(hide([g("Havalimanı?"), host("Transfer ayarlayayım mı?"), g("Tamam olur")])).toBe(false);
    expect(hide([g("Geç çıkış?"), host("Geç çıkış 500 TL."), g("Harika olur")])).toBe(false);
    expect(hide([g("Late checkout?"), ai("Late checkout is available for a 20% fee."), g("Perfect")])).toBe(false);
  });

  it("cevap yoksa gizlenmez; sistem olayı / gövdesiz satır / eski QR işareti CEVAP sayılmaz", () => {
    expect(hide([g("Teşekkürler")])).toBe(false);
    const sys: ClosingThreadMessage = { direction: "outbound", senderName: "x", authorType: "system", systemEventType: "guest_chat_ai_resumed", body: "AI yeniden açıldı" };
    const legacyResume: ClosingThreadMessage = { direction: "outbound", senderName: "__lixus_ai_resumed__", body: "AI açıldı" };
    // Gövdesiz giden satır (yalnız fotoğraf / boş gövde): misafir bir METİN cevabı görmedi.
    const blank: ClosingThreadMessage = { direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: "   " };
    expect(hide([g("Teşekkürler"), sys])).toBe(false);
    expect(hide([g("Teşekkürler"), legacyResume])).toBe(false);
    expect(hide([g("Teşekkürler"), blank])).toBe(false);
    expect(hasPriorReply([g("Teşekkürler"), sys, legacyResume, blank])).toBe(false);
    // Yazarı eski ad kuralından çözülen cevap sayılır.
    expect(hasPriorReply([{ direction: "outbound", senderName: "GuestOps AI", body: "x" }])).toBe(true);
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

  it("🚨 'Sorunlu' ASLA gizlenmez; görünür kapanış / başka gerekçe / damgasız konuşma bu hâlde değil", () => {
    expect(isClosingHandled({ ...base, status: "problem" })).toBe(false);
    expect(isClosingHandled({ ...base, skippedReason: CLOSING_OPEN_REASON })).toBe(false);
    expect(isClosingHandled({ ...base, skippedReason: "low_confidence_or_risky" })).toBe(false);
    expect(isClosingHandled({ ...base, skippedReason: null })).toBe(false);
    expect(isClosingHandled({ ...base, autoReplyAttemptedAt: null })).toBe(false);
  });
});
