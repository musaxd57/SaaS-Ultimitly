import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Kurucu 10-23 A: değer KONUSUNA bağlı olmalı (havuz sorusu → havuzun kapanış bilgisi → 20:00); saunanın 22:00'ı havuza dayanak olamaz;
// koşul ve olumsuzluk korunur; farklı dil, olumsuz ve koşullu cümlelerle sınanır.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { checkAnswerBinding } from "@/lib/ai/answer-binding";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

const KB = "Havuz her gün 20:00'de, sauna 22:00'de kapanır. Hafta sonu havuz 23:00'e kadar açıktır. Evcil hayvan kabul edilmez.";
const need = (q: string[]) => ({ needTerms: needTerms(q), needTopics: q.flatMap((x) => topicsWithSymptomsOf(x)) });
const POOL = need(["havuz kaçta kapanıyor", "when does the pool close"]);
const SAUNA = need(["sauna kaçta kapanıyor"]);
const PETS = need(["evcil hayvan kabul ediliyor mu", "are pets allowed"]);

const check = (part: string, evidence: string, n = POOL) => checkAnswerBinding({ part, evidence, sourceText: KB, ...n });

describe("değer ↔ konu (havuz / sauna)", () => {
  it("🚨 havuz sorusuna saunanın 22:00'ı: TUTULUR (değer başka konuya bağlı)", () => {
    const r = check("Havuz 22:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.");
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("value_bound_elsewhere");
  });

  it("doğru eşleşme gider: havuz 20:00 · sauna 22:00 (Türkçe ve İngilizce parça)", () => {
    expect(check("Havuz her gün 20:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.").ok).toBe(true);
    expect(check("The pool closes at 20:00 every day.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.").ok).toBe(true);
    expect(check("Sauna 22:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.", SAUNA).ok).toBe(true);
  });

  it("alıntıda olmayan değer (uydurma saat) tutulur; alıntı kalemde yoksa tutulur", () => {
    expect(check("Havuz 21:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.").issues).toContain("value_not_in_evidence");
    expect(check("Havuz 20:00'de kapanıyor.", "Havuz 20:00'de kapanır, jakuzi de.").issues).toContain("evidence_not_in_source");
    expect(check("Havuz 20:00'de kapanıyor.", "").issues).toEqual(["evidence_missing"]);
  });

  it("konusu bilinmeyen ihtiyaç doğrulanamaz → tutulur", () => {
    expect(checkAnswerBinding({ part: "20:00.", evidence: "Havuz her gün 20:00'de, sauna 22:00'de kapanır.", sourceText: KB, needTerms: [], needTopics: [] }).issues).toEqual([
      "subject_unknown",
    ]);
  });
});

describe("koşul korunur (dil fark etmez)", () => {
  it("🚨 'hafta sonu' koşulu düşerse tutulur; korunursa (TR / EN) gider", () => {
    const ev = "Hafta sonu havuz 23:00'e kadar açıktır.";
    expect(check("Havuz 23:00'e kadar açık.", ev).issues).toContain("condition_dropped");
    expect(check("Hafta sonu havuz 23:00'e kadar açık.", ev).ok).toBe(true);
    expect(check("On weekends the pool is open until 23:00.", ev).ok).toBe(true);
  });
});

describe("olumsuzluk korunur", () => {
  it("🚨 'kabul edilmez' → 'kabul ediliyor' tutulur; olumsuz her dilde gider", () => {
    const ev = "Evcil hayvan kabul edilmez.";
    expect(check("Evcil hayvan kabul ediliyor.", ev, PETS).issues).toContain("polarity_mismatch");
    expect(check("Evcil hayvan kabul edilmiyor.", ev, PETS).ok).toBe(true);
    expect(check("Pets are not allowed.", ev, PETS).ok).toBe(true);
    expect(check("Haustiere sind nicht erlaubt.", ev, PETS).ok).toBe(true);
  });

  it("konusu alıntıda hiç geçmeyen değersiz parça tutulur", () => {
    expect(check("Evcil hayvan kabul edilmiyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.", PETS).issues).toContain("subject_missing");
  });
});

