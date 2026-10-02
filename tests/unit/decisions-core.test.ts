import { describe, it, expect } from "vitest";
import {
  DECISION_LANGS,
  decisionDayKey,
  decisionKindsOf,
  decisionLang,
  decisionMessageText,
  decisionTimeOptions,
  decisionTitle,
  effectiveDecisionStatus,
  formatDecisionDay,
  isOpenDecision,
  parseHostTime,
  requestedTimeOf,
  timeOnRightSide,
  type DecisionLang,
} from "@/lib/decisions/core";
import { defersDecisionToHost } from "@/lib/ai/availability-claims";
import { carriesHandoffNotice } from "@/lib/ai/output-veto";
import { namesPaymentMethod } from "@/lib/payment-method-guard";
import { confidentLanguage } from "@/lib/ai/language-signal";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — SAF ÇEKİRDEK (Faz 1, kurucu 10-02 akşam: "panelde 'karar bekliyor' kartı ve Onayla / Reddet düğmeleri").
// Kurucunun tarifi: "Saat 13:00'te giriş yapabilir miyiz?" → panelde "13:00 erken giriş — karar bekliyor" açık kalır; ev sahibi
// onaylayınca ya da reddedince talep sonuçlanır. Metni KOD kurar (model değil), misafirin dilinde, günü adlandırır.
// ---------------------------------------------------------------------------

describe("istek türü → kart türü (kapının birleşim kuralının çıktısı)", () => {
  it("erken giriş / geç çıkış / uzatma / tarih değişikliği kart açar; müsaitlik sorusu ve tanınmayan tür açmaz; sıra sabit, tekil", () => {
    expect(decisionKindsOf(new Set(["late_checkout", "early_checkin", "early_checkin"] as const))).toEqual(["early_checkin", "late_checkout"]);
    expect(decisionKindsOf(["extend", "date_change"])).toEqual(["extend_stay", "date_change"]);
    expect(decisionKindsOf(["availability", "unknown"])).toEqual([]);
  });
});

describe("istenen saat — tahmin yok", () => {
  it("modellerin anlaştığı saat; çelişkide BOŞ (ev sahibi seçer)", () => {
    expect(requestedTimeOf(["13:00", "13:00"])).toBe("13:00");
    expect(requestedTimeOf(["13:00", null])).toBe("13:00");
    expect(requestedTimeOf(["13:00", "12:00"])).toBeNull();
    expect(requestedTimeOf(["9:30"])).toBe("09:30");
  });
  it("okuma yoksa misafirin yazdığı TEK, tek adaylı açık saat; iki adaylı ('2'de') ya da iki saat → boş", () => {
    expect(requestedTimeOf([], [[780]])).toBe("13:00");
    expect(requestedTimeOf([], [[120, 840]])).toBeNull();
    expect(requestedTimeOf([], [[780], [600]])).toBeNull();
    // Model okuması varken deterministik yedek KULLANILMAZ (çelişkili okumayı tahminle kapatmaz).
    expect(requestedTimeOf(["13:00", "12:00"], [[780]])).toBeNull();
  });
});

describe("hedef gün", () => {
  const r = { arrivalKey: "2026-10-14", departureKey: "2026-10-16" };
  it("erken giriş = varış; geç çıkış / uzatma = çıkış; tarih değişikliği / rezervasyonsuz = yok", () => {
    expect(decisionDayKey("early_checkin", r)).toBe("2026-10-14");
    expect(decisionDayKey("late_checkout", r)).toBe("2026-10-16");
    expect(decisionDayKey("extend_stay", r)).toBe("2026-10-16");
    expect(decisionDayKey("date_change", r)).toBeNull();
    expect(decisionDayKey("early_checkin", null)).toBeNull();
  });
});

describe("görünen durum — saklanmaz, türetilir", () => {
  const base = { hostRepliedAfter: false, reservationCancelled: false, dayKey: "2026-10-14", todayKey: "2026-10-14" };
  it("bekleyen kart: iptal > gün geçti > ev sahibi yazdı > bekliyor", () => {
    expect(effectiveDecisionStatus("pending", base)).toBe("pending");
    expect(effectiveDecisionStatus("pending", { ...base, hostRepliedAfter: true })).toBe("host_replied");
    expect(effectiveDecisionStatus("pending", { ...base, todayKey: "2026-10-15" })).toBe("expired");
    expect(effectiveDecisionStatus("pending", { ...base, todayKey: "2026-10-15", reservationCancelled: true })).toBe("cancelled");
    // Günü bilinmeyen kart gün yüzünden kapanmaz.
    expect(effectiveDecisionStatus("pending", { ...base, dayKey: null, todayKey: "2027-01-01" })).toBe("pending");
  });
  it("sonuçlanmış kart aynen kalır (ev sahibi sonradan yazsa da 'onaylandı' 'yanıtladınız' olmaz)", () => {
    for (const s of ["approved", "declined", "dismissed", "superseded", "resolved_by_policy", "sending"] as const) {
      expect(effectiveDecisionStatus(s, { ...base, hostRepliedAfter: true, reservationCancelled: true })).toBe(s);
    }
  });
  it("ev sahibinin işi: yalnız karar bekleyen ve gönderimi doğrulanamayan", () => {
    expect(isOpenDecision("pending")).toBe(true);
    expect(isOpenDecision("send_unverified")).toBe(true);
    for (const s of ["host_replied", "expired", "cancelled", "approved", "declined", "dismissed", "superseded", "sending"] as const) {
      expect(isOpenDecision(s), s).toBe(false);
    }
  });
});

