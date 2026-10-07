import { describe, it, expect } from "vitest";
import { checkDecisionText, decisionTextProblemsTr, type DecisionTextFacts } from "@/lib/decisions/text-check";
import { DECISION_LANGS, decisionMessageText, type DecisionKind, type DecisionResolution } from "@/lib/decisions/core";

// Sabah Kararları 62 h (kurucu 10-07): yapay zekâ karar mesajını yazar, KOD doğrular — saat, gün ve ücret karar kaydıyla eşleşmezse
// mesaj gitmez (ev sahibine uyarı + "Yine de gönder"). Onaylı 7 dil şablonu denetimden HER ZAMAN temiz geçer (yedek ve zemin).

const base: DecisionTextFacts = {
  kind: "early_checkin",
  resolution: "approve",
  lang: "tr",
  dayKey: "2026-10-14",
  time: "13:00",
  requestedTime: "13:00",
  standardTime: "15:00",
  fee: null,
  note: null,
  checklist: ["Önceki misafirin beklenen çıkışı: 11:00", "Çıkış temizliği henüz bitmedi."],
};

const f = (over: Partial<DecisionTextFacts>): DecisionTextFacts => ({ ...base, ...over });

describe("karar mesajı denetimi — onaylı şablonlar her zaman geçer", () => {
  const kinds: DecisionKind[] = ["early_checkin", "late_checkout"];
  const resolutions: DecisionResolution[] = ["approve", "decline"];
  for (const lang of DECISION_LANGS) {
    for (const kind of kinds) {
      for (const resolution of resolutions) {
        for (const fee of [null, { amount: 500, currency: "TRY" }, { amount: 25.5, currency: "EUR" }]) {
          it(`${lang} · ${kind} · ${resolution} · ücret ${fee ? fee.amount : "yok"}`, () => {
            const facts = f({
              kind,
              resolution,
              lang,
              fee,
              time: kind === "early_checkin" ? "13:00" : "13:30",
              requestedTime: kind === "early_checkin" ? "12:00" : "14:00",
              standardTime: kind === "early_checkin" ? "15:00" : "11:00",
              note: kind === "early_checkin" ? "Anahtar kutusu girişin solunda." : null,
            });
            const text = decisionMessageText(facts);
            expect(text).not.toBeNull();
            expect(checkDecisionText(text, facts)).toEqual({ ok: true, problems: [], unknownTimes: [] });
          });
        }
      }
    }
  }
});

describe("karar mesajı denetimi — doğal, gerekçeli metin geçer", () => {
  it("ret: temizlik gerekçesi + standart saat", () => {
    const facts = f({ resolution: "decline" });
    const text = "Maalesef 14 Ekim'de saat 13:00'te temizlik henüz sürüyor olacak; daireniz standart giriş saati olan 15:00'te hazır olacak.";
    expect(checkDecisionText(text, facts).problems).toEqual([]);
  });
  it("ret: önceki misafirin çıkış saati (kontrol listesinden) söylenebilir", () => {
    const text = "Unfortunately an early check-in at 13:00 won't work on 14 October: the previous guest leaves at 11:00 and the apartment needs cleaning. Check-in is from 15:00.";
    expect(checkDecisionText(text, f({ resolution: "decline", lang: "en" })).problems).toEqual([]);
  });
  it("onay: farklı saatle onay, istenen saat de anılabilir", () => {
    const text = "Güzel haber: 13:00 yerine 14:00'te giriş yapabilirsiniz, 14 Ekim'de daireniz hazır olacak.";
    expect(checkDecisionText(text, f({ time: "14:00" })).problems).toEqual([]);
  });
  it("onay: kayıtlı ücretle", () => {
    const text = "İyi haber: 14 Ekim'de saat 13:00'ten itibaren giriş yapabilirsiniz. Erken giriş ücreti 500 TL.";
    expect(checkDecisionText(text, f({ fee: { amount: 500, currency: "TRY" } })).problems).toEqual([]);
  });
});

describe("karar mesajı denetimi — karar kaydıyla uyuşmayan metin tutulur", () => {
  it("onayda seçilen saat yok", () => {
    expect(checkDecisionText("Erken giriş talebiniz onaylandı, 14 Ekim'de bekliyoruz.", base).problems).toContain("time_missing");
  });
  it("karar kaydında olmayan saat", () => {
    const c = checkDecisionText("Erken giriş onaylandı: 14 Ekim'de 12:30'dan itibaren giriş yapabilirsiniz.", base);
    expect(c.problems).toContain("time_unknown");
    expect(c.unknownTimes).toEqual(["12:30"]);
    expect(decisionTextProblemsTr(c, base)[0]).toBe("Mesajda 12:30 yazıyor; seçtiğiniz saat 13:00.");
  });
  it("başka gün", () => {
    expect(checkDecisionText("Erken giriş onaylandı: 15 Ekim'de 13:00'ten itibaren giriş yapabilirsiniz.", base).problems).toContain("claim_unsupported");
  });
  it("kayıtlı ücretten farklı tutar", () => {
    const c = checkDecisionText("14 Ekim'de 13:00'ten itibaren giriş yapabilirsiniz; erken giriş ücreti 300 TL.", f({ fee: { amount: 500, currency: "TRY" } }));
    expect(c.problems).toContain("money_unknown");
    expect(c.problems).toContain("fee_missing");
  });
  it("ücretsiz sözü (kayıtlı ücret yokken de fiyat terimi)", () => {
    expect(checkDecisionText("14 Ekim'de 13:00'ten itibaren ücretsiz giriş yapabilirsiniz.", base).problems).toContain("money_unknown");
  });
  it("ücretli onayda ücret söylenmiyor", () => {
    expect(checkDecisionText("14 Ekim'de 13:00'ten itibaren giriş yapabilirsiniz.", f({ fee: { amount: 500, currency: "TRY" } })).problems).toEqual(["fee_missing"]);
  });
  it("kararı ev sahibine bırakan cümle", () => {
    expect(checkDecisionText("Erken giriş ev sahibinizin kararına bağlıdır.", f({ resolution: "decline" })).problems).toContain("defers");
  });
  it("makbuzsuz söz / devir", () => {
    expect(checkDecisionText("Talebinizi ev sahibine iletiyorum, size döneceğim.", f({ resolution: "decline" })).problems).toContain("promise_or_handoff");
  });
  it("misafirin dilinden başka dil", () => {
    expect(checkDecisionText("Unfortunately early check-in at 13:00 is not possible on 14 October.", f({ resolution: "decline" })).problems).toContain("language");
  });
  it("boş", () => {
    expect(checkDecisionText("  ", base).problems).toEqual(["empty"]);
  });
});
