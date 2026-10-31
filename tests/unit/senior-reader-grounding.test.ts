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
  quoteGroundedIn,
  paymentHeldHolds,
  seniorChecksOf,
  ABSENCE_JUDGE_SYSTEM_PROMPT,
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
    const out = combineAbsenceReadings(
      { admits: false, quote: "", checks: NO, ungrounded: true },
      { admits: false, quote: "", checks: NO },
    );
    expect(out).toEqual({ status: "ok", admits: false, quote: "", checks: NO, ungrounded: true });
    expect(absenceHolds(false, out)).toBe(false); // çöp cevabı: kelime kuralı da itiraf görmüyor → gider
    expect(absenceHolds(true, out)).toBe(true); // kelime kuralı itiraf görüyorsa tutulur (bugünkü davranış)
    expect(judgeReleases(out)).toBe(false);
    // Dayanaklı itiraf her durumda tutar; iki okuma da "yok" derse serbest.
    expect(absenceHolds(false, combineAbsenceReadings({ admits: true, quote: "x", checks: NO }, { admits: false, quote: "", checks: NO }))).toBe(true);
    const clean = combineAbsenceReadings({ admits: false, quote: "", checks: NO }, { admits: false, quote: "", checks: NO });
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

  it("itirafta İKİ okuma da dayanaksız 'evet' derse geçerli, tek okumada kelime kuralına kalır (Opus 10-22 F1/F2)", () => {
    const both = combineAbsenceReadings(
      { admits: false, quote: "", checks: NO, ungrounded: true },
      { admits: false, quote: "", checks: NO, ungrounded: true },
    );
    expect(both).toMatchObject({ status: "ok", admits: true });
    expect(absenceHolds(false, both)).toBe(true);
  });

  it("ek hükümlerde dayanaksız 'evet' (tek okumada da) TUTAR — sessizce 'hayır'a dönmez (Haiku 10-22)", () => {
    const one = combineAbsenceReadings(
      { admits: false, quote: "", checks: NO, ungroundedChecks: { payHost: true, apology: true } },
      { admits: false, quote: "", checks: NO },
    );
    expect(one).toMatchObject({ status: "ok", admits: false, checks: NO, ungroundedChecks: { payHost: true, apology: true } });
    expect(seniorChecksOf(one)).toEqual({ payHost: true, contact: false, apology: true, internalSource: false });
    expect(paymentHeldHolds(false, seniorChecksOf(one))).toBe(true);
    // Dayanaksız oy yoksa okuyucunun "hayır"ı kelime kuralını ezer (T-d: üçüncü tarafa ödeme bilgisi gider).
    const clean = combineAbsenceReadings({ admits: false, quote: "", checks: NO }, { admits: false, quote: "", checks: NO });
    expect(seniorChecksOf(clean)).toEqual(NO);
    expect(paymentHeldHolds(true, seniorChecksOf(clean))).toBe(false);
    expect(paymentHeldHolds(true, undefined)).toBe(true);
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
