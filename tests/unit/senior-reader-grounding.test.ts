import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Kıdemli okuyucu — canlı hat ölçümünden çıkan iki düzeltme (10-22) + Opus 10-22 F1 / F2:
//  1. ALINTI KANITI: "itiraf var" diyen okumanın alıntısı taslakta yoksa o oy düşer, itiraf kararı o metin için kelime kuralına kalır.
//     Ölçülen vaka: "Duş suyu biraz soğuk geliyor. Çöpleri nereye atıyoruz?" → taslak yalnız çöp sorusunu cevaplıyor; misafir mesajlı
//     okuma 3 koşunun 2'sinde "itiraf" dedi (birinde taslakta OLMAYAN bir cümleyi alıntıladı) → cevap boşuna tutuluyordu.
//  2. YENİDEN YAZMA BİRLEŞTİRMESİ: metin yeni çağrıdan, modelin risk hükmü ilk çağrıdan.
//  3. Bilgi tabanı boşken kodun notları (yeniden yazma sebebi) modele ulaşır.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import {
  absenceHolds,
  combineAbsenceReadings,
  groundReading,
  judgeReleases,
  quoteCarriesContent,
  quoteGroundedIn,
  readerQuoteGroundedIn,
  paymentHeldHolds,
  seniorChecksOf,
  ABSENCE_JUDGE_SYSTEM_PROMPT,
  type Reading,
} from "@/lib/ai/semantic/absence-judge";
import { mergeSeniorRewrite, SENIOR_REWRITE_GATE_DETAILS, SENIOR_REWRITE_QR_REASONS } from "@/lib/ai/semantic/senior-rewrite";
import { packKnowledgeBase } from "@/lib/ai/prompts";

const DRAFT = "Merhaba [Misafir],\n\nÇöp konteynerleri binanın arka tarafında, otopark girişinin yanındadır; geri dönüşüm için mavi konteyneri kullanın.";
const NO = { payHost: false, contact: false, apology: false, internalSource: false };

