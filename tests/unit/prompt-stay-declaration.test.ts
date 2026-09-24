import { describe, it, expect } from "vitest";
import { REPLY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { STAY_CHANGE_KINDS, REPLY_STANCES, parseStayChangeDeclaration } from "@/lib/ai/semantic/stay-change";
import { detectAvailabilityClaim, hasAvailabilityDeferral } from "@/lib/ai/availability-claims";

// ---------------------------------------------------------------------------
// ŞEMA BEYANI İSTEMDE (09-24): cevap modeli `stayChangeAsked` + `replyStance` alanlarını üretir.
// Model ÖRNEĞİ taklit eder → 24 few-shot'ın HER BİRİ alanı geçerli değerle taşımalı ve öğrettiği
// davranış ürünün kendi kapısından geçmeli (doğru cevap bloklanırsa otomasyon ölür).
// ---------------------------------------------------------------------------

type Row = { intent: string; reply: string; stayChangeAsked?: unknown; replyStance?: unknown };

function exampleRows(): Row[] {
  const rows: Row[] = [];
  for (const raw of REPLY_SYSTEM_PROMPT.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith('{"intent"')) continue;
    rows.push(JSON.parse(line.endsWith("`;") ? line.slice(0, -2) : line));
  }
  return rows;
}

describe("istem çıktı biçimi", () => {
  it("iki alan çıktı şemasında ve kapalı listeleri koddaki kümelerle BİREBİR", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain(`"stayChangeAsked": "<${STAY_CHANGE_KINDS.join("|")}>"`);
    expect(REPLY_SYSTEM_PROMPT).toContain(`"replyStance": "<${REPLY_STANCES.join("|")}>"`);
  });

  it("son kontrol listesinde erteleme maddesi var; 'etiketi değil cevabı düzelt' kuralı yazılı", () => {
    const flat = REPLY_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain("13. stayChangeAsked none değilse reply kararı ev sahibine bıraktı mı");
    expect(flat).toContain("CEVABI düzelt, etiketi değil");
  });
});

describe("few-shot örnekleri — şema + davranış tutarlılığı", () => {
  const rows = exampleRows();

  it("çapa: 24 örnek bulundu", () => {
    expect(rows).toHaveLength(24);
  });

  it("HER örnek iki alanı kapalı kümeden taşır (eksik alan modeli alanı atlamaya alıştırır)", () => {
    for (const r of rows) {
      const d = parseStayChangeDeclaration(r.stayChangeAsked, r.replyStance);
      expect(d, r.reply).not.toBeNull();
      expect(d!.asked, r.reply).not.toBe("unknown");
      expect(d!.stance, r.reply).not.toBe("unknown");
    }
  });

  it("erken giriş / geç çıkış örnekleri `defers` öğretir ve 'asked' türü niyetle uyumlu", () => {
    for (const r of rows.filter((x) => x.intent === "early_checkin" || x.intent === "late_checkout")) {
      expect(r.replyStance, r.reply).toBe("defers");
      expect(r.stayChangeAsked, r.reply).toBe(r.intent);
    }
  });

  it("🚨 hiçbir örnek izin/takvim duruşu öğretmez ve öğretilen cevap kapının iddia dedektörüne takılmaz", () => {
    for (const r of rows) {
      expect(["grants", "states_calendar"]).not.toContain(r.replyStance);
      expect(detectAvailabilityClaim(r.reply), r.reply).toBeNull();
    }
  });

  it("🚨 `defers` öğreten her örneğin cevabı deterministik erteleme dedektöründen GEÇER (doğru cevap bloklanmasın)", () => {
    const deferring = rows.filter((r) => r.replyStance === "defers");
    expect(deferring.length).toBeGreaterThanOrEqual(5);
    for (const r of deferring) expect(hasAvailabilityDeferral(r.reply), r.reply).toBe(true);
  });

  it("istek taşıyan her örnek (asked ≠ none) `defers` duruşunda", () => {
    for (const r of rows.filter((x) => x.stayChangeAsked !== "none")) expect(r.replyStance, r.reply).toBe("defers");
  });
});
