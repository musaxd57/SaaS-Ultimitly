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
    const ev = "Havuz her gün 20:00'de, sauna 22:00'de kapanır.";
    expect(checkAnswerBinding({ part: "Havuz her gün 20:00'de kapanıyor.", evidence: ev, sourceText: ev, ...POOL }).ok).toBe(true);
    expect(checkAnswerBinding({ part: "The pool closes at 20:00 every day.", evidence: ev, sourceText: ev, ...POOL }).ok).toBe(true);
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
    // Koşulsuz değer + kalemde koşullu değişke → değişke de anılmalı.
    expect(b("Kahvaltı 08:00-10:30 arası.").issues).toEqual(["variant_omitted"]);
    expect(b("Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar.").ok).toBe(true);
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
    // Değer başına koşul (E ölçümü 10-23): hafta sonu değeri hafta içine bağlanmış → ayrıca "condition_added".
    expect(r("On weekdays breakfast is 09:00-11:00.").issues).toEqual(["condition_dropped", "condition_added"]);
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

// ─── Haiku 10-23 incelemesi: yanlış GEÇİŞ sınıfları (her biri önce bu kodda geçiyordu) ──────────────────────────────────────────
describe("Haiku 10-23 yanlış geçişler", () => {
  const one = (src: string, part: string, q: string[], evidence = src) => checkAnswerBinding({ part, evidence, sourceText: src, ...need(q) });

  it("1. çift olumsuz birbirini götürür: 'kapalıdır' ↔ 'kapalı değildir', 'yasaktır' ↔ 'yasak değil', 'prohibited' ↔ 'not prohibited'", () => {
    expect(one("Havuz kapalıdır.", "Havuz kapalı değildir.", ["havuz açık mı"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Evcil hayvan yasaktır.", "Evcil hayvan yasak değil.", ["evcil hayvan"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Pets are prohibited.", "Pets are not prohibited.", ["pets"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Havuz kapalı değildir.", "Havuz açık.", ["havuz açık mı"]).ok).toBe(true);
  });

  it("2. yön: açılır ↔ kapanır, -e kadar ↔ -den itibaren, -den sonra ↔ -den önce", () => {
    expect(one("Havuz 09:00'da açılır.", "Havuz 09:00'da kapanır.", ["havuz"]).issues).toEqual(["direction_mismatch"]);
    expect(one("Havuz 20:00'ye kadar açık.", "Havuz 20:00'den itibaren açık.", ["havuz"]).issues).toEqual(["direction_mismatch"]);
    expect(one("Giriş 14:00'ten sonra.", "Giriş 14:00'ten önce.", ["giriş"]).issues).toEqual(["direction_mismatch"]);
    expect(one("Havuz 20:00'ye kadar açık.", "The pool is open until 20:00.", ["havuz", "pool"]).ok).toBe(true);
    expect(one("Havuz 09:00'da açılır, 20:00'de kapanır.", "Havuz 20:00'de açılır.", ["havuz"]).issues).toEqual(["direction_mismatch"]);
  });

  it("2b. 'KDV dahil' ↔ 'KDV hariç'", () => {
    expect(one("Kahvaltı 150 TL, KDV dahil.", "Kahvaltı 150 TL, KDV hariç.", ["kahvaltı ücreti"]).issues).toContain("condition_dropped");
    expect(one("Kahvaltı 150 TL, KDV dahil.", "Breakfast is 150 TL, VAT included.", ["kahvaltı ücreti", "breakfast price"]).ok).toBe(true);
  });

  it("3. değersiz parça karışık cümlede kendi yan cümlesini okur ('Havuz açıktır, sauna kapalıdır'); yüklemsiz konu bütün cümleyi okur", () => {
    expect(one("Havuz açıktır, sauna kapalıdır.", "Havuz kapalıdır.", ["havuz açık mı"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Havuz açıktır, sauna kapalıdır.", "Havuz açık.", ["havuz açık mı"]).ok).toBe(true);
    expect(one("Otopark var, asansör yok.", "Otopark yok.", ["otopark var mı"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Evcil hayvanlar, küçük köpekler hariç, kabul edilmez.", "Evcil hayvan kabul ediliyor.", ["evcil hayvan"]).issues).toContain("polarity_mismatch");
    expect(one("Evcil hayvanlar, küçük köpekler hariç, kabul edilmez.", "Küçük köpekler hariç evcil hayvan kabul edilmiyor.", ["evcil hayvan"]).ok).toBe(true);
  });

  it("4a. kendi yan cümlesinde başka konu varsa virgül geçilmez ('Havuz temizliği nedeniyle, sauna 22:00'de kapanır')", () => {
    expect(one("Havuz temizliği nedeniyle, sauna 22:00'de kapanır.", "Havuz 22:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toEqual(["value_bound_elsewhere"]);
    expect(one("Havuz, 20:00'de kapanır.", "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("4b. niteleyen konum konu sayılmaz ('havuzun yanındaki bar', 'the bar next to the pool')", () => {
    expect(one("Havuzun yanındaki bar 20:00'de kapanır.", "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one("The bar next to the pool closes at 20:00.", "The pool closes at 20:00.", ["when does the pool close"]).ok).toBe(false);
    expect(one("Drinks are served by the pool until 20:00.", "The pool is open until 20:00.", ["when does the pool close"]).ok).toBe(false);
  });

  it("4c. nitelik sözcüğü konu değil ('havuz temizliği' ← 'Sauna temizliği 22:00'); konu + nitelik birlikte olunca geçer", () => {
    expect(one("Sauna temizliği 22:00'de.", "Havuz temizliği 22:00'de.", ["havuz temizliği ne zaman"]).ok).toBe(false);
    expect(one("Havuz temizliği her sabah 08:00'de yapılır.", "Havuz temizliği her sabah 08:00'de.", ["havuz temizliği ne zaman"]).ok).toBe(true);
    expect(one("Otopark ücretsizdir, 7/24 açıktır.", "Otopark ücretsiz.", ["otopark ücretli mi"]).ok).toBe(true);
  });

  it("5. konusuz yan cümledeki koşul: 'pazar hariç', 'Yalnız yazın, …'", () => {
    expect(one("Havuz 09:00-20:00 arası açıktır, pazar hariç.", "Havuz 09:00-20:00 arası açık.", ["havuz kaçta açık"]).issues).toContain("condition_dropped");
    expect(one("Havuz 09:00-20:00 arası açıktır, pazar hariç.", "Havuz pazar hariç 09:00-20:00 arası açık.", ["havuz kaçta açık"]).ok).toBe(true);
    expect(one("Yalnız yazın, havuz 09:00-20:00 açıktır.", "Havuz 09:00-20:00 açık.", ["havuz kaçta açık"]).issues).toContain("condition_dropped");
  });

  it("6. devralınan yan cümlenin koşulu ('Havuz hafta sonları 09:00'da açılır ve 20:00'de kapanır'); kendi gün koşulu ezer", () => {
    expect(one("Havuz hafta sonları 09:00'da açılır ve 20:00'de kapanır.", "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toContain("condition_dropped");
    expect(one("Havuz hafta sonları 09:00'da açılır ve 20:00'de kapanır.", "Hafta sonları havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("7. parça kalemde olmayan gün / mevsim koşulu uyduramaz", () => {
    expect(one("Havuz 09:00-20:00 arası açık.", "Havuz hafta sonu 09:00-20:00 arası açık.", ["havuz kaçta açık"]).issues).toEqual(["condition_added"]);
  });

  it("8. alıntı koşullu değişkeyi gizleyemez (kalemde 'Hafta sonu 23:00'e kadar açık')", () => {
    const src = "Havuz 20:00'de kapanır; hafta sonları 22:00'ye kadar açıktır.";
    expect(one(src, "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"], "Havuz 20:00'de kapanır").issues).toEqual(["variant_omitted"]);
    const src2 = "Havuz 20:00'de kapanır. Hafta sonu 23:00'e kadar.";
    expect(one(src2, "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"], "Havuz 20:00'de kapanır.").issues).toEqual(["variant_omitted"]);
    expect(one(src, "Havuz 20:00'de kapanır, hafta sonları 22:00'ye kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
    // Konusuz cümle önceki cümlenin konusunu devralır; başka içerik sözcüğü taşıyan cümle devralmaz.
    expect(one("Havuz 20:00'de kapanır. 22:00'de sauna kapanır.", "Havuz 22:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toEqual(["value_bound_elsewhere"]);
  });

  it("9. sözlük: 'hafta sonlarında', 'haftasonu', 'yaz aylarında', 'Wochenenden', 'rezervasyon zorunludur', 'außer'", () => {
    expect(one("Havuz hafta sonlarında 09:00'da açılır.", "Havuz 09:00'da açılır.", ["havuz"]).issues).toContain("condition_dropped");
    expect(one("Havuz haftasonu 09:00'da açılır.", "Havuz 09:00'da açılır.", ["havuz"]).issues).toContain("condition_dropped");
    expect(one("Havuz yaz aylarında 09:00'da açılır.", "Havuz 09:00'da açılır.", ["havuz"]).issues).toContain("condition_dropped");
    expect(one("Der Pool öffnet an Wochenenden um 09:00.", "Der Pool öffnet um 09:00.", ["pool"]).issues).toContain("condition_dropped");
    expect(one("Masaj 09:00-20:00 arasında, rezervasyon zorunludur.", "Masaj 09:00-20:00 arasında.", ["masaj"]).issues).toContain("condition_dropped");
    expect(one("Pool täglich 09:00-20:00, außer Montag.", "Pool täglich 09:00-20:00.", ["pool"]).issues).toContain("condition_dropped");
  });

  it("10. olumsuz fiil: 'kiralamıyoruz', 'giremezsiniz', 'etmem'; 'unavailable', 'gesperrt'", () => {
    expect(one("Şezlong kiralamıyoruz.", "Şezlong kiralıyoruz.", ["şezlong"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Havuza 22:00'den sonra giremezsiniz.", "Havuza 22:00'den sonra girebilirsiniz.", ["havuz"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Sauna is unavailable.", "Sauna is available.", ["sauna"]).issues).toEqual(["polarity_mismatch"]);
    expect(one("Die Sauna ist gesperrt.", "Die Sauna ist offen.", ["sauna"]).issues).toEqual(["polarity_mismatch"]);
  });

  it("11. belirsiz saat ('saat 9') kesin saate dayanak olmaz; belirsizliği taşıyan parça olur", () => {
    expect(one("Havuz saat 9'da kapanır.", "Havuz 21:00'de kapanır.", ["havuz"]).issues).toEqual(["value_not_in_evidence"]);
    expect(one("Havuz saat 9'da kapanır.", "Havuz saat 9'da kapanır.", ["havuz"]).ok).toBe(true);
  });
});

describe("Haiku 10-23 F3: alıntının taşımadığı içerik sözcüğü (aynı dilde)", () => {
  const one = (src: string, part: string, q: string[], evidence = src) => checkAnswerBinding({ part, evidence, sourceText: src, ...need(q) });

  it("🚨 've ücretsizdir' alıntıda yok → gitmez; 'ücretli' ↔ 'ücretsiz' aynı kök sayılmaz", () => {
    // Opus 10-23 ücret kutbu: kalemde "ücretsiz" yokken ayrıca uydurma koşul.
    expect(one("Havuz 09:00-20:00 arası açıktır.", "Havuz 09:00-20:00 arası açık ve ücretsizdir.", ["havuz kaçta açık"]).issues).toEqual(["condition_added", "unsupported_content"]);
    expect(one("Otopark binanın altındadır ve ücretsizdir.", "Otopark binanın altında ve ücretlidir.", ["otopark"]).issues).toContain("unsupported_content");
    // Bilinen sınır: dili kestirilemeyen çok kısa parça ("Otopark ücretlidir.") kıyaslanmaz — okuyucunun kanıt şartı.
  });

  it("çekim / açıklama / nezaket farkı içerik sayılmaz", () => {
    expect(one("Çamaşır makinesi banyodadır.", "Merhaba, çamaşır makinesi banyoda bulunuyor.", ["çamaşır makinesi var mı"]).ok).toBe(true);
    expect(one("Havuz her gün 20:00'de kapanır.", "Havuz her gün 20:00'de kapanıyor.", ["havuz"]).ok).toBe(true);
  });

  it("bilinen sınır: çeviride sözcük kıyası yapılmaz (kıdemli okuyucunun kanıt şartı)", () => {
    expect(one("Havuz 09:00-20:00 arası açıktır.", "The pool is open 09:00-20:00.", ["havuz", "pool"]).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kurucu E ölçümü (10-23) — doğru cevabın YANLIŞ reddi: ham parçalar ölçerde okundu, her sınıf burada; her birinin TEHLİKELİ karşılığı
// (yanlış değeri gönderen hâli) ayrıca TUTULUR.
// ---------------------------------------------------------------------------
describe("E ölçümü 10-23: doğru cevabın yanlış reddi + tehlikeli karşılığı", () => {
  const one = (src: string, part: string, q: string[], evidence = src) => checkAnswerBinding({ part, evidence, sourceText: src, ...need(q) });
  const PARK = "Otopark ücretsizdir; binanın -2. katında, 12 numaralı yer size ayrılmıştır.";
  const POOLKB = "Havuz her gün 20:00'de, sauna 22:00'de kapanır. Hafta sonu havuz 23:00'e kadar açıktır.";
  const BREAKFAST = "Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar zemin kattaki kafede verilir.";

  it("1. ';' sonrası yalnız yer sözcüklü devam cümlesi konuyu taşır (kat, numaralı yer, size ayrılmış)", () => {
    expect(one(PARK, "Otopark ücretsizdir; binanın -2. katındaki 12 numaralı yer size ayrılmıştır.", ["otopark ücretli mi"]).ok).toBe(true);
  });

  it("🚨 1-karşı. devam cümlesi başka bir tesis adı taşıyorsa devralma YOK (sauna / kafe / spa)", () => {
    expect(one("Havuz 20:00'de kapanır; sauna 22:00'de kapanır.", "Havuz 22:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toContain("value_bound_elsewhere");
    expect(one("Havuz 20:00'de kapanır; kafe 23:00'e kadar açıktır.", "Havuz 23:00'e kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one("Havuz zemin kattadır; spa 3. kattadır.", "Havuz 3. kattadır.", ["havuz hangi katta"]).ok).toBe(false);
    // "Ayrılış" (çıkış) bir konudur; yer sözcüğü sayılmaz.
    expect(one("Giriş 14:00'tedir. Ayrılış 11:00'dir.", "Giriş 11:00'dir.", ["giriş saati"]).ok).toBe(false);
  });

  it("2. kodun sonundaki '!' cümleyi de bitirir: ardındaki cümle konuyu çalmaz (Wi-Fi şifresi)", () => {
    const src = "Wi-Fi: Ağ adı: Lale-5G, şifre: Lale2025! Modem salondaki TV ünitesinin altındadır.";
    expect(one(src, "Wi-Fi şifresi Lale2025!.", ["wifi şifresi"]).ok).toBe(true);
  });

  it("🚨 2-karşı. '!' ile biten koddan sonraki cümlenin değeri yine kendi konusuna bağlı (kapı kodu Wi-Fi şifresi olmaz)", () => {
    const src = "Wi-Fi şifresi: Lale2025! Kapı kodu: 4455.";
    expect(one(src, "Wi-Fi şifresi 4455.", ["wifi şifresi"]).ok).toBe(false);
  });

  it("3. değerden sonraki yer bildiren (-de / -deki) ve yüklem sözcükleri yeni konu değildir ('zemin kattaki kafede verilir')", () => {
    expect(one(BREAKFAST, "Kahvaltı hafta sonu 11:00'e kadar veriliyor.", ["kahvaltı kaça kadar"]).ok).toBe(true);
  });

  it("🚨 3-karşı. değerden sonra YALIN bir tesis adı gelirse o değer onundur ('11:00'e kadar kafe açıktır')", () => {
    const src = "Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar kafe açıktır.";
    expect(one(src, "Kahvaltı hafta sonu 11:00'e kadar veriliyor.", ["kahvaltı kaça kadar"]).ok).toBe(false);
  });

  it("4. hafta sonu istisnası olan kalemde genel değeri 'hafta içi' diye vermek doğru (tümleyen); kahvaltı ve havuz", () => {
    expect(one(BREAKFAST, "Kahvaltı hafta içi 10:30'a kadar, hafta sonu 11:00'e kadar veriliyor.", ["kahvaltı kaça kadar"]).ok).toBe(true);
    expect(one(POOLKB, "Havuz hafta içi 20:00'de kapanıyor; hafta sonu 23:00'e kadar açık.", ["havuz 22:00'ye kadar açık mı"]).ok).toBe(true);
  });

  it("🚨 4-karşı. tümleyen ters bağlanamaz (hafta içi 23:00 / hafta sonu 20:00); istisnasız kalemde 'hafta içi' uydurulamaz", () => {
    expect(one(POOLKB, "Havuz hafta içi 23:00'e kadar açık; hafta sonu 20:00'de kapanıyor.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one(BREAKFAST, "Kahvaltı hafta içi 11:00'e kadar, hafta sonu 10:30'a kadar veriliyor.", ["kahvaltı kaça kadar"]).ok).toBe(false);
    expect(one("Havuz her gün 20:00'de kapanır.", "Havuz hafta içi 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toContain("condition_added");
  });

  it("5. misafir bir GÜNÜ sorduysa o gün hafta sonunun / genel kuralın özelidir (İngilizce parça, Türkçe kalem)", () => {
    const q = ["havuz cumartesi kaçta kapanıyor", "When does the pool close on Saturday?"];
    expect(one(POOLKB, "The pool closes at 23:00 on Saturdays.", q, "Hafta sonu havuz 23:00'e kadar açıktır.").ok).toBe(true);
    expect(one("Havuz her gün 20:00'de kapanır.", "Havuz cumartesi 20:00'de kapanır.", ["havuz cumartesi kaçta kapanıyor"]).ok).toBe(true);
  });

  it("5b. 'cumartesi' hafta sonu değişkesini ANMIŞ sayılır: genel değer + cumartesi değeri birlikte doğru", () => {
    expect(one(POOLKB, "Havuz her gün 20:00'de kapanır; cumartesi 23:00'e kadar açık.", ["havuz cumartesi kaçta kapanıyor"]).ok).toBe(true);
  });

  it("🚨 5-karşı. sorulmayan gün uydurulamaz; cumartesiye genel değer verilemez (kalemde hafta sonu değişkesi var); hafta içi değeri cumartesiye taşınamaz", () => {
    expect(one("Havuz her gün 20:00'de kapanır.", "Havuz cumartesi 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).issues).toContain("condition_added");
    expect(one(POOLKB, "Havuz cumartesi 20:00'de kapanır.", ["havuz cumartesi kaçta kapanıyor"]).ok).toBe(false);
    expect(one("Havuz hafta içi 20:00'de kapanır.", "Havuz cumartesi 20:00'de kapanır.", ["havuz cumartesi kaçta kapanıyor"]).ok).toBe(false);
  });

  it("6. bilinen sınır (Haiku 10-23): çatı değişimi içerik sayılır — 'atılır' → 'atabilirsiniz' doğru olsa da 'Kapı 08:00'de açılır' → 'açabilirsiniz' anlamı değiştirir; ikisi de TUTULUR", () => {
    expect(one("Çöpler bina girişinin sağındaki konteynere atılır.", "Çöpleri bina girişinin sağındaki konteynere atabilirsiniz.", ["çöp nereye atılır"]).issues).toContain("unsupported_content");
    expect(one("Kapı 08:00'de açılır.", "Kapıyı 08:00'de açabilirsiniz.", ["kapı kaçta açılıyor"]).ok).toBe(false);
  });

  it("🚨 6-karşı. başka yön içerik sayılır ('sağındaki' ≠ 'solundaki')", () => {
    const src = "Çöpler bina girişinin sağındaki konteynere atılır.";
    expect(one(src, "Çöpler bina girişinin solundaki konteynere atılır.", ["çöp nereye atılır"]).issues).toContain("unsupported_content");
  });

  it("7. parçadaki '№12' sayı 12'dir (Rusça parça, Türkçe kalem); başka numara tutulur; bilinen sınır: Rusça kat sözcüğü ('на уровне -2') okunmaz", () => {
    const q = ["otopark var mı", "Есть ли парковка?"];
    expect(one(PARK, "Парковка бесплатная, за Вами закреплено место №12.", q).ok).toBe(true);
    expect(one(PARK, "Парковка бесплатная, место №13.", q).issues).toContain("value_not_in_evidence");
    expect(one(PARK, "Парковка бесплатная, на уровне -2 здания.", q).ok).toBe(false);
  });
});

describe("Haiku 10-23 (gevşetmelerin yanlış kabulleri) — hepsi TUTULUR", () => {
  const one = (src: string, part: string, q: string[], evidence = src) => checkAnswerBinding({ part, evidence, sourceText: src, ...need(q) });

  it("🚨 yer sözcüklü devam cümlesi, önceki cümlede aynı türden değer varken konuyu devralmaz", () => {
    expect(one("Sauna 2. katta. Yer size ayrılmıştır, 3. kat.", "Sauna 3. kat.", ["sauna kaçıncı katta"]).ok).toBe(false);
    expect(one("Havuz 20:00'de kapanır. Yer size ayrılmıştır, 23:00'e kadar.", "Havuz 23:00'e kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one("Havuz 20:00'de kapanır. Size 23:00'e kadar açık.", "Havuz 23:00'e kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
  });

  it("🚨 cümle İÇİNDE yer sözcükleri nötr değil ('Sauna 22:00'de, yer size ayrılmıştır, 20:00'de')", () => {
    expect(one("Sauna 22:00'de, yer size ayrılmıştır, 20:00'de.", "Sauna 20:00'de kapanıyor.", ["sauna kaçta kapanıyor"]).ok).toBe(false);
  });

  it("🚨 kat ≠ numara ('Otopark 12. katta' ← '12 numaralı yer'; '-2. kat' ← '2 numaralı yer')", () => {
    expect(one("Otopark -2. katta, 12 numaralı yer size ayrılmıştır.", "Otopark 12. katta.", ["otopark kaçıncı kat"]).ok).toBe(false);
    expect(one("Otopark 2 numaralı yerde.", "Otopark -2. katta.", ["otopark nerede"]).ok).toBe(false);
  });

  it("🚨 koşulsuz ikinci değerin ardındaki yer bildiren ad konuyu taşımaz ('Havuz 20:00'de, 22:00'ye kadar kafede açık')", () => {
    expect(one("Havuz 20:00'de, 22:00'ye kadar kafede açık.", "Havuz 22:00'ye kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
  });

  it("🚨 kalemdeki 'No12' bir koddur (kapı şifresi otopark yeri numarası olmaz)", () => {
    const src = "Havuz 20:00'de kapanır. Otopark kapısı şifresi No12.";
    expect(one(src, "Otopark 12.", ["otopark yeri numarası"], "Otopark kapısı şifresi No12.").ok).toBe(false);
  });

  it("🚨 yalın 'Pazar' + saat gündür: cumartesiye pazar değeri verilemez; pazar sorusuna doğru değer gider", () => {
    const src = "Havuz her gün 20:00'de kapanır. Pazar 23:00'e kadar açık.";
    expect(one(src, "Cumartesi havuz 23:00'e kadar açık.", ["cumartesi havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one(src, "Pazar havuz 20:00'de kapanır.", ["pazar havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one(src, "Havuz her gün 20:00'de kapanır; pazar 23:00'e kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("🚨 iki mevsimli kalemde mevsimler yer değiştiremez (mutasyon 10-23 V11)", () => {
    const src = "Havuz yaz aylarında 23:00'e kadar açık. Kış aylarında 20:00'de kapanır.";
    expect(one(src, "Havuz kışın 23:00'e kadar açık; yazın 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one(src, "Havuz yazın 23:00'e kadar açık; kışın 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("tümleyen yalnız değerle: değersiz 'Havuz hafta içi açık' tümleyen sayılmaz (temkinli; mutasyon 10-23 V12)", () => {
    expect(one("Havuz açıktır. Hafta sonu havuz kapalıdır.", "Havuz hafta içi açık.", ["havuz açık mı"]).issues).toContain("condition_added");
  });

  it("🚨 mevsim de değer başına: 'Havuz yazın 20:00'de kapanır' ← kalem 'yaz aylarında 23:00'", () => {
    const src = "Havuz 20:00'de kapanır. Yaz aylarında 23:00'e kadar açık.";
    expect(one(src, "Havuz yazın 20:00'de kapanır.", ["havuz kaçta kapanıyor"]).ok).toBe(false);
    expect(one(src, "Havuz 20:00'de kapanır; yaz aylarında 23:00'e kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });
});

describe("E ölçümü 10-23: değer başına koşul (eski açık)", () => {
  const POOLKB = "Havuz her gün 20:00'de, sauna 22:00'de kapanır. Hafta sonu havuz 23:00'e kadar açıktır.";
  const one = (part: string, q = ["havuz kaçta kapanıyor"]) => checkAnswerBinding({ part, evidence: POOLKB, sourceText: POOLKB, ...need(q) });

  it("🚨 genel değer, kendi değişkesi olan güne verilemez ('Havuz hafta sonu 20:00'de kapanır' — kalem: hafta sonu 23:00)", () => {
    expect(one("Havuz hafta sonu 20:00'de kapanır.").ok).toBe(false);
    expect(one("Havuz hafta içi ve hafta sonu 20:00'de kapanır.").ok).toBe(false);
  });

  it("doğru eşleşme gider: genel değer koşulsuz ya da hafta içi, hafta sonu değeri hafta sonuyla", () => {
    expect(one("Havuz her gün 20:00'de kapanır; hafta sonu 23:00'e kadar açık.").ok).toBe(true);
    expect(one("Havuz hafta sonu 23:00'e kadar açık.").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opus derin inceleme 10-23 — yanlış kabul sınıfları (hepsi gerçek doğrulayıcı çıktısıyla bulundu). Her biri TUTULUR; yanındaki doğru
// söyleyiş gider.
// ---------------------------------------------------------------------------
describe("Opus 10-23: yanlış kabuller — TUTULUR", () => {
  const one = (src: string, part: string, q: string[], evidence = src, otherSources?: string[]) =>
    checkAnswerBinding({ part, evidence, sourceText: src, ...need(q), ...(otherSources ? { otherSources } : {}) });

  it("🚨 K1: iki konulu ihtiyaçta ('havuz + sauna') saunanın 22:00'ı havuza verilemez (Türkçe ve İngilizce parça)", () => {
    const src = "Havuz 20:00'de kapanır. Sauna 22:00'de kapanır.";
    const q = ["havuz ve sauna kaçta kapanıyor", "when do the pool and sauna close"];
    expect(one(src, "Havuz 22:00'de kapanır.", q, "Sauna 22:00'de kapanır.").ok).toBe(false);
    expect(one(src, "The pool closes at 10 pm.", q, "Sauna 22:00'de kapanır.").ok).toBe(false);
    expect(one(src, "Sauna 22:00'de kapanır.", q, "Sauna 22:00'de kapanır.").ok).toBe(true);
    expect(one(src, "The pool closes at 8 pm.", q, "Havuz 20:00'de kapanır.").ok).toBe(true);
  });

  it("🚨 K2: ortak baş ad ('makinesi') ve kaba sözlük konusu ('restoran' ~ 'kahvaltı') bağ kurmaz", () => {
    const wm = "Çamaşır makinesi 22:00'den sonra kullanılmaz. Bulaşık makinesi her zaman kullanılabilir.";
    const q = ["çamaşır makinesi ne zaman kullanılabilir"];
    expect(one(wm, "Çamaşır makinesi her zaman kullanılabilir.", q, "Bulaşık makinesi her zaman kullanılabilir.").ok).toBe(false);
    const rest = "Restoran 22:00'de kapanır.";
    expect(one(rest, "Kahvaltı 22:00'de biter.", ["kahvaltı saati", "breakfast time"]).ok).toBe(false);
    expect(one(rest, "Breakfast ends at 10 pm.", ["kahvaltı saati", "breakfast time"]).ok).toBe(false);
  });

  it("🚨 K3: alıntı cümle parçası olsa da kalemin koşulu okunur (hafta sonu, yaz, pazar hariç, cumartesi, talep üzerine)", () => {
    const q = ["havuz kaçta kapanıyor"];
    expect(one("Hafta sonu havuz 20:00'de kapanır.", "Havuz 20:00'de kapanır.", q, "havuz 20:00'de kapanır").ok).toBe(false);
    expect(one("Yaz aylarında havuz 23:00'e kadar açıktır.", "Havuz 23:00'e kadar açık.", q, "havuz 23:00'e kadar açıktır").ok).toBe(false);
    expect(one("Havuz 20:00'de kapanır, pazar hariç.", "Havuz 20:00'de kapanır.", q, "Havuz 20:00'de kapanır").ok).toBe(false);
    expect(one("Cumartesi günleri havuz 22:00'de kapanır.", "Havuz 22:00'de kapanır.", q, "havuz 22:00'de kapanır").ok).toBe(false);
    expect(one("Hafta sonu havuz 20:00'de kapanır.", "The pool closes at 8 pm.", [...q, "when does the pool close"], "havuz 20:00'de kapanır").ok).toBe(false);
  });

  it("🚨 Y1: yön değer başına; aralığın tek ucu yönsüz ya da ters yönle verilemez", () => {
    const q = ["havuz saatleri", "pool hours"];
    expect(one("Havuz 09:00'da açılır ve 20:00'de kapanır.", "Havuz 20:00'de açılır, 09:00'da kapanır.", q).ok).toBe(false);
    const range = "Havuz 09:00-20:00 arası açıktır.";
    expect(one(range, "Havuz 20:00'de açılır.", q).ok).toBe(false);
    expect(one(range, "Havuz 09:00'da kapanır.", q).ok).toBe(false);
    expect(one(range, "The pool opens at 8 pm.", q).ok).toBe(false);
    expect(one(range, "Havuz 20:00'ye kadar açık.", q).ok).toBe(true);
    expect(one(range, "Havuz 09:00-20:00 arası açık.", q).ok).toBe(true);
  });

  it("🚨 Y2: hafta sonu değeri, parçanın başka yerinde 'hafta sonu' geçti diye genel verilemez", () => {
    const src = "Havuz 20:00'de kapanır. Hafta sonu 23:00'e kadar açık.";
    const q = ["havuz kaçta kapanıyor"];
    expect(one(src, "Havuz 23:00'de kapanır, hafta sonu da açık.", q).ok).toBe(false);
    expect(one(src, "Havuz 23:00'de kapanır. Hafta sonu da açık.", q).ok).toBe(false);
  });

  it("🚨 Y3: değersiz koşullu değişke ('Hafta sonu kapalıdır', 'Pazar günleri kapalıdır') görünür", () => {
    const src = "Havuz 20:00'de kapanır. Hafta sonu kapalıdır.";
    expect(one(src, "Cumartesi havuz 20:00'de kapanır.", ["havuz cumartesi kaçta kapanıyor"], "Havuz 20:00'de kapanır.").ok).toBe(false);
    expect(one(src, "Havuz 20:00'de kapanır.", ["havuz kaçta kapanıyor"], "Havuz 20:00'de kapanır.").ok).toBe(false);
    const sun = "Havuz 20:00'de kapanır. Pazar günleri kapalıdır.";
    expect(one(sun, "Havuz pazar 20:00'de kapanır.", ["havuz pazar kaçta kapanıyor"], "Havuz 20:00'de kapanır.").ok).toBe(false);
    expect(one(sun, "Havuz 20:00'de kapanır; pazar günleri kapalı.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("🚨 Y4: ücretli ↔ ücretsiz (diller arası); kalemde 'ücretsiz' yoksa 'free' uydurulamaz", () => {
    const q = ["otopark ücretli mi", "is parking free"];
    expect(one("Otopark ücretlidir.", "Parking is free.", q).ok).toBe(false);
    expect(one("Otopark ücretsizdir.", "Parking is free.", q).ok).toBe(true);
    const bf = "Kahvaltı 08:00-10:00 arası verilir.";
    expect(one(bf, "Breakfast is free and served until 10:00.", ["kahvaltı", "breakfast"]).ok).toBe(false);
    const two = "Havuz ücretsizdir. Sauna ücretlidir.";
    expect(one(two, "Sauna ücretsizdir.", ["havuz ve sauna ücretli mi"]).ok).toBe(false);
  });

  it("🚨 Y5: ücret tabanı (günlük ≠ konaklama boyunca ≠ kişi başı)", () => {
    const src = "Otopark günlük 200 TL.";
    const q = ["otopark ücreti", "parking price"];
    expect(one(src, "Otopark konaklama boyunca 200 TL.", q).ok).toBe(false);
    expect(one(src, "Parking is 200 TL for the whole stay.", q).ok).toBe(false);
    expect(one(src, "Otopark 200 TL.", q).ok).toBe(false);
    expect(one(src, "Parking costs 200 TL per day.", q).ok).toBe(true);
    expect(one(src, "Otopark günlük 200 TL.", q).ok).toBe(true);
  });

  it("🚨 Y6: sözcükle yazılmış sayı ('eight pm', 'acht Uhr', 'восемь', 'vier acht zwei eins') rakamsız tutulur", () => {
    const src = "Havuz 22:00'de kapanır.";
    const q = ["havuz kaçta kapanıyor", "when does the pool close"];
    expect(one(src, "The pool closes at eight pm.", q).ok).toBe(false);
    expect(one(src, "Der Pool schließt um acht Uhr abends.", q).ok).toBe(false);
    expect(one(src, "Бассейн закрывается в восемь вечера.", q).ok).toBe(false);
    expect(one("Kapı kodu 4821.", "Der Türcode lautet vier acht zwei eins.", ["kapı kodu", "door code"]).ok).toBe(false);
  });

  it("🚨 Y7: aynı cümledeki istisna / karşıtlık parçada da olmalı", () => {
    const q = ["evcil hayvan kabul ediliyor mu", "are pets allowed"];
    expect(one("Evcil hayvan kabul edilir, köpek hariç.", "Evcil hayvan kabul edilir.", q).ok).toBe(false);
    expect(one("Evcil hayvan kabul edilir ama köpekler kabul edilmez.", "Evcil hayvan kabul edilir.", q).ok).toBe(false);
    expect(one("Evcil hayvan kabul edilir, köpek hariç.", "Small dogs are welcome.", q).ok).toBe(false);
    expect(one("Evcil hayvan kabul edilir, köpek hariç.", "Evcil hayvan kabul edilir, köpek hariç.", q).ok).toBe(true);
  });

  it("O6: koşullu değişke BAŞKA kalemdeyse de görünür", () => {
    const a = "Havuz: Havuz 09:00-20:00 arası açıktır.";
    const b = "Yaz dönemi: Havuz yaz aylarında 23:00'e kadar açıktır.";
    expect(one(a, "Havuz 20:00'ye kadar açık.", ["havuz kaçta kapanıyor"], a, [a, b]).issues).toContain("variant_omitted");
    expect(one(a, "Havuz 20:00'ye kadar açık; yaz aylarında 23:00'e kadar.", ["havuz kaçta kapanıyor"], a, [a, b]).ok).toBe(true);
  });
});

describe("E v4 neden analizi + Haiku 10-23 (2. tur)", () => {
  const one = (src: string, part: string, q: string[], otherSources?: string[]) =>
    checkAnswerBinding({ part, evidence: src, sourceText: src, ...need(q), ...(otherSources ? { otherSources } : {}) });
  const BREAKFAST = "Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar zemin kattaki kafede verilir.";

  it("🚨 eksiltili 'kadar': 'hafta içi 10:30'a, hafta sonu 11:00'e kadar' doğru cevap GİDER (ölçümde yanlış ret)", () => {
    expect(one(BREAKFAST, "Kahvaltı hafta içi 10:30'a, hafta sonu 11:00'e kadar servis ediliyor.", ["kahvaltı kaçta bitiyor"]).ok).toBe(true);
  });

  it("'servis edil-' içerik sayılmaz ama olumsuzu ('servis edilmez') olumluluk kontrolünde TUTULUR", () => {
    expect(one(BREAKFAST, "Kahvaltı hafta sonu 11:00'e kadar servis edilmez.", ["kahvaltı kaçta bitiyor"]).issues).toContain("polarity_mismatch");
  });

  it("aşırı uygulama yok: bulunma eki ('10:30'da') ya da 'kadar'sız kardeş BİTİŞ sayılmaz — tutulur", () => {
    expect(one(BREAKFAST, "Kahvaltı hafta içi 10:30'da, hafta sonu 11:00'e kadar servis ediliyor.", ["kahvaltı kaçta bitiyor"]).issues).toContain("direction_mismatch");
    expect(one(BREAKFAST, "Kahvaltı hafta içi 10:30'a, hafta sonu 11:00'e başlıyor.", ["kahvaltı kaçta bitiyor"]).ok).toBe(false);
  });

  it("🚨 kalem tarafı da aynı okur: 'hafta içi 20:00'ye, hafta sonu 23:00'e kadar' → '20:00'de açılıyor' TUTULUR (eskiden geçiyordu)", () => {
    const src = "Havuz hafta içi 20:00'ye, hafta sonu 23:00'e kadar açıktır.";
    expect(one(src, "Havuz hafta içi 20:00'de açılıyor.", ["havuz kaçta açılıyor"]).issues).toContain("direction_mismatch");
    expect(one(src, "Havuz hafta içi 20:00'ye kadar açık.", ["havuz kaçta kapanıyor"]).ok).toBe(true);
  });

  it("🚨 ilgisiz kalemin koşulu uydurma koşulu doğrulamaz ('hafta sonu kahvaltı' → 'hafta sonu havuz' tutulur); konuya bağlı değişke doğrular", () => {
    const pool = "Havuz 20:00'e kadar açıktır.";
    const part = "Hafta sonu havuz 20:00'e kadar açık.";
    expect(one(pool, part, ["havuz kaçta kapanıyor"], ["Hafta sonu kahvaltı 09:00-11:00 arası verilir."]).issues).toContain("condition_added");
    expect(one(pool, part, ["havuz kaçta kapanıyor"], ["Hafta sonu havuz da 20:00'e kadar açıktır."]).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opus güvenlik 10-23 gece (F1–F8): her satır düzeltmeden ÖNCE ölçülerek geçiyordu (scratchpad n23/a1–a5 betikleri; kırmızı-önce kanıtı
// rapor §güvenlik). Kontroller: aynı kuralın doğru cevabı hâlâ GİDER.
// ---------------------------------------------------------------------------
describe("Opus güvenlik 10-23 gece", () => {
  const run = (src: string, part: string, q: string[], o: { evidence?: string; others?: string[] } = {}) =>
    checkAnswerBinding({ part, evidence: o.evidence ?? src, sourceText: src, ...need(q), ...(o.others ? { otherSources: o.others } : {}) });
  const POOLQ = ["havuz kaçta kapanıyor", "when does the pool close"];
  const PETQ = ["evcil hayvan kabul ediliyor mu", "are pets allowed"];
  const P = "Havuz 20:00'de kapanır.";

  it("🚨 F1: ASCII olmayan ondalık rakamlar ASCII'ye çevrilir — yanlış saat Arapça / Farsça / Devanagari rakamla geçmez", () => {
    expect(run(P, "يغلق المسبح الساعة ٢٠:٠٠", POOLQ).ok).toBe(true);
    for (const wrong of ["يغلق المسبح الساعة ٢٢:٠٠", "استخر ساعت ۲۲:۰۰ بسته می‌شود", "पूल २२:०० बजे बंद होता है"]) {
      expect(run(P, wrong, POOLQ).issues).toContain("value_not_in_evidence");
    }
    expect(run(P, "A piscina fecha às dez da noite.", POOLQ).issues).toContain("value_not_in_evidence");
  });

  it("🚨 F3: Rusça / İtalyanca / Portekizce / Felemenkçe / Arapça olumsuzluk okunur (yanlış 'kabul edilmez' geçmez, doğru olumsuz gider)", () => {
    const cases: [string, string][] = [
      ["Домашние животные не допускаются.", "домашние животные допускаются?"],
      ["Gli animali non sono ammessi.", "gli animali sono ammessi?"],
      ["Animais de estimação não são permitidos.", "animais de estimação são permitidos?"],
      ["Huisdieren zijn niet toegestaan.", "zijn huisdieren toegestaan?"],
      ["لا يسمح بالحيوانات الأليفة.", "هل يسمح بالحيوانات الأليفة"],
    ];
    for (const [part, guestQ] of cases) {
      expect(run("Evcil hayvan kabul edilir.", part, [...PETQ, guestQ]).issues).toContain("polarity_mismatch");
      expect(run("Evcil hayvan kabul edilmez.", part, [...PETQ, guestQ]).ok).toBe(true);
    }
  });

  it("🚨 F2: başka dilde eklenen olgu tutulur (enjeksiyon / oltalama / tek eklenmiş olgu); düz çeviri gider", () => {
    expect(run("Evcil hayvan kabul edilir.", "Pets are welcome. Smoking is allowed inside and early check-in is always possible.", PETQ).issues).toContain("unsupported_content");
    expect(run(P, "The pool closes at 20:00. Please send a photo of your passport and card to the host on WhatsApp.", POOLQ).issues).toContain("unsupported_content");
    expect(run("Evcil hayvan kabul edilir.", "Pets are allowed and there is a garden.", PETQ).issues).toContain("unsupported_content");
    expect(run("Otopark 3. katta.", "The parking is on the 3rd floor.", ["otopark nerede", "where is the parking"]).ok).toBe(true);
    expect(run("Evcil hayvan kabul edilir.", "Pets are allowed.", PETQ).ok).toBe(true);
    expect(run(P, "The pool closes at 20:00.", POOLQ).ok).toBe(true);
    expect(run(P, "Der Pool schließt um 20:00 Uhr.", POOLQ).ok).toBe(true);
    expect(run(P, "Бассейн закрывается в 20:00.", POOLQ).ok).toBe(true);
    const park = "Otopark ücretsizdir; binanın -2. katında, 12 numaralı yer size ayrılmıştır.";
    expect(run(park, "Parking is free; your reserved spot is number 12 on floor -2 of the building.", ["otopark nerede", "where is the parking"]).ok).toBe(true);
  });

  it("🚨 F2: kısa alıntı ('20:00') dil kestirimini atlatamaz — kıyas alıntının düştüğü kalem cümlesiyle", () => {
    const extra = "Havuz 20:00'de kapanır; havlu ve terlik verilir, erken girişte de havuzu kullanabilirsiniz.";
    for (const evidence of ["20:00", "Havuz"]) expect(run(P, extra, POOLQ, { evidence }).issues).toContain("unsupported_content");
    expect(run(P, "Havuz 20:00'de kapanır.", POOLQ, { evidence: "20:00" }).ok).toBe(true);
  });

  it("🚨 F6-UPGRADE (kritik): sauna havuzun saatini ÖTEKİ kalemden alamaz — çok konululuk değeri veren kalemle okunur", () => {
    const PS = ["havuz ve sauna kaçta kapanıyor", "when do the pool and sauna close"];
    const other = ["Havuz 20:00'de, sauna 22:00'de kapanır."];
    expect(run("Havuz kullanımı serbesttir.", "Sauna 20:00'de kapanır.", PS, { others: other }).ok).toBe(false);
    expect(run("Havuz kullanımı serbesttir.", "The sauna closes at 20:00.", PS, { others: other }).ok).toBe(false);
    expect(run("Havuz 20:00'de, sauna 22:00'de kapanır.", "Sauna 22:00'de kapanır.", PS, { others: ["Havuz kullanımı serbesttir."] }).ok).toBe(true);
  });

  it("🚨 F6: çelişen kalemler tutulur; niteleyicili rakip (geç çıkış) çelişki değil; değerin tamamı başka kalemden gelemez (çapa)", () => {
    expect(run(P, "The pool closes at 22:00.", POOLQ, { others: ["A Blok havuzu 22:00'de kapanır."] }).ok).toBe(false);
    expect(run("Havuz 20:00'de kapanır. Havuz 22:00'de kapanır.", "Havuz 22:00'de kapanır.", POOLQ).issues).toContain("value_conflict");
    expect(run("- [OLANAKLAR] Havuz 23:00: Havuz 20:00'de kapanır.", "Havuz 20:00'de kapanır.", POOLQ, { evidence: "Havuz 20:00'de kapanır." }).issues).toContain("value_conflict");
    const co = "Çıkış saati 11:00. Geç çıkış 13:00'e kadar mümkündür.";
    expect(run(co, "Çıkış saati 11:00.", ["çıkış saati kaçta", "checkout time"]).ok).toBe(true);
    expect(run(co, "Check-out is at 11:00.", ["çıkış saati kaçta", "checkout time"]).ok).toBe(true);
    const anchorless = run("Havuz: misafirlerimiz havuzu kullanabilir.", "The pool closes at 22:00.", POOLQ, {
      evidence: "misafirlerimiz havuzu kullanabilir",
      others: ["Daire 3 için: Havuz 22:00'de kapanır."],
    });
    expect(anchorless.issues).toContain("value_not_in_evidence");
    // Liste ("08:00, 09:00 ve 10:00") ve parçanın kendisinin de verdiği değer taraf tutmaz.
    expect(run("Çöp 09:00 ve 21:00'de toplanır.", "Çöp 09:00 ve 21:00'de toplanır.", ["çöp ne zaman toplanıyor"]).ok).toBe(true);
  });

  it("🚨 F8: kalem yön vermiyorsa parça yön uyduramaz; 'en geç / en erken' yön sözcüğü; giriş / çıkışın doğal yönü serbest", () => {
    const CQ = ["çıkış saati kaçta", "checkout time"];
    const IQ = ["giriş saati kaçta", "checkin time"];
    expect(run("Check-out en geç 11:00.", "You can check out after 11:00.", CQ).issues).toContain("direction_mismatch");
    expect(run("Check-out en geç 11:00.", "Check-out is at 11:00 at the latest.", CQ).ok).toBe(true);
    expect(run("Giriş en erken 15:00.", "You can check in before 15:00.", IQ).issues).toContain("direction_mismatch");
    expect(run("Giriş en erken 15:00.", "Check-in is possible until 15:00.", IQ).issues).toContain("direction_mismatch");
    expect(run("Check-out saati: 11:00", "Please check out by 11:00.", CQ).ok).toBe(true);
    expect(run("Check-in saati: 15:00", "Check-in is from 15:00.", IQ).ok).toBe(true);
    expect(run("Check-in saati: 15:00", "Check-in is possible until 15:00.", IQ).issues).toContain("direction_mismatch");
    expect(run("Check-out saati: 11:00", "You can check out after 11:00.", CQ).issues).toContain("direction_mismatch");
    expect(run("Havuz 20:00", "Havuz 20:00'ye kadar açık.", POOLQ).issues).toContain("direction_mismatch");
  });

  it("🚨 F8: eksiltili yüklem aynı hâl ekli dizide geriye taşınır (bulunma / ayrılma / yönelme), ek farklıysa taşınmaz", () => {
    const BF = ["kahvaltı saati", "breakfast time"];
    const bs = "Kahvaltı hafta içi 08:00'de, hafta sonu 09:00'da başlar.";
    expect(run(bs, "Kahvaltı hafta içi 08:00'de başlar.", BF).ok).toBe(true);
    expect(run(bs, "Kahvaltı hafta içi 08:00'de biter.", BF).issues).toContain("direction_mismatch");
    expect(run(bs, "On weekdays breakfast ends at 08:00.", BF).issues).toContain("direction_mismatch");
    const ph = ["havuz saatleri", "pool hours"];
    expect(run("Havuz hafta içi 09:00'da, hafta sonu 10:00'da açılır.", "Havuz hafta içi 09:00'a kadar açık.", ph).issues).toContain("direction_mismatch");
    expect(run("Havuz 09:00'dan, sauna 10:00'dan itibaren açık.", "Havuz 09:00'dan itibaren açık.", ph).ok).toBe(true);
    expect(run("Havuz 09:00'dan, sauna 10:00'dan itibaren açık.", "Havuz 09:00'a kadar açık.", ph).issues).toContain("direction_mismatch");
    // Üç değerli zincir: ortadaki yönsüz yan cümleden geçer.
    expect(run("Havuz pazartesi 09:00'da, salı 10:00'da, çarşamba 11:00'de açılır.", "Havuz pazartesi 09:00'da açılır.", ["havuz kaçta açılıyor"]).ok).toBe(true);
    // Ek farklı ("10:30'da" ↔ "11:00'e kadar"): bitiş taşınmaz → "10:30'a kadar" kalemde yönsüz değere yön uydurur.
    expect(run("Kahvaltı hafta içi 10:30'da, hafta sonu 11:00'e kadar verilir.", "Kahvaltı hafta içi 10:30'a kadar verilir.", ["kahvaltı kaçta bitiyor"]).issues).toContain("direction_mismatch");
  });

  it("🚨 F1b: değersiz (evet / hayır) parça konu cümlesindeki kısıtı düşüremez; varlık cevabı ve ücret sorusu yalnız ücreti sayar", () => {
    expect(run("10 kg'a kadar evcil hayvan kabul edilir.", "Evcil hayvan kabul edilir.", PETQ).issues).toContain("condition_dropped");
    expect(run("10 kg'a kadar evcil hayvan kabul edilir.", "Pets are allowed.", PETQ).issues).toContain("condition_dropped");
    expect(run("En fazla 1 evcil hayvan kabul edilir.", "Evcil hayvan kabul edilir.", PETQ).issues).toContain("condition_dropped");
    expect(run("Evcil hayvan kabul edilir, gecelik 300 TL.", "Evcil hayvan kabul edilir.", PETQ).issues).toContain("condition_dropped");
    expect(run("Küçük evcil hayvanlar kabul edilir.", "Evcil hayvanlar kabul edilir.", PETQ).issues).toContain("condition_dropped");
    expect(run("Küçük evcil hayvanlar kabul edilir.", "Small pets are allowed.", PETQ).ok).toBe(true);
    expect(run("Otopark ücretsizdir, 07:00-23:00 arası açıktır.", "Otopark ücretsizdir.", ["otopark ücretli mi"]).ok).toBe(true);
    expect(run("Otopark ücretsizdir; binanın -2. katında, 12 numaralı yer size ayrılmıştır.", "Evet, ücretsiz otopark var.", ["otopark var mı"]).ok).toBe(true);
    expect(run("Havuz 09:00-20:00 arası açıktır.", "Evet, havuz var.", ["havuz var mı"]).ok).toBe(true);
    expect(run("Havuz kullanımı kişi başı 200 TL'dir.", "Evet, havuz var.", ["havuz var mı"]).issues).toContain("condition_dropped");
    expect(run("Havuz yalnız yaz aylarında açıktır.", "Evet, havuz var.", ["havuz var mı"]).issues).toContain("condition_dropped");
  });
});

// Gece mutasyon koşusunun (10-23, 33/37) yaşayan mutantları için pinler: B7 (devralınan yan cümle aralığı önek sayımında yer başından
// değil konu yerinin başından sayılır) · B8 (öteki kalemin değersiz konu yan cümlesinin koşulu uydurma koşul kıyasına girer).
// B2/B3 eski "kadar" işlevini hedefliyordu; işlevin yerini alan aynı-ek zinciri yukarıdaki F8 testleriyle pinli.
describe("mutasyon pinleri 10-23 gece", () => {
  const run = (src: string, part: string, others?: string[]) =>
    checkAnswerBinding({ part, evidence: src, sourceText: src, ...need(["havuz kaçta kapanıyor"]), ...(others ? { otherSources: others } : {}) });

  it("B7: konu yerinden ÖNCEKİ yan cümlenin koşulu (başka tesisin 'hafta sonu'su) değere bağışlanmaz", () => {
    expect(run("Hafta sonu kahvaltı 09:00'da, havuz 20:00'de kapanır.", "Havuz 20:00'de kapanır.").ok).toBe(true);
  });

  it("B8: öteki kalemin değersiz konu yan cümlesi ('Havuz hafta sonu kapalıdır.') parçanın 'hafta sonu'sunu doğrular", () => {
    const part = "Havuz hafta içi 20:00'de kapanır; hafta sonu kapalıdır.";
    expect(run("Havuz 20:00'de kapanır.", part, ["Havuz hafta sonu kapalıdır."]).ok).toBe(true);
    expect(run("Havuz 20:00'de kapanır.", part).issues).toContain("condition_added");
  });
});

// Haiku 10-23 gece incelemesi (821ce991): 3 yanlış kabul TUTULUR, 5 yanlış tutma + "free of charge" GİDER.
describe("Haiku 10-23 gece (821ce991 incelemesi)", () => {
  const run = (src: string, part: string, q: string[], others?: string[]) =>
    checkAnswerBinding({ part, evidence: src, sourceText: src, ...need(q), ...(others ? { otherSources: others } : {}) });
  const POOLQ = ["havuz kaçta kapanıyor", "when does the pool close"];
  const PS = ["havuz ve sauna kaçta kapanıyor", "when do the pool and sauna close"];
  const CO = ["çıkış saati kaçta", "what time is check-out"];

  it("🚨 kalemde olmayan tesis anılamaz (ihtiyaç sorsa da): 'Havuz ve sauna 20:00', 'The sauna closes at 20:00' ← yalnız havuz kalemi", () => {
    expect(run("Havuz 20:00'de kapanır.", "Havuz ve sauna 20:00'de kapanır.", PS).ok).toBe(false);
    expect(run("Havuz 20:00'de kapanır.", "The pool and the sauna close at 20:00.", PS).ok).toBe(false);
    expect(run("Havuz açıktır.", "Havuz ve sauna açıktır.", ["havuz ve sauna açık mı"]).ok).toBe(false);
    expect(run("Havuz 20:00'de kapanır.", "The sauna closes at 20:00.", POOLQ).ok).toBe(false);
    expect(run("Havuz 20:00'de kapanır.", "Die Sauna schließt um 20:00 Uhr.", POOLQ).ok).toBe(false);
    // İki tesisi taşıyan değer yeri: parçanın iki tesisi de kalem yerinde olmalı.
    expect(run("Havuz 20:00'de, sauna 22:00'de kapanır.", "Havuz ve sauna 20:00'de kapanır.", PS).ok).toBe(false);
    expect(run("Havuz ve sauna 20:00'de kapanır.", "Havuz ve sauna 20:00'de kapanır.", PS).ok).toBe(true);
  });

  it("🚨 niteleyicili değişke ('Geç çıkış 13:00') genel değer gibi verilemez; niteleyiciyle gider", () => {
    const src = "Çıkış saati 11:00. Geç çıkış 13:00'e kadar mümkündür.";
    expect(run(src, "Çıkış saati 13:00'e kadar.", CO).ok).toBe(false);
    expect(run(src, "Geç çıkış 13:00'e kadar mümkündür.", CO).ok).toBe(true);
    expect(run(src, "Çıkış saati 11:00.", CO).ok).toBe(true);
  });

  it("yanlış tutmalar gider: nezaket kapanışı, etiketli yön ('Kapanış saati: 20:00'), ileri eksilti, rakip olmayan nitelik, çok satırlı bakım listesi", () => {
    expect(run("Havuz 20:00'de kapanır.", "The pool closes at 20:00. We hope you enjoy your stay.", POOLQ).ok).toBe(true);
    expect(run("Havuz 20:00'de kapanır.", "Der Pool schließt um 20:00 Uhr. Wir wünschen Ihnen einen schönen Aufenthalt.", POOLQ).ok).toBe(true);
    expect(run("Havuz kapanış saati: 20:00.", "Havuz 20:00'de kapanır.", POOLQ).ok).toBe(true);
    expect(run("Pool closing time: 20:00.", "The pool closes at 20:00.", POOLQ).ok).toBe(true);
    expect(run("Havuz 20:00'de kapanır, sauna 22:00'de.", "Sauna 22:00'de kapanır.", ["sauna kaçta kapanıyor", "when does the sauna close"]).ok).toBe(true);
    expect(run("Havuz 20:00'de kapanır. Havuz temizliği 14:00'te yapılır.", "Havuz 20:00'de kapanır.", POOLQ).ok).toBe(true);
    expect(run("Havuz 20:00'de kapanır. Açık havuz 18:00'de kapanır.", "Havuz 20:00'de kapanır.", POOLQ).ok).toBe(true);
    const maintenance = Array.from({ length: 50 }, (_, i) => `Havuz bakımı ${String(i % 24).padStart(2, "0")}:15'te yapılır.`).join(" ");
    expect(run(`Havuz 20:00'de kapanır. ${maintenance}`, "Havuz 20:00'de kapanır.", POOLQ).ok).toBe(true);
    // Süre yardımcısı ("devam ediyor" ← "verilir"; E ölçümü v5).
    expect(run("Kahvaltı 08:00-10:30 arası, hafta sonu 11:00'e kadar zemin kattaki kafede verilir.", "Hafta sonu kahvaltı 11:00'e kadar devam ediyor.", ["hafta sonu kahvaltı kaça kadar"]).ok).toBe(true);
  });

  it("'free of charge' / 'no extra charge' ücretsizdir (önceden ücretli okunuyordu)", () => {
    const park = ["otopark ücretli mi", "is parking free"];
    expect(run("Otopark ücretsizdir.", "Parking is free of charge.", park).ok).toBe(true);
    expect(run("Otopark ücretsizdir.", "There is no extra charge for parking.", park).ok).toBe(true);
    expect(run("Otopark günlük 200 TL.", "Parking is free of charge.", park).ok).toBe(false);
  });
});