describe("alıntı kanıtı", () => {
  it("taslaktaki cümle (büyük-küçük harf / tırnak / noktalama / boşluk farkıyla) kanıttır", () => {
    expect(quoteGroundedIn(DRAFT, "çöp konteynerleri binanın arka tarafında, otopark girişinin yanındadır")).toBe(true);
    expect(quoteGroundedIn('Wi-Fi şifresi "Lale2025". Ağ adı Lale-5G.', "Wi-Fi şifresi Lale2025")).toBe(true);
  });

  it("taslakta OLMAYAN cümle, boş alıntı ve sözcük ortasından parça kanıt değildir", () => {
    expect(quoteGroundedIn(DRAFT, "Duş suyuyla ilgili bilgi notlarımızda özel bir ayar bulunmuyor.")).toBe(false);
    expect(quoteGroundedIn(DRAFT, "")).toBe(false);
    expect(quoteGroundedIn(DRAFT, "nteynerleri")).toBe(false);
  });

  // Opus P2-4: model alıntıyı atlama işaretiyle kısaltırsa ("Laut meinen Unterlagen … geöffnet") sadık oy "dayanaksız" sayılıyordu; iç
  // kaynak hükmünde misafir mesajını gören okumanın dayanaksız oyu artık sayılmadığı için o taslak yalnız kelime yedeğine kalıyordu.
  const DE = "Hallo [Gast],\n\nLaut meinen Unterlagen ist der Pool ab 9 Uhr geöffnet. Handtücher liegen im Schrank.";
  it("🚨 okuyucu alıntısı: atlama işaretiyle kısaltılmış alıntı, parçaları taslakta AYNI SIRAYLA geçiyorsa kanıttır", () => {
    expect(quoteGroundedIn(DE, "Laut meinen Unterlagen … geöffnet")).toBe(false); // düz kural: bitişik değil
    for (const q of [
      "Laut meinen Unterlagen … geöffnet",
      "Laut meinen Unterlagen ... geöffnet",
      "Laut meinen Unterlagen [...] geöffnet.",
      "… meinen Unterlagen ist der Pool …",
      // Öteki yazımlar: iki nokta, aralıklı noktalar, ayraç içinde tek karakter.
      "Laut meinen Unterlagen .. geöffnet",
      "Laut meinen Unterlagen . . . geöffnet",
      "Laut meinen Unterlagen (…) geöffnet",
    ]) {
      expect([q, readerQuoteGroundedIn(DE, q)]).toEqual([q, true]);
    }
    // Atlamasız alıntıda iki kural birebir aynı (kısaltılmamış sadık alıntı / taslakta olmayan cümle / boş / sözcük ortası).
    for (const q of ["ist der Pool ab 9 Uhr geöffnet", "Der Pool ist leider geschlossen.", "", "nterlagen", "Unterlagen…", "…"]) {
      expect([q, readerQuoteGroundedIn(DE, q)]).toEqual([q, quoteGroundedIn(DE, q)]);
    }
  });
  it("🚨 kısaltılmış alıntı taslakta OLMAYAN parça taşıyorsa, sırası tersse ya da tek tek sözcüklerden ibaretse kanıt DEĞİLDİR", () => {
    // Misafir mesajını gören okumanın uydurduğu cümle (11-12 ölçümü): ikinci parça taslakta var, birincisi yok.
    expect(readerQuoteGroundedIn(DE, "Nach meinen Informationen … geöffnet")).toBe(false);
    expect(readerQuoteGroundedIn(DE, "Laut meinen Unterlagen … geschlossen")).toBe(false);
    // Ters sıra: parçalar taslakta var ama alıntıdaki sırayla değil.
    expect(readerQuoteGroundedIn(DE, "Handtücher liegen … Laut meinen Unterlagen")).toBe(false);
    // Aynı parça iki kez: ikinci arama birincinin BİTTİĞİ yerden başlar (aynı yeri iki kez sayma).
    expect(readerQuoteGroundedIn(DE, "meinen Unterlagen … meinen Unterlagen")).toBe(false);
    // Tek tek sözcükler her taslakta sırayla bulunur → en az bir parça iki sözcük olmalı.
    expect(readerQuoteGroundedIn(DE, "Laut … Pool … Schrank")).toBe(false);
    expect(readerQuoteGroundedIn(DE, "Laut … der Pool … Schrank")).toBe(true);
    // Sözcük torbası: dörtten çok parça alıntı sayılmaz.
    expect(readerQuoteGroundedIn(DE, "Laut meinen … ist der … ab 9 … Handtücher liegen … im Schrank")).toBe(false);
    // Sözcük ortasından parça yine geçmez.
    expect(readerQuoteGroundedIn(DE, "Laut meinen Unterl … geöffnet")).toBe(false);
    // Tek nokta cümle sonudur, atlama DEĞİL: iki ayrı cümlenin parçaları araya atlama konmadan birleştirilemez.
    expect(readerQuoteGroundedIn(DE, "Laut meinen Unterlagen. Handtücher liegen im Schrank")).toBe(false);
    expect(readerQuoteGroundedIn(DE, "geöffnet. Handtücher liegen im Schrank.")).toBe(true); // bitişik iki cümle, düz kural
  });
  it("🚨 NUL karakteri parçaları kaydıramaz (Haiku 11-12): taslağın kendi kuyruğu 'alıntı' yerine geçmez", () => {
    // İki taraf NUL ile birleştirilip bölünüyordu; taslaktaki NUL ikinci parçayı alıntı konumuna itiyordu → uydurma alıntı dayanaklı.
    expect(quoteGroundedIn("Parken ist gratis\u0000Parken", "Mars")).toBe(false);
    expect(readerQuoteGroundedIn("Parken ist gratis\u0000Parken", "Mars … Parken")).toBe(false);
    // NUL taşıyan sadık alıntı / taslak yine eşleşir (karakter yok sayılır).
    expect(quoteGroundedIn("Parken ist\u0000 gratis", "Parken ist gratis")).toBe(true);
    expect(quoteGroundedIn("Parken ist gratis", "Parken\u0000 ist gratis")).toBe(true);
  });
  it("🚨 kısaltılmış sadık alıntıyla verilen iç kaynak oyu dayanaklıdır (hüküm tutar); cevap parçası doğrulayıcısı atlamayı kabul ETMEZ", () => {
    const vote: Reading = { admits: false, quote: "", checks: { ...NO, internalSource: true }, checkQuotes: { payHost: "", contact: "", apology: "", internalSource: "Laut meinen Unterlagen … geöffnet" } };
    const grounded = groundReading(vote, DE);
    expect(grounded?.checks?.internalSource).toBe(true);
    expect(grounded?.ungroundedChecks).toBeUndefined();
    // Misafir mesajını gören okumanın oyu olarak da (taslağı tek başına okuyan "hayır" dese de) hüküm "evet".
    const silent = { admits: false, quote: "", checks: NO, checkQuotes: { payHost: "", contact: "", apology: "", internalSource: "" } };
    const out = combineAbsenceReadings({ withGuest: grounded, draftOnly: groundReading(silent, DE) });
    expect(out.status === "ok" && seniorChecksOf(out)?.internalSource).toBe(true);
    // Uydurma cümle dayanaksız kalır ve misafir mesajını gören okumadan geldiği için sayılmaz (11-12 kuralı aynen).
    const invented = groundReading<Reading>({ ...vote, checkQuotes: { payHost: "", contact: "", apology: "", internalSource: "Nach meinen Informationen … geöffnet" } }, DE);
    expect(invented?.ungroundedChecks).toEqual({ internalSource: true });
    const out2 = combineAbsenceReadings({ withGuest: invented, draftOnly: groundReading(silent, DE) });
    expect(out2.status === "ok" && seniorChecksOf(out2)?.internalSource).toBe(false);
  });

  it("dayanaksız itiraf oyu düşer; öteki hükümler (ödeme / iletişim / özür) aynen kalır", () => {
    const r = groundReading({ admits: true, quote: "Bu konuda bilgim yok.", checks: { ...NO, apology: true } }, DRAFT);
    expect(r).toEqual({ admits: false, quote: "", checks: { ...NO, apology: true }, ungrounded: true });
    const grounded = groundReading({ admits: true, quote: "mavi konteyneri kullanın", checks: NO }, DRAFT);
    expect(grounded?.admits).toBe(true);
    expect(groundReading(null, DRAFT)).toBeNull();
  });

  it("ek hükümler: dayanaksız 'evet' oyu düşer, dayanaklı oy kalır; alıntı alanı yoksa okuma aynen", () => {
    const r = groundReading(
      {
        admits: false,
        quote: "",
        checks: { payHost: true, contact: true, apology: false, internalSource: false },
        checkQuotes: { payHost: "Ücreti bana nakit ödeyebilirsiniz.", contact: "mavi konteyneri kullanın", apology: "", internalSource: "" },
      },
      DRAFT,
    );
    expect(r?.checks).toEqual({ payHost: false, contact: true, apology: false, internalSource: false });
    const legacy = groundReading({ admits: false, quote: "", checks: { ...NO, payHost: true } }, DRAFT);
    expect(legacy?.checks?.payHost).toBe(true);
  });

  it("birleşim: dayanaksız oy tek başına itiraf değil, serbest bırakma da değil — karar kelime kuralına kalır", () => {
    const out = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ungrounded: true }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(out).toEqual({ status: "ok", admits: false, quote: "", checks: NO, ungrounded: true });
    expect(absenceHolds(false, out)).toBe(false); // çöp cevabı: kelime kuralı da itiraf görmüyor → gider
    expect(absenceHolds(true, out)).toBe(true); // kelime kuralı itiraf görüyorsa tutulur (bugünkü davranış)
    expect(judgeReleases(out)).toBe(false);
    // Taslağı tek başına okuyan okumanın dayanaklı itirafı her durumda tutar (ikisi birlikte de); iki okuma da "yok" derse serbest.
    expect(absenceHolds(false, combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO }, draftOnly: { admits: true, quote: "x", checks: NO } }))).toBe(true);
    expect(absenceHolds(false, combineAbsenceReadings({ withGuest: { admits: true, quote: "x", checks: NO }, draftOnly: { admits: true, quote: "y", checks: NO } }))).toBe(true);
    const clean = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(clean).toEqual({ status: "ok", admits: false, quote: "", checks: NO });
    expect(absenceHolds(true, clean)).toBe(false);
    expect(judgeReleases(clean)).toBe(true);
  });

  it("benzer harf / görünmez karakter / uyumluluk biçimi alıntıyı düşürmez (Opus 10-22 F1)", () => {
    // Taslakta Kiril "а" + sıfır genişlikli boşluk var; model düz Latin harfle kopyalıyor.
    const draft = "Merhaba [Misafir],\n\nÜcreti kapıda n\u0430kit olarak ev\u200b sahibinize yapabilirsiniz.";
    expect(quoteGroundedIn(draft, "Ücreti kapıda nakit olarak ev sahibinize yapabilirsiniz.")).toBe(true);
    expect(quoteGroundedIn("Wi\uFF0DFi şifresi Lale2025", "Wi-Fi şifresi Lale2025")).toBe(true);
    // Tam genişlikli harf / rakam (uyumluluk biçimi, NFKC): taslakta "Ｌａｌｅ２０２５", model düz yazıyla kopyalıyor.
    expect(quoteGroundedIn("Wi-Fi şifresi \uFF2C\uFF41\uFF4C\uFF45\uFF12\uFF10\uFF12\uFF15", "Wi-Fi şifresi Lale2025")).toBe(true);
  });

  it("🚨 itirafı YALNIZ misafir mesajını gören okuma gördüyse kelime kuralı da görmeli (11-12 ölçümü: değinilmeyen soru itiraf değildir)", () => {
    // Birinci argüman misafir mesajını gören okuma, ikincisi taslağı tek başına okuyan. Ölçülen vaka: taslak "Ja, es gibt einen Parkplatz …",
    // misafir ayrıca köpek sormuş; bağlamlı okuma "itiraf" deyip bu gerçek cümleyi alıntıladı.
    const guestOnly = combineAbsenceReadings({ withGuest: { admits: true, quote: "Ja, es gibt einen Parkplatz", checks: NO }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(guestOnly).toMatchObject({ status: "ok", admits: true, guestOnly: true });
    expect(absenceHolds(false, guestOnly)).toBe(false); // kelime kuralı itiraf görmüyor → gider
    expect(absenceHolds(true, guestOnly)).toBe(true); // kelime kuralı da görüyor → tutulur
    expect(judgeReleases(guestOnly)).toBe(false); // "itiraf yok" diye serbest bırakma da değil
    // Taslağı tek başına okuyan dayanaksız da olsa "evet" dediyse iki okuma uyuşmuştur → tam hüküm.
    const agreed = combineAbsenceReadings({ withGuest: { admits: true, quote: "x", checks: NO }, draftOnly: { admits: false, quote: "", checks: NO, ungrounded: true } });
    expect(agreed).not.toHaveProperty("guestOnly");
    expect(absenceHolds(false, agreed)).toBe(true);
    // Taslağı tek başına okuyan gördüyse alıntı hangi okumadan gelirse gelsin tam hüküm.
    const draftSaw = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO }, draftOnly: { admits: true, quote: "Bilgim yok.", checks: NO } });
    expect(draftSaw).toEqual({ status: "ok", admits: true, quote: "Bilgim yok.", checks: NO });
    expect(combineAbsenceReadings({ withGuest: { admits: true, quote: "a", checks: NO }, draftOnly: { admits: true, quote: "b", checks: NO } })).toEqual({ status: "ok", admits: true, quote: "a", checks: NO });
  });

  it("itirafta İKİ okuma da dayanaksız 'evet' derse geçerli, tek okumada kelime kuralına kalır (Opus 10-22 F1/F2)", () => {
    const both = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ungrounded: true }, draftOnly: { admits: false, quote: "", checks: NO, ungrounded: true } });
    expect(both).toMatchObject({ status: "ok", admits: true });
    expect(absenceHolds(false, both)).toBe(true);
  });

  it("ek hükümlerde dayanaksız 'evet' (tek okumada da) TUTAR — sessizce 'hayır'a dönmez (Haiku 10-22)", () => {
    const one = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ungroundedChecks: { payHost: true, apology: true } }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(one).toMatchObject({ status: "ok", admits: false, checks: NO, ungroundedChecks: { payHost: true, apology: true } });
    expect(seniorChecksOf(one)).toEqual({ payHost: true, contact: false, apology: true, internalSource: false });
    expect(paymentHeldHolds(false, seniorChecksOf(one))).toBe(true);
    // Dayanaksız oy yoksa okuyucunun "hayır"ı kelime kuralını ezer (T-d: üçüncü tarafa ödeme bilgisi gider).
    const clean = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(seniorChecksOf(clean)).toEqual(NO);
    expect(paymentHeldHolds(true, seniorChecksOf(clean))).toBe(false);
    expect(paymentHeldHolds(true, undefined)).toBe(true);
  });

  it("🚨 selamdan / ad maskesinden ibaret alıntı kanıt DEĞİLDİR (11-12 ölçümü: değinilmeyen soruda selam satırı 'itiraf' kanıtı gösterildi)", () => {
    for (const quote of ["Merhaba [Misafir],", "[Misafir],", "Hello [Guest],", "Merhaba,", "Hallo [Misafir]!", "  [Misafir]  "]) {
      expect([quote, quoteCarriesContent(quote)]).toEqual([quote, false]);
    }
    // Selam sözcüğünden sonra kapalı hitap listesinde OLMAYAN sözcük gelen cümle içeriktir (Haiku 11-12: "Merhaba bilmiyorum." selam sayılıyordu);
    // birleşen işaretli yazıda harfler bitişik olmasa da içerik sayılır.
    for (const quote of ["Bilmiyorum.", "Bu konuda bilgim yok.", "Merhaba [Misafir], bu konuda bilgim yok.", "mavi konteyneri kullanın", "Нет информации о парковке.", "Merhaba bilmiyorum.", "Hi sorry!", "Merhaba özür dilerim.", "माफ़ कीजिए"]) {
      expect([quote, quoteCarriesContent(quote)]).toEqual([quote, true]);
    }
    // Ölçülen vaka: taslak yalnız Wi-Fi cevabı; misafir mesajlı okuma "itiraf" deyip selamı alıntıladı → oy düşer, karar kelime kuralına kalır.
    const wifi = 'Merhaba [Misafir],\n\nWi-Fi ağ adı "Lale_Home", şifre "Lale2024".';
    const withGuest = groundReading({ admits: true, quote: "Merhaba [Misafir],", checks: NO }, wifi);
    expect(withGuest).toEqual({ admits: false, quote: "", checks: NO, ungrounded: true });
    const out = combineAbsenceReadings({ withGuest: withGuest, draftOnly: groundReading({ admits: false, quote: "", checks: NO }, wifi) });
    expect(absenceHolds(false, out)).toBe(false);
    // Ek hükümlerde de: selam satırı ödeme / iç kaynak kanıtı olamaz.
    const checks = groundReading<Reading>(
      { admits: false, quote: "", checks: { ...NO, payHost: true, internalSource: true }, checkQuotes: { payHost: "Merhaba [Misafir],", contact: "", apology: "", internalSource: "[Misafir]," } },
      wifi,
    );
    expect(checks?.checks).toEqual(NO);
    expect(checks?.ungroundedChecks).toEqual({ payHost: true, internalSource: true });
    // KONTROL: gerçek cümleyi alıntılayan oy aynen geçerli.
    expect(groundReading({ admits: true, quote: 'Wi-Fi ağ adı "Lale_Home", şifre "Lale2024".', checks: NO }, wifi)?.admits).toBe(true);
  });

  it("🚨 iç kaynak hükmünde dayanaksız oy yalnız taslağı TEK BAŞINA okuyan okumadan sayılır; ödeme / iletişim / özürde kural aynı", () => {
    // Misafir mesajını gören okuma (birinci) uydurma cümleyle "iç kaynak" dedi; taslağı tek başına okuyan (ikinci) "hayır".
    const guestOnly = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ungroundedChecks: { internalSource: true } }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(seniorChecksOf(guestOnly)).toEqual(NO);
    expect(guestOnly).not.toHaveProperty("ungroundedChecks");
    // Taslağı tek başına okuyan okumanın dayanaksız oyu (tek başına da, ikisi birlikte de) sayılır.
    for (const first of [{}, { ungroundedChecks: { internalSource: true as const } }]) {
      const out = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ...first }, draftOnly: { admits: false, quote: "", checks: NO, ungroundedChecks: { internalSource: true } } });
      expect(seniorChecksOf(out)).toEqual({ ...NO, internalSource: true });
    }
    // Dayanaklı iç kaynak oyu hangi okumadan gelirse gelsin tutar.
    const grounded = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: { ...NO, internalSource: true } }, draftOnly: { admits: false, quote: "", checks: NO } });
    expect(seniorChecksOf(grounded)).toEqual({ ...NO, internalSource: true });
    // KONTROL: ödeme / iletişim / özürde misafir mesajlı okumanın dayanaksız oyu tek başına da TUTAR (kural değişmedi).
    for (const k of ["payHost", "contact", "apology"] as const) {
      const out = combineAbsenceReadings({ withGuest: { admits: false, quote: "", checks: NO, ungroundedChecks: { [k]: true } }, draftOnly: { admits: false, quote: "", checks: NO } });
      expect([k, seniorChecksOf(out)?.[k]]).toEqual([k, true]);
    }
  });

  it("Rusça taslakta Latin sözcük varken saf Kiril alıntı kanıttır (benzer harf sökümü iki tarafa birlikte — Haiku 10-22)", () => {
    expect(quoteGroundedIn("Wi-Fi: Нет информации о парковке.", "Нет информации о парковке")).toBe(true);
    expect(quoteGroundedIn("Нет информации о парковке.", "Нет информации о парковке")).toBe(true);
    expect(quoteGroundedIn("Wi-Fi: Нет информации о парковке.", "Нет информации о бассейне")).toBe(false);
  });

  it("istem: bir konuya hiç değinmemek itiraf değildir", () => {
    expect(ABSENCE_JUDGE_SYSTEM_PROMPT).toMatch(/Silence about a topic is NOT an admission/);
  });
});