describe("ev sahibinin saat girdisi", () => {
  it("yalnız geçerli SS:DD", () => {
    expect(parseHostTime("13:00")).toBe("13:00");
    expect(parseHostTime(" 9:05 ")).toBe("09:05");
    for (const bad of ["24:00", "13:60", "1300", "13", "", "abc", null, 13, "13:00:00", "13.00"]) {
      expect(parseHostTime(bad), String(bad)).toBeNull();
    }
  });
  it("standardın doğru tarafı: erken giriş öncesi, geç çıkış sonrası; bilinmeyen null", () => {
    expect(timeOnRightSide("early_checkin", "13:00", "15:00")).toBe(true);
    expect(timeOnRightSide("early_checkin", "15:00", "15:00")).toBe(false);
    expect(timeOnRightSide("late_checkout", "13:00", "11:00")).toBe(true);
    expect(timeOnRightSide("late_checkout", "10:00", "11:00")).toBe(false);
    expect(timeOnRightSide("extend_stay", "13:00", "11:00")).toBeNull();
    expect(timeOnRightSide("early_checkin", null, "15:00")).toBeNull();
  });
});

describe("kart başlığı (ev sahibi görünümü)", () => {
  it("'13:00 erken giriş'; saat yoksa 'saat belirtilmedi'; uzatmada saat yok", () => {
    expect(decisionTitle("early_checkin", "13:00")).toBe("13:00 erken giriş");
    expect(decisionTitle("late_checkout", null)).toBe("Geç çıkış — saat belirtilmedi");
    expect(decisionTitle("extend_stay", null)).toBe("Konaklamayı uzatma");
  });
});

