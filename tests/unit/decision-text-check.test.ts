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
        for (const fee of [null, { amount: 500, currency: "TRY" }, { amount: 25.5, currency: "EUR" }, { amount: 25, currency: "USD" }, { amount: 20, currency: "GBP" }]) {
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
            // Yazıcı kipi (yapay zekâ taslağı) şablonu da hiç engellemez: şablonda yalnız kaydın kendi saatleri var.
            expect(checkDecisionText(text, facts, { writer: true })).toEqual({ ok: true, problems: [], unknownTimes: [] });
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
  it("\"bilgim yok\" itirafı", () => {
    expect(checkDecisionText("Maalesef 14 Ekim'de erken giriş mümkün değil; temizlik saati hakkında bilgim yok. Giriş 15:00.", f({ resolution: "decline" })).problems).toContain("absence");
  });
  it("aşırı uzun metin", () => {
    const long = `Maalesef 14 Ekim'de erken giriş mümkün değil; giriş 15:00. ${"Anlayışınız için teşekkür ederiz. ".repeat(40)}`;
    expect(checkDecisionText(long, f({ resolution: "decline" })).problems).toContain("too_long");
  });
  it("boş", () => {
    expect(checkDecisionText("  ", base).problems).toEqual(["empty"]);
  });
});

describe("karar mesajı denetimi — iç kontrol listesi metne kopyalanmaz (ölçüm 10-07, 5.1 d-12)", () => {
  it("İngilizce mesajın sonuna Türkçe iç satır eklenmiş → tutulur", () => {
    const facts = f({ resolution: "decline", lang: "en", requestedTime: "11:00" });
    const text = "Early check-in at 11:00 on 14 October is not possible; your check-in time will be from 15:00. Çıkış temizliği henüz bitmedi.";
    expect(checkDecisionText(text, facts).problems).toContain("internal_copy");
  });
  it("saatli satırın gövdesi ('Önceki misafirin beklenen çıkışı') → tutulur", () => {
    const text = "Maalesef 14 Ekim'de erken giriş mümkün değil; önceki misafirin beklenen çıkışı 11:00, giriş 15:00'te.";
    expect(checkDecisionText(text, f({ resolution: "decline" })).problems).toContain("internal_copy");
  });
  it("aynı bilgiyi kendi cümlesiyle söyleyen metin geçer", () => {
    const text = "Maalesef 14 Ekim'de erken giriş mümkün değil: önceki misafirimiz 11:00'de çıkıyor ve temizlik sürüyor olacak; giriş 15:00'te.";
    expect(checkDecisionText(text, f({ resolution: "decline" })).problems).toEqual([]);
  });
});

