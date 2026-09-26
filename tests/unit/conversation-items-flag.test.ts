import { describe, it, expect, afterEach, vi } from "vitest";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ bayrağı: yalnız tam "1" + anlama katmanı açık (öğeler onun istek listesine dayanır). Katman kapalıyken
// öğe kipi uyarı geçişinde "Sorunlu"yu kaldırıp cevap geçişinde hiç öğe kuramazdı → bayrak AÇIK SAYILMAZ.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("conversationItemsEnabled", () => {
  it("bayrak + anlama katmanı + anahtar → açık", () => {
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "k");
    expect(conversationItemsEnabled()).toBe(true);
  });
  it("🚨 anlama katmanı kapalı ya da anahtarsız → bayrak açık yazılsa da KAPALI", () => {
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    vi.stubEnv("OPENAI_API_KEY", "k");
    expect(conversationItemsEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_SEMANTIC_API_KEY", "");
    expect(conversationItemsEnabled()).toBe(false);
  });
  it("yalnız tam '1' açar", () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "k");
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", v);
      expect([v, conversationItemsEnabled()]).toEqual([v, false]);
    }
  });
});