describe("yeniden yazma birleştirmesi (Opus 10-22 F1)", () => {
  const first = {
    reply: "Üzgünüz, sorun için. Çıkış 11:00.",
    intent: "complaint",
    riskLevel: "medium",
    riskType: "complaint" as string | null,
    confidence: 0.9,
    priority: "standard",
    usedSources: ["kb:checkout"],
    missingInfo: [],
    claimAudit: { u: 0 },
    answeredRequests: { ok: true, refs: ["R1"] },
    stayChange: { asked: "late_checkout", stance: "defers" },
  };
  const retried = {
    ...first,
    reply: "Çıkış saati 11:00.",
    intent: "checkout_info",
    riskLevel: "low",
    riskType: null,
    confidence: 0.95,
    usedSources: ["kb:checkout", "property:checkOutTime"],
    claimAudit: { u: 1 },
    answeredRequests: { ok: true, refs: ["R2"] },
    stayChange: { asked: "none", stance: "none" },
  };

  it("metin ve metne bağlı alanlar yeni çağrıdan; niyet / risk / öncelik ilk çağrıdan; güven küçüğü", () => {
    const m = mergeSeniorRewrite(first, retried);
    expect(m.reply).toBe("Çıkış saati 11:00.");
    expect(m.usedSources).toEqual(["kb:checkout", "property:checkOutTime"]);
    expect(m.claimAudit).toEqual({ u: 1 });
    expect(m.answeredRequests).toEqual({ ok: true, refs: ["R2"] });
    expect(m.intent).toBe("complaint");
    expect(m.riskLevel).toBe("medium");
    expect(m.riskType).toBe("complaint");
    expect(m.priority).toBe("standard");
    expect(m.confidence).toBe(0.9);
    // Konaklama: istek mesajdan (ilk), tutum metinden (yeni).
    expect(m.stayChange).toEqual({ asked: "late_checkout", stance: "none" });
  });

  it("🚨 Haiku 10-23 akşam: iki çağrının kullanımı TOPLANIR (ilk çağrının — parça yeniden yazması dahil — maliyeti düşmez)", () => {
    type WithUsage = typeof first & { llmUsage?: unknown };
    const m = mergeSeniorRewrite<WithUsage>({ ...first, llmUsage: { pt: 1000, ct: 100, m: "x" } }, { ...retried, llmUsage: { pt: 900, ct: 80, rt: 5 } });
    expect(m.llmUsage).toEqual({ pt: 1900, ct: 180, rt: 5, m: "x" });
    expect(mergeSeniorRewrite<WithUsage>(first, { ...retried, llmUsage: { pt: 1 } }).llmUsage).toEqual({ pt: 1 });
  });

  it("🚨 4.12: doğrulanmış parça işareti YENİ çağrıdan (ilk taslağın işareti yeniden yazılmış metne taşınmaz)", () => {
    type W = typeof first & { verifiedPartsOnly?: true };
    expect("verifiedPartsOnly" in mergeSeniorRewrite<W>({ ...first, verifiedPartsOnly: true }, retried)).toBe(false);
    expect(mergeSeniorRewrite<W>(first, { ...retried, verifiedPartsOnly: true }).verifiedPartsOnly).toBe(true);
  });

  it("🚨 GD7 (gece döngüsü 10-29): 'yalnız ev sahibine başvurma talimatı' işareti METNE aittir — yeni çağrıdan alınır", () => {
    type W = typeof first & { hostContactOnly?: true };
    // Yeni metin yalnız "ev sahibinize yazın"dan ibaret → işaret taşınmazsa kapı tutmaz, cümle misafire gider.
    expect(mergeSeniorRewrite<W>(first, { ...retried, hostContactOnly: true }).hostContactOnly).toBe(true);
    // İlk taslağın işareti yeniden yazılmış (içerikli) metne taşınmaz.
    expect("hostContactOnly" in mergeSeniorRewrite<W>({ ...first, hostContactOnly: true }, retried)).toBe(false);
  });

  it("cevap parçaları kipinde (10-23 A) parça kararları yeni çağrıdan; kip dışında alan hiç yok", () => {
    const m = mergeSeniorRewrite(
      { ...first, answerParts: [{ ref: "R1", status: "verified", source: "kb:1" }] },
      { ...retried, answerParts: [{ ref: "R1", status: "no_info" }] },
    );
    expect(m.answerParts).toEqual([{ ref: "R1", status: "no_info" }]);
    expect("answerParts" in mergeSeniorRewrite(first, retried)).toBe(false);
  });

  it("yalnız okuyucunun düzeltilebilir sebepleri yeniden yazdırır", () => {
    // Kurucu 10-30 ("mesajı ev sahibi yazıyor"): ses ihlali (`reply_host_voice`) de düzeltilebilir — ev sahibinin ağzından bir kez yeniden yazılır.
    expect([...SENIOR_REWRITE_GATE_DETAILS].sort()).toEqual([
      "reply_apology",
      "reply_host_voice",
      "reply_internal_source",
      "reply_offplatform_contact",
      "reply_offplatform_payment",
    ]);
    expect([...SENIOR_REWRITE_QR_REASONS].sort()).toEqual(["offplatform_payment", "reply_apology", "reply_host_voice", "reply_internal_source"]);
    expect(SENIOR_REWRITE_GATE_DETAILS.has("reply_absence")).toBe(false);
  });
});

describe("boş bilgi tabanında kodun notları (Opus 10-22 F2)", () => {
  it("not varsa istemde görünür; not yoksa metin bayt bayt eskisi", () => {
    expect(packKnowledgeBase([], 0, "all", []).text).toBe("(bilgi tabanı boş — bu mülk için kayıtlı bilgi yok)");
    const withNote = packKnowledgeBase([], 0, "all", ["Önceki taslak özür içeriyordu."]).text;
    expect(withNote).toContain("(bilgi tabanı boş");
    expect(withNote).toContain("- [NOT] Önceki taslak özür içeriyordu.");
  });
});
