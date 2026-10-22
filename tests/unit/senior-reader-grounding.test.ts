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
  ABSENCE_JUDGE_SYSTEM_PROMPT,
} from "@/lib/ai/semantic/absence-judge";
import { mergeSeniorRewrite, SENIOR_REWRITE_GATE_DETAILS, SENIOR_REWRITE_QR_REASONS } from "@/lib/ai/semantic/senior-rewrite";
import { packKnowledgeBase } from "@/lib/ai/prompts";

const DRAFT = "Merhaba [Misafir],\n\nÇöp konteynerleri binanın arka tarafında, otopark girişinin yanındadır; geri dönüşüm için mavi konteyneri kullanın.";
const NO = { payHost: false, contact: false, apology: false };

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
        checks: { payHost: true, contact: true, apology: false },
        checkQuotes: { payHost: "Ücreti bana nakit ödeyebilirsiniz.", contact: "mavi konteyneri kullanın", apology: "" },
      },
      DRAFT,
    );
    expect(r?.checks).toEqual({ payHost: false, contact: true, apology: false });
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

  it("yalnız okuyucunun düzeltilebilir sebepleri yeniden yazdırır", () => {
    expect([...SENIOR_REWRITE_GATE_DETAILS].sort()).toEqual([
      "reply_apology",
      "reply_offplatform_contact",
      "reply_offplatform_payment",
    ]);
    expect([...SENIOR_REWRITE_QR_REASONS].sort()).toEqual(["offplatform_payment", "reply_apology"]);
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