describe("sıkı konu eşleşmesi", () => {
  it("'kapı' sorusu 'kapıcı' satırına dayanamaz", () => {
    const src = "Kapıcı 09:00'da gelir. Kapı şifresi gönderilmez.";
    const door = need(["kapı kaçta açılıyor"]);
    const r = checkAnswerBinding({ part: "Kapı 09:00'da açılıyor.", evidence: "Kapıcı 09:00'da gelir.", sourceText: src, ...door });
    expect(r.ok).toBe(false);
  });
});

describe("aralık, konusuz değişke, söz dizimi", () => {
  const BR = "Kahvaltı 08:00–10:30, hafta sonu 11:00'e kadar.";
  const BREAKFAST = need(["kahvaltı kaça kadar"]);
  const b = (part: string) => checkAnswerBinding({ part, evidence: BR, sourceText: BR, ...BREAKFAST });

  it("aralık tek değerdir: 'Havuz yalnız yazın açıktır, 09:00-20:00' → koşul (yalnız + yaz) korunmalı", () => {
    const src = "Havuz yalnız yazın açıktır, 09:00-20:00.";
    const pool = need(["havuz kaçta açık"]);
    const r = (part: string) => checkAnswerBinding({ part, evidence: src, sourceText: src, ...pool });
    expect(r("Havuz 09:00-20:00 arası açık.").issues).toEqual(["condition_dropped"]);
    expect(r("Havuz yalnız yaz aylarında 09:00-20:00 arası açık.").ok).toBe(true);
  });

  it("aralığın ardında başka konu varsa aralık yine kendi konusuna bağlı ('Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açık')", () => {
    const src = "Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açık.";
    expect(checkAnswerBinding({ part: "Havuz 09:00-20:00 arası açık.", evidence: src, sourceText: src, ...POOL }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "Sauna 09:00-20:00 arası açık.", evidence: src, sourceText: src, ...SAUNA }).issues).toEqual(["value_bound_elsewhere"]);
  });

  it("konusuz hafta sonu değişkesi önceki konuyu devralır, koşulu kendine aittir", () => {
    expect(b("Hafta sonu kahvaltı 11:00'e kadar.").ok).toBe(true);
    expect(b("Kahvaltı 11:00'e kadar.").issues).toEqual(["condition_dropped"]);
    expect(b("Kahvaltı 08:00-10:30 arası.").ok).toBe(true);
  });

  it("🚨 konu değerden SONRA gelirse devralma yok: 'Havuz 20:00'de, 22:00'de sauna kapanır'", () => {
    const src = "Havuz 20:00'de, 22:00'de sauna kapanır.";
    expect(checkAnswerBinding({ part: "Havuz 22:00'de kapanıyor.", evidence: src, sourceText: src, ...POOL }).issues).toEqual(["value_bound_elsewhere"]);
    expect(checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor.", evidence: src, sourceText: src, ...POOL }).ok).toBe(true);
  });

  it("İngilizce sonradan gelen koşul: hafta içi / hafta sonu yer değiştiremez", () => {
    const src = "Breakfast is served 08:00-10:00 on weekdays and 09:00-11:00 on weekends.";
    const bf = need(["when is breakfast"]);
    const r = (part: string) => checkAnswerBinding({ part, evidence: src, sourceText: src, ...bf });
    expect(r("On weekends breakfast is 09:00-11:00.").ok).toBe(true);
    expect(r("On weekdays breakfast is 09:00-11:00.").issues).toEqual(["condition_dropped"]);
    expect(r("Breakfast is 09:00-11:00.").issues).toEqual(["condition_dropped"]);
  });

  it("çekimli gün adı koşuldur; 'semt pazarı' gün adı değildir", () => {
    const src = "Temizlik cumartesileri yapılır.";
    const cl = need(["temizlik ne zaman", "when is cleaning"]);
    expect(checkAnswerBinding({ part: "Temizlik yapılıyor.", evidence: src, sourceText: src, ...cl }).issues).toEqual(["condition_dropped"]);
    expect(checkAnswerBinding({ part: "Cleaning is done on Saturdays.", evidence: src, sourceText: src, ...cl }).ok).toBe(true);
    const mk = "Semt pazarı 500 m uzakta, salı günleri kurulur.";
    const market = need(["pazar nerede", "where is the market"]);
    expect(checkAnswerBinding({ part: "The local market is 500 m away.", evidence: mk, sourceText: mk, ...market }).ok).toBe(true);
  });

  it("İngilizce kesmeli olumsuzluk ('can't') okunur", () => {
    const src = "Havuz 21:00'den sonra kullanılamaz.";
    const pool = need(["havuz", "pool"]);
    expect(checkAnswerBinding({ part: "The pool can't be used after 21:00.", evidence: src, sourceText: src, ...pool }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "The pool can be used after 21:00.", evidence: src, sourceText: src, ...pool }).issues).toEqual(["polarity_mismatch"]);
  });

  it("'talep üzerine' düşerse tutulur; olumsuz cümle yokluğu doğru söyler", () => {
    const src = "Bisiklet talep üzerine 200 TL'ye kiralanır. Sauna bulunmuyor.";
    const bike = need(["bisiklet kiralayabilir miyim", "can I rent a bike"]);
    expect(checkAnswerBinding({ part: "Bisiklet 200 TL'ye kiralanabilir.", evidence: "Bisiklet talep üzerine 200 TL'ye kiralanır.", sourceText: src, ...bike }).issues).toEqual([
      "condition_dropped",
    ]);
    expect(
      checkAnswerBinding({ part: "Bikes can be rented for 200 TL on request.", evidence: "Bisiklet talep üzerine 200 TL'ye kiralanır.", sourceText: src, ...bike }).ok,
    ).toBe(true);
    const sauna = need(["sauna var mı", "is there a sauna"]);
    expect(checkAnswerBinding({ part: "There is no sauna.", evidence: "Sauna bulunmuyor.", sourceText: src, ...sauna }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "Evet, sauna var.", evidence: "Sauna bulunmuyor.", sourceText: src, ...sauna }).issues).toEqual(["polarity_mismatch"]);
  });

  it("değerin içindeki nokta cümle bölmez ('3. katta'); 8 pm = 20:00", () => {
    const park = need(["otopark nerede"]);
    const neg = "Otopark 3. katta değil, 2. katta.";
    expect(checkAnswerBinding({ part: "Otopark 3. katta.", evidence: neg, sourceText: neg, ...park }).issues).toEqual(["polarity_mismatch"]);
    expect(checkAnswerBinding({ part: "Otopark 2. katta.", evidence: neg, sourceText: neg, ...park }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "Otopark 3. katta.", evidence: "Otopark 3. katta.", sourceText: "Otopark 3. katta.", ...park }).ok).toBe(true);
    const src = "Pool closes at 8 pm, sauna at 10 pm.";
    expect(checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor.", evidence: src, sourceText: src, ...POOL }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "Havuz 22:00'de kapanıyor.", evidence: src, sourceText: src, ...POOL }).issues).toEqual(["value_bound_elsewhere"]);
  });

  it("bilinen sınır (tutma yönü): 'ücretsizdir' ↔ 'ücretli değil' farklı olumluluk sayılır", () => {
    const src = "Otopark ücretsizdir.";
    expect(checkAnswerBinding({ part: "Otopark ücretli değil.", evidence: src, sourceText: src, ...need(["otopark ücretli mi"]) }).issues).toEqual(["polarity_mismatch"]);
  });
});