describe("misafire giden karar metni — KODDA, misafirin dilinde, günü adlandırır", () => {
  const early = { kind: "early_checkin" as const, dayKey: "2026-10-14", time: "13:00", standardTime: "15:00" };
  const late = { kind: "late_checkout" as const, dayKey: "2026-10-16", time: "13:00", standardTime: "11:00" };

  it("Türkçe: onay / ret, erken giriş / geç çıkış (saate ek yazılmaz)", () => {
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr" })).toBe(
      "Erken giriş talebiniz onaylandı: 14 Ekim günü saat 13:00 itibarıyla giriş yapabilirsiniz.",
    );
    expect(decisionMessageText({ ...early, resolution: "decline", lang: "tr" })).toBe(
      "Maalesef 14 Ekim günü erken giriş mümkün olmayacak; giriş saatimiz 15:00.",
    );
    expect(decisionMessageText({ ...late, resolution: "approve", lang: "tr" })).toBe("Geç çıkış talebiniz onaylandı: 16 Ekim günü çıkış saatiniz 13:00.");
    expect(decisionMessageText({ ...late, resolution: "decline", lang: "tr" })).toBe(
      "Maalesef 16 Ekim günü geç çıkış mümkün olmayacak; çıkış saatimiz 11:00.",
    );
  });

  it("ücret YALNIZ erken giriş onayında ve kayıtlı kuraldan; not sona olduğu gibi; retde ücret / not yok", () => {
    const fee = { amount: 500, currency: "TRY" };
    const approve = decisionMessageText({ ...early, resolution: "approve", lang: "tr", fee, note: "Ödeme talebi platformdan gelecek." });
    expect(approve).toBe(
      "Erken giriş talebiniz onaylandı: 14 Ekim günü saat 13:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti ₺500. Ödeme talebi platformdan gelecek.",
    );
    expect(decisionMessageText({ ...early, resolution: "decline", lang: "tr", fee, note: "x" })).not.toMatch(/ücret|x$/);
    expect(decisionMessageText({ ...late, resolution: "approve", lang: "tr", fee })).not.toContain("₺");
    // Sıfır / geçersiz tutar söylenmez (uydurma "0 ₺" yok).
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr", fee: { amount: 0, currency: "TRY" } })).not.toContain("ücret");
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "en", fee: { amount: 25.5, currency: "EUR" } })).toContain("€25.50");
  });

  it("kurulamazsa null — tahminli metin önerilmez (saat / gün eksik, uzatma / tarih değişikliği)", () => {
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr", time: null })).toBeNull();
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr", time: "25:00" })).toBeNull();
    expect(decisionMessageText({ ...early, resolution: "decline", lang: "tr", standardTime: null })).toBeNull();
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr", dayKey: null })).toBeNull();
    expect(decisionMessageText({ ...early, resolution: "approve", lang: "tr", dayKey: "14-10-2026" })).toBeNull();
    expect(decisionMessageText({ kind: "extend_stay", resolution: "approve", lang: "tr", dayKey: "2026-10-16", time: "13:00", standardTime: "11:00" })).toBeNull();
    expect(decisionMessageText({ kind: "date_change", resolution: "decline", lang: "tr", dayKey: "2026-10-16", time: null, standardTime: "11:00" })).toBeNull();
  });

  it("yedi dilin hepsinde: günü ve saati taşır, kendi dilinde KESİN tanınır (dil kapısı), devir / erteleme / ödeme yöntemi sözü YOK", () => {
    for (const lang of DECISION_LANGS) {
      for (const [input, label] of [
        [{ ...early, resolution: "approve" as const }, "early approve"],
        [{ ...early, resolution: "decline" as const }, "early decline"],
        [{ ...late, resolution: "approve" as const }, "late approve"],
        [{ ...late, resolution: "decline" as const }, "late decline"],
      ] as const) {
        const text = decisionMessageText({ ...input, lang, fee: { amount: 300, currency: "TRY" } });
        const where = `${lang} ${label}: ${text}`;
        expect(text, where).toBeTruthy();
        expect(text!, where).toContain(input.resolution === "approve" ? input.time : input.standardTime);
        expect(text!, where).toContain(formatDecisionDay(input.dayKey, lang));
        // Karar METNİDİR: "kararı ev sahibiniz verir" / "mesajınız iletildi" gibi devir cümlesi değildir.
        expect(defersDecisionToHost(text!), where).toBe(false);
        expect(carriesHandoffNotice(text!), where).toBe(false);
        expect(namesPaymentMethod(text!), where).toBe(false);
        const detected = confidentLanguage(text!);
        if (detected) expect(detected, where).toBe(lang);
      }
    }
  });

  it("dil: yedi dil kendi kodu; tanınmayan / boş → İngilizce", () => {
    const all: DecisionLang[] = ["tr", "en", "de", "fr", "es", "ru", "ar"];
    for (const l of all) expect(decisionLang(l)).toBe(l);
    expect(decisionLang("EN-gb")).toBe("en");
    expect(decisionLang("it")).toBe("en");
    expect(decisionLang(null)).toBe("en");
  });

  it("gün biçimi hiçbir dilimde kaymaz, rakamlar Latin (Arapça dahil)", () => {
    expect(formatDecisionDay("2026-10-14", "tr")).toBe("14 Ekim");
    expect(formatDecisionDay("2026-10-14", "de")).toBe("14. Oktober");
    expect(formatDecisionDay("2026-10-14", "es")).toBe("14 de octubre");
    expect(formatDecisionDay("2026-10-14", "ar")).toMatch(/^14 /);
  });
});

describe("kartın saat seçenekleri (24 saat, 15 dk) — ABD biçimi '01:00 PM' yok", () => {
  it("erken giriş: 06:00 → standart girişten önceki son adım; geç çıkış: standart çıkıştan sonraki ilk adım → 23:45", () => {
    const early = decisionTimeOptions("early_checkin", "15:00", []);
    expect(early[0]).toBe("06:00");
    expect(early.at(-1)).toBe("14:45");
    expect(early).toContain("13:00");
    expect(early).not.toContain("15:00");
    expect(early.every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true);
    const late = decisionTimeOptions("late_checkout", "11:00", []);
    expect(late[0]).toBe("11:15");
    expect(late.at(-1)).toBe("23:45");
    expect(late).not.toContain("11:00");
    // Uzatma da çıkış tarafı.
    expect(decisionTimeOptions("extend_stay", "11:00", [])[0]).toBe("11:15");
  });

  it("misafirin istediği adım dışı / aralık dışı saat de listede (sıralı, tekil); geçersiz girdi eklenmez", () => {
    const opts = decisionTimeOptions("early_checkin", "15:00", ["13:20", "13:20", "9:05", "25:00", "abc", null]);
    expect(opts).toContain("13:20");
    expect(opts).toContain("09:05");
    expect(opts.filter((t) => t === "13:20")).toHaveLength(1);
    expect(opts).not.toContain("25:00");
    expect([...opts].sort()).toEqual(opts);
    // Yanlış taraftaki istenen saat de görünür (kart uyarır, gizlemez).
    expect(decisionTimeOptions("late_checkout", "11:00", ["10:00"])).toContain("10:00");
  });

  it("standart bilinmiyorsa makul varsayılan (giriş 15:00 / çıkış 11:00 varsayımı)", () => {
    expect(decisionTimeOptions("early_checkin", null, []).at(-1)).toBe("14:45");
    expect(decisionTimeOptions("late_checkout", "bozuk", [])[0]).toBe("11:15");
  });
});