describe("yazıcı kipi — başka misafirin saati yapay zekâ taslağında geçmez (ölçüm 11-04, Haiku; istemin 10-07 kuralının kod karşılığı)", () => {
  // Önceki misafir 13:00'te çıkacak, misafir 12:00'de girmek istedi, ev sahibi reddetti.
  const decline = f({
    resolution: "decline",
    requestedTime: "12:00",
    checklist: ["Önceki misafirin beklenen çıkışı: 13:00", "Çıkış temizliği henüz bitmedi."],
  });

  it("🚨 önceki misafirin çıkış saati (yalnız kontrol listesinde) → other_guest_time; tanınmayan saat sayılmaz", () => {
    const text = "Maalesef 14 Ekim'de 12:00'de erken giriş mümkün değil; önceki misafirimiz 13:00'te çıkıyor. Giriş 15:00'te.";
    const c = checkDecisionText(text, decline, { writer: true });
    expect(c.problems).toEqual(["other_guest_time"]);
    expect(c.unknownTimes).toEqual([]);
  });

  it("🚨 başka dilde de (İngilizce / Almanca) aynı", () => {
    const en = f({ ...decline, lang: "en" });
    expect(checkDecisionText("Early check-in at 12:00 on 14 October is not possible: the previous guest only leaves at 13:00. Check-in is from 15:00.", en, { writer: true }).problems).toEqual(["other_guest_time"]);
    const de = f({ ...decline, lang: "de" });
    expect(checkDecisionText("Ein früher Check-in am 14. Oktober um 12:00 Uhr ist leider nicht möglich, da der vorherige Gast erst um 13:00 Uhr abreist. Check-in ab 15:00 Uhr.", de, { writer: true }).problems).toEqual(["other_guest_time"]);
  });

  it("🚨 aynı gün gelen misafirin onaylı erken girişi (geç çıkış reddi) → other_guest_time", () => {
    const late = f({
      kind: "late_checkout",
      resolution: "decline",
      lang: "en",
      requestedTime: "14:00",
      standardTime: "11:00",
      checklist: ["Standart çıkış saatiniz: 11:00", "Aynı gün gelen misafire 13:00 erken giriş onaylandı — çıkış ve temizlik bu saatten önce bitmeli."],
    });
    const text = "A late check-out at 14:00 on 14 October is not possible, as the next guest arrives at 13:00. Check-out is by 11:00.";
    expect(checkDecisionText(text, late, { writer: true }).problems).toEqual(["other_guest_time"]);
  });

  it("KONTROL: aynı gerekçe SAATSİZ geçer; ev sahibinin kendi metninde saat de geçer (gönderim denetimi bugünkü gibi)", () => {
    const own = "Maalesef 14 Ekim'de 12:00'de erken giriş mümkün değil; önceki misafirimiz o saatte henüz çıkmamış olacak. Giriş 15:00'te.";
    expect(checkDecisionText(own, decline, { writer: true }).problems).toEqual([]);
    const withTime = "Maalesef 14 Ekim'de 12:00'de erken giriş mümkün değil; önceki misafirimiz 13:00'te çıkıyor. Giriş 15:00'te.";
    expect(checkDecisionText(withTime, decline).problems).toEqual([]);
  });

  it("KONTROL: hiçbir yerde olmayan saat yazıcı kipinde de 'tanınmayan saat' (ev sahibine gösterilen liste)", () => {
    const c = checkDecisionText("Maalesef 14 Ekim'de 12:00'de erken giriş mümkün değil; 14:30'da girebilirsiniz.", decline, { writer: true });
    expect(c.problems).toContain("time_unknown");
    expect(c.problems).not.toContain("other_guest_time");
    expect(c.unknownTimes).toEqual(["14:30"]);
  });

  it("KONTROL: ev sahibinin notundaki saat yazıcı kipinde de geçer (not kodla eklenir)", () => {
    const facts = f({ note: "Anahtar 12:30'dan sonra kutuda olacak." });
    const text = `Erken giriş talebiniz onaylandı: 14 Ekim'de 13:00'ten itibaren giriş yapabilirsiniz. ${facts.note}`;
    expect(checkDecisionText(text, facts, { writer: true }).problems).toEqual([]);
  });

  it("bilinen sınır (pinli): kontrol listesinin saati kaydın kendi saatiyle AYNIYSA ayırt edilemez → geçer", () => {
    const same = f({ resolution: "decline", requestedTime: "13:00", checklist: ["Önceki misafirin beklenen çıkışı: 13:00"] });
    const text = "Maalesef 14 Ekim'de 13:00'te erken giriş mümkün değil; önceki misafirimiz 13:00'te çıkıyor. Giriş 15:00'te.";
    expect(checkDecisionText(text, same, { writer: true }).problems).toEqual([]);
  });

  it("ev sahibine gösterilen sade satır (teknik açıklama yok)", () => {
    const c = checkDecisionText("Early check-in at 12:00 is not possible on 14 October: the previous guest leaves at 13:00. Check-in is from 15:00.", f({ ...decline, lang: "en" }), { writer: true });
    expect(decisionTextProblemsTr(c, decline)).toEqual(["Mesajda başka bir misafirin saati geçiyor."]);
  });
});

describe("para sözlüğü — Intl'in ön ekli dolar / sterlin yazımı (ölçüm 10-07: onaylı USD şablonu denetimden düşüyordu)", () => {
  it.each([
    ["The early check-in fee is US$25.", 25, "USD"],
    ["La tarifa por entrada anticipada es de 15 US$.", 15, "USD"],
    ["رسوم تسجيل الدخول المبكر ‏25 UK£.", 25, "GBP"],
    ["The fee is UK£20.", 20, "GBP"],
  ])("%s", async (text, amount, currency) => {
    const { moneyAmountsOf } = await import("@/lib/ai/stay-money");
    expect(moneyAmountsOf(text)).toEqual([{ amount, currency }]);
  });
});

describe("karar mesajı denetimi — mutasyon pinleri (10-07)", () => {
  it("iç satırın SAATSİZ gövdesi de kopya sayılır (satırın tamamı geçmese de)", () => {
    const text = "Maalesef 14 Ekim'de erken giriş mümkün değil; önceki misafirin beklenen çıkışı saat 11'de, giriş 15:00'te.";
    expect(checkDecisionText(text, f({ resolution: "decline" })).problems).toContain("internal_copy");
  });
  it("ev sahibinin Türkçe notu İngilizce mesajda dil uyuşmazlığı sayılmaz", async () => {
    const { confidentLanguage } = await import("@/lib/ai/language-signal");
    const note = "Lütfen girişte kimliğinizi hazır bulundurun ve çıkışta anahtarı kutuya geri bırakın, teşekkür ederiz.";
    expect(confidentLanguage(note)).toBe("tr");
    const facts = f({ lang: "en", note });
    expect(checkDecisionText(decisionMessageText(facts), facts).problems).toEqual([]);
  });
  it("ev sahibinin notundaki fiyat ifadesi denetime takılmaz", () => {
    const note = "Uzun konaklamalarda %10 indirim uygulanır.";
    const facts = f({ fee: { amount: 500, currency: "TRY" }, note });
    expect(checkDecisionText(decisionMessageText(facts), facts).problems).toEqual([]);
  });
});
