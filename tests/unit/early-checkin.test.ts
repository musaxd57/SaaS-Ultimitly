import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agreeRequestedTime,
  decideEarlyCheckin,
  EARLY_CHECKIN_AUTO_BLOCKERS,
  EARLY_CHECKIN_CHECKS,
  TIME_PASSED_GRACE_MINUTES,
  type EarlyCheckinFacts,
  type EarlyCheckinRule,
} from "@/lib/early-checkin/core";
import { earlyCheckinApprovalText, earlyCheckinLang, EARLY_CHECKIN_LANGS, formatEarlyCheckinDay, formatEarlyCheckinFee } from "@/lib/early-checkin/reply";
import { validateEarlyCheckinRuleInput } from "@/lib/early-checkin/rules";
import { parseFeeInput } from "@/lib/early-checkin/fee-input";
import { earlyCheckinPanelLines, type EarlyCheckinPanelData } from "@/lib/early-checkin/panel";
import { laterTime, READY_SETTLE_MS, readinessDetailOf, readinessOf, readyAtOf } from "@/lib/early-checkin/readiness";
import { earlyCheckinEvidenceOf, earlyCheckinHostNote, singleTopicEarlyCheckin } from "@/lib/early-checkin/workflow";
import { evaluateAvailability, stayRequestKinds } from "@/lib/ai/availability-claims";
import { verifiedEarlyCheckinResult } from "@/lib/automation";
import { buildKbEvidence } from "@/lib/ai/grounding";
import type { StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ (09-24, kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı; her şey doğrulanmışsa
// insana düşmemeli; eksik / çelişki / doğrulanamayan → insan"). Saf çekirdek + metin + kural + panel + kapı muafiyeti.
// ---------------------------------------------------------------------------

const RULE: EarlyCheckinRule = { mode: "auto", earliest: "12:00", fee: { amount: 30, currency: "EUR" }, note: null };
/** Onaylanabilir temel durum: bugün varış, önceki misafir 11:00'de çıktı, temizlik bitti, iki model 12:00 okudu. */
const OK: EarlyCheckinFacts = {
  standardCheckIn: "15:00",
  reservation: { status: "confirmed", arrivalKey: "2026-10-14" },
  todayKey: "2026-10-14",
  // 04:30 — varış günü, hiçbir istek saati henüz gelmedi (saat bilinmiyorsa otomatik gönderim olmaz: `clock_unknown`).
  nowMinutes: 4 * 60 + 30,
  previousSameDay: { checkoutTime: "11:00" },
  otherOverlaps: 0,
  readiness: "ready",
  previousNightVerifiedVacant: false,
  requested: { time: "12:00", sources: 2, conflict: false },
  singleIntent: true,
};

describe("karar çekirdeği — her kontrol ayrı, eksik ya da çelişki insana", () => {
  it("her şey doğrulanmış + kural otomatik → onaylanabilir ve OTOMATİK (insana düşmez)", () => {
    expect(decideEarlyCheckin(OK, RULE)).toEqual({ status: "approvable", failed: [], approvedTime: "12:00", fee: RULE.fee, autoSend: true });
  });

  it("aynı gün devir YOKSA dün gece kanıtla boş olmalı; kanıtlıysa onaylanabilir", () => {
    const vacant = { ...OK, previousSameDay: null, previousNightVerifiedVacant: true };
    expect(decideEarlyCheckin(vacant, RULE).status).toBe("approvable");
    expect(decideEarlyCheckin({ ...vacant, previousNightVerifiedVacant: false }, RULE).failed).toEqual(["previous_night_unverified"]);
  });

  it("🚨 her başarısız kontrol tek başına onayı düşürür (kapalı küme kodu ile); kanıt HENÜZ yoksa `pending`, host kararıysa `needs_host`", () => {
    const cases: [string, EarlyCheckinFacts, EarlyCheckinRule | null, string, "pending" | "needs_host"][] = [
      ["kural yok", OK, null, "rule_off", "needs_host"],
      ["kural kapalı", OK, { ...RULE, mode: "off" }, "rule_off", "needs_host"],
      ["rezervasyon yok", { ...OK, reservation: null }, RULE, "no_reservation", "needs_host"],
      ["onaylı değil", { ...OK, reservation: { status: "pending", arrivalKey: "2026-10-14" } }, RULE, "reservation_not_confirmed", "needs_host"],
      ["varış günü gelmedi", { ...OK, reservation: { status: "confirmed", arrivalKey: "2026-10-15" } }, RULE, "not_arrival_day", "pending"],
      ["varış günü geçti", { ...OK, reservation: { status: "confirmed", arrivalKey: "2026-10-13" } }, RULE, "arrival_passed", "needs_host"],
      ["saat bilinmiyor", { ...OK, requested: { time: null, sources: 0, conflict: false } }, RULE, "time_unknown", "needs_host"],
      ["iki model farklı saat", { ...OK, requested: { time: null, sources: 2, conflict: true } }, RULE, "time_conflict", "needs_host"],
      ["otomatik onay saatinden önce", { ...OK, requested: { time: "11:30", sources: 2, conflict: false } }, RULE, "before_window", "needs_host"],
      ["istenen saat geçti", { ...OK, nowMinutes: 12 * 60 + 16 }, RULE, "time_passed", "needs_host"],
      ["çakışan rezervasyon", { ...OK, otherOverlaps: 1 }, RULE, "overlap", "needs_host"],
      // Host "çıkıştan önce hazır" rızası YOKSA beklenen çıkışı hiçbir kanıt aşamaz → host; rıza varsa temizlikçiyi bekler.
      ["önceki misafirin beklenen çıkışı istenen saatten sonra", { ...OK, previousSameDay: { checkoutTime: "13:00" } }, RULE, "previous_still_in", "needs_host"],
      ["… host rızasıyla", { ...OK, previousSameDay: { checkoutTime: "13:00" } }, { ...RULE, readyBeforeCheckout: true }, "previous_still_in", "pending"],
      // Çıkış saati bilinmiyorsa hazırlık hiç ölçülemez → host (inceleme 09-24: "bekliyor" hiç gelmeyecek kanıtı beklemesin).
      ["önceki çıkış saati bilinmiyor", { ...OK, previousSameDay: { checkoutTime: null } }, RULE, "previous_checkout_unknown", "needs_host"],
      ["temizlik bitmedi", { ...OK, readiness: "not_ready" }, RULE, "not_ready", "pending"],
      ["temizlik görevi yok", { ...OK, readiness: "unknown" }, RULE, "ready_unknown", "pending"],
      ["devirde açık sorun görevi", { ...OK, openIssue: true }, RULE, "open_issue", "needs_host"],
      ["bavul isteği de var", { ...OK, luggage: true }, RULE, "luggage", "needs_host"],
      ["dün gece boş olduğu kanıtlanmadı", { ...OK, previousSameDay: null }, RULE, "previous_night_unverified", "needs_host"],
    ];
    for (const [name, facts, rule, code, status] of cases) {
      const d = decideEarlyCheckin(facts, rule);
      expect(d.status, name).toBe(status);
      expect(d.failed, name).toEqual([code]);
      expect(d.autoSend, name).toBe(false);
      expect(d.approvedTime, name).toBeNull();
    }
    // Kapalı kümenin her kodu bu tabloda ya da otomatik-gönderim tablosunda sınanır (yeni kod testsiz kalmasın).
    const covered = new Set([
      ...cases.map((c) => c[3]),
      "multi_intent",
      "single_source_time",
      "clock_unknown",
      "open_maintenance",
      "cleaning_note",
      ...EARLY_CHECKIN_AUTO_BLOCKERS,
    ]);
    expect([...EARLY_CHECKIN_CHECKS].filter((c) => !covered.has(c))).toEqual([]);
  });

  it("🚨 `pending` YALNIZ düşen kontrollerin HEPSİ 'kanıt henüz yok' türündense; biri host kararıysa `needs_host` (bilinmeyen asla 'hayır' değil)", () => {
    const consent = { ...RULE, readyBeforeCheckout: true };
    expect(decideEarlyCheckin({ ...OK, readiness: "not_ready", previousSameDay: { checkoutTime: "13:00" } }, consent)).toMatchObject({
      status: "pending",
      failed: ["previous_still_in", "not_ready"],
    });
    // Rıza yoksa aynı olgular host kararıdır (temizlik bitse de beklenen çıkış aşılamaz).
    expect(decideEarlyCheckin({ ...OK, readiness: "not_ready", previousSameDay: { checkoutTime: "13:00" } }, RULE).status).toBe("needs_host");
    // Hazırlık bekleniyor AMA kural kapalı → host (yeniden değerlendirilecek bir şey yok).
    expect(decideEarlyCheckin({ ...OK, readiness: "not_ready" }, { ...RULE, mode: "off" }).status).toBe("needs_host");
    expect(decideEarlyCheckin({ ...OK, readiness: "not_ready" }, null).status).toBe("needs_host");
    // Hazırlık bekleniyor AMA çakışma var → host.
    expect(decideEarlyCheckin({ ...OK, readiness: "unknown", otherOverlaps: 1 }, RULE)).toMatchObject({ status: "needs_host", failed: ["overlap", "ready_unknown"] });
    // Hiçbir durum otomatik RED değildir: kapalı kümede "reject" yok.
    for (const facts of [OK, { ...OK, readiness: "not_ready" as const }, { ...OK, otherOverlaps: 3 }, { ...OK, reservation: null }]) {
      expect(["approvable", "pending", "needs_host", "not_early"]).toContain(decideEarlyCheckin(facts, RULE).status);
    }
  });

  it("🚨 varış günü standart giriş saati GEÇTİYSE erken giriş penceresi kapanmıştır (onay üretilmez); saat bilinmiyorsa kontrol yapılmaz", () => {
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 15 * 60 }, RULE)).toMatchObject({ status: "not_early", autoSend: false, approvedTime: null });
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 14 * 60 + 59, requested: { time: "14:30", sources: 2, conflict: false } }, RULE)).toMatchObject({
      status: "needs_host",
      failed: ["time_passed"],
    });
    // Varış günü değilse "şimdi" standart girişi geçmiş olsa da (ertesi gün için soruyor) pencere kapanmaz.
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 16 * 60, reservation: { status: "confirmed", arrivalKey: "2026-10-15" } }, RULE)).toMatchObject({
      status: "pending",
      failed: ["not_arrival_day"],
    });
    // Saat okunamadıysa onaylanabilir kalır ama OTOMATİK gitmez (belirsizlik güvenli değildir; inceleme 09-24).
    expect(decideEarlyCheckin({ ...OK, nowMinutes: null }, RULE)).toMatchObject({ status: "approvable", autoSend: false, failed: ["clock_unknown"] });
    // Sonlu olmayan "şimdi" bilinmiyor sayılır (tahmin yok): ne "standart giriş geçti" ne "istenen saat geçti".
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(decideEarlyCheckin({ ...OK, nowMinutes: bad }, RULE), String(bad)).toMatchObject({ status: "approvable", failed: ["clock_unknown"] });
    }
  });

  it("istenen saat payı (15 dk): tam sınırda onaylanabilir, bir dakika sonra host", () => {
    expect(TIME_PASSED_GRACE_MINUTES).toBe(15);
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 12 * 60 + 15 }, RULE).status).toBe("approvable");
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 12 * 60 + 16 }, RULE).failed).toEqual(["time_passed"]);
    // Yalnız varış günü: gelecek gün için soran misafirin saati "geçmiş" sayılmaz.
    expect(decideEarlyCheckin({ ...OK, nowMinutes: 13 * 60, reservation: { status: "confirmed", arrivalKey: "2026-10-15" } }, RULE).failed).toEqual(["not_arrival_day"]);
  });

  it("🚨 kanıtlı erken hazırlık (`departureConfirmed`) önceki misafirin BEKLENEN çıkışını engel olmaktan çıkarır — hazırlık yine şart", () => {
    const early = { ...OK, requested: { time: "10:00", sources: 2, conflict: false }, previousSameDay: { checkoutTime: "11:00" } };
    const rule = { ...RULE, earliest: "09:00", readyBeforeCheckout: true };
    expect(decideEarlyCheckin(early, rule)).toMatchObject({ status: "pending", failed: ["previous_still_in"] });
    expect(decideEarlyCheckin({ ...early, departureConfirmed: true }, rule)).toMatchObject({ status: "approvable", approvedTime: "10:00", autoSend: true });
    // Çıkış saati bilinmese de kanıtlı erken hazırlık çıkışı doğrular.
    expect(decideEarlyCheckin({ ...early, previousSameDay: { checkoutTime: null }, departureConfirmed: true }, rule).status).toBe("approvable");
    // `departureConfirmed` hazırlığın YERİNE geçmez (tutarsız olgu): hazır değilse yine bekler.
    expect(decideEarlyCheckin({ ...early, departureConfirmed: true, readiness: "not_ready" }, rule)).toMatchObject({ status: "pending", failed: ["not_ready"] });
    // Aynı gün devir yoksa (dün gece) `departureConfirmed` gece kanıtını da atlatmaz.
    expect(decideEarlyCheckin({ ...early, previousSameDay: null, departureConfirmed: true }, rule).failed).toEqual(["previous_night_unverified"]);
  });

  it("🚨 mülkte açık bakım görevi / temizlikçinin bugünkü notu yalnız OTOMATİK gönderimi durdurur (host bakar)", () => {
    expect(decideEarlyCheckin({ ...OK, maintenanceOpen: true }, RULE)).toMatchObject({ status: "approvable", autoSend: false, failed: ["open_maintenance"] });
    expect(decideEarlyCheckin({ ...OK, cleaningNote: true }, RULE)).toMatchObject({ status: "approvable", autoSend: false, failed: ["cleaning_note"] });
    // Onaylanamayan kararda eklenmez (host zaten karar verir).
    expect(decideEarlyCheckin({ ...OK, readiness: "not_ready", maintenanceOpen: true, cleaningNote: true }, RULE).failed).toEqual(["not_ready"]);
  });

  it("🚨 otomatik-gönderim engelleri yalnız OTOMATİK gönderimi durdurur: onaylanabilir kalır (taslak), onaylanamayan kararda kod eklenmez", () => {
    for (const b of EARLY_CHECKIN_AUTO_BLOCKERS) {
      expect(decideEarlyCheckin({ ...OK, autoBlockers: [b] }, RULE), b).toMatchObject({ status: "approvable", failed: [b], autoSend: false, approvedTime: "12:00" });
      expect(decideEarlyCheckin({ ...OK, readiness: "not_ready", autoBlockers: [b] }, RULE).failed, b).toEqual(["not_ready"]);
    }
    expect(decideEarlyCheckin({ ...OK, autoBlockers: [] }, RULE).autoSend).toBe(true);
    // Sıra sabit: tek konu → tek kaynak → metin engelleri.
    expect(
      decideEarlyCheckin({ ...OK, singleIntent: false, requested: { time: "12:00", sources: 1, conflict: false }, autoBlockers: ["time_mismatch_text", "day_unverified"] }, RULE).failed,
    ).toEqual(["single_source_time", "multi_intent", "day_unverified", "time_mismatch_text"]);
  });

  it("onaylanabilir ama OTOMATİK değil: kural 'taslak', saati tek model okudu ya da mesajda başka konu var → host'a hazır taslak", () => {
    expect(decideEarlyCheckin(OK, { ...RULE, mode: "draft" })).toMatchObject({ status: "approvable", autoSend: false, failed: [] });
    expect(decideEarlyCheckin({ ...OK, requested: { time: "12:00", sources: 1, conflict: false } }, RULE)).toMatchObject({
      status: "approvable",
      autoSend: false,
      failed: ["single_source_time"],
    });
    expect(decideEarlyCheckin({ ...OK, singleIntent: false }, RULE)).toMatchObject({ status: "approvable", autoSend: false, failed: ["multi_intent"] });
  });

  it("standart girişten erken OLMAYAN saat erken giriş değildir (akış uygulanmaz)", () => {
    expect(decideEarlyCheckin({ ...OK, requested: { time: "15:00", sources: 2, conflict: false } }, RULE)).toMatchObject({ status: "not_early", autoSend: false });
    expect(decideEarlyCheckin({ ...OK, requested: { time: "16:30", sources: 2, conflict: false } }, RULE).status).toBe("not_early");
  });

  it("🚨 gece yarısından sonraki varış (05:00 öncesi) GEÇ varıştır, erken giriş değil — `isEarlierThanCheckIn` ile aynı eşik", () => {
    const at = (time: string) => decideEarlyCheckin({ ...OK, nowMinutes: 60, requested: { time, sources: 2, conflict: false } }, { ...RULE, earliest: "00:00" });
    expect(at("01:30")).toMatchObject({ status: "not_early", autoSend: false, approvedTime: null });
    expect(at("04:59").status).toBe("not_early");
    // Eşiğin hemen üstü erken giriştir (önceki misafirin beklenen çıkışı 11:00; rıza yok → host).
    expect(at("05:00")).toMatchObject({ status: "needs_host", failed: ["previous_still_in"] });
  });

  it("🚨 değişmez: herhangi bir başarısız kontrol varken otomatik gönderim ASLA yok (tüm tekli ve ikili bozulmalar)", () => {
    const breakers: ((f: EarlyCheckinFacts) => EarlyCheckinFacts)[] = [
      (f) => ({ ...f, reservation: null }),
      (f) => ({ ...f, todayKey: "2026-10-13" }),
      (f) => ({ ...f, requested: { time: null, sources: 0, conflict: false } }),
      (f) => ({ ...f, requested: { time: "10:00", sources: 2, conflict: false } }),
      (f) => ({ ...f, otherOverlaps: 2 }),
      (f) => ({ ...f, previousSameDay: { checkoutTime: "12:30" } }),
      (f) => ({ ...f, readiness: "not_ready" }),
      (f) => ({ ...f, readiness: "unknown" }),
      (f) => ({ ...f, singleIntent: false }),
      (f) => ({ ...f, requested: { time: "12:00", sources: 1, conflict: false } }),
    ];
    for (let i = 0; i < breakers.length; i++) {
      for (let j = i; j < breakers.length; j++) {
        const d = decideEarlyCheckin(breakers[j](breakers[i](OK)), RULE);
        expect(d.autoSend, `${i}/${j}`).toBe(false);
        expect(d.failed.length, `${i}/${j}`).toBeGreaterThan(0);
      }
    }
  });

  it("istenen saat: iki model aynıysa iki kaynak; biri yoksa tek; farklıysa ÇELİŞKİ (tahmin yok)", () => {
    expect(agreeRequestedTime(["12:00", "12:00"])).toEqual({ time: "12:00", sources: 2, conflict: false });
    expect(agreeRequestedTime(["9:30", undefined])).toEqual({ time: "09:30", sources: 1, conflict: false });
    expect(agreeRequestedTime(["12:00", "13:00"])).toEqual({ time: null, sources: 2, conflict: true });
    expect(agreeRequestedTime([null, "saat 12"])).toEqual({ time: null, sources: 0, conflict: false });
  });
});

describe("onay metni — KODDA, yalnız doğrulanmış veri + host'un kayıtlı kuralı", () => {
  const approvable = decideEarlyCheckin(OK, RULE);

  it("altı dilde GÜN + saat + ücret, selamsız; Arapçada Latin rakamlar; tanınmayan dil → İngilizce", () => {
    for (const lang of EARLY_CHECKIN_LANGS) {
      const t = earlyCheckinApprovalText(approvable, lang, null, "2026-10-14");
      expect(t, lang).toContain("12:00");
      expect(t, lang).toContain("14");
      expect(t, lang).toContain("30");
      expect(t ?? "", lang).not.toMatch(/[٠-٩۰-۹]/);
      expect(t ?? "", lang).not.toMatch(/^(?:Merhaba|Hello|Hallo|Bonjour|مرحب|Здравствуйте)/);
    }
    expect(earlyCheckinLang("pt")).toBe("en");
    expect(earlyCheckinLang("TR")).toBe("tr");
    expect(earlyCheckinLang("de-DE")).toBe("de");
    expect(earlyCheckinLang(null)).toBe("en");
    expect(earlyCheckinApprovalText(approvable, "tr", null, "2026-10-14")).toBe(
      "Daireniz hazır; bugün (14 Ekim) saat 12:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti €30.",
    );
  });

  it("ücretsiz kuralda ücret cümlesi YOK; host notu en sona olduğu gibi eklenir", () => {
    const free = decideEarlyCheckin(OK, { ...RULE, fee: null });
    expect(earlyCheckinApprovalText(free, "en", "Please message us when you arrive.", "2026-10-14")).toBe(
      "The apartment is ready — you can check in today (14 October) from 12:00. Please message us when you arrive.",
    );
  });

  it("onaylanabilir DEĞİLSE metin YOK (çağıran insan akışına döner)", () => {
    expect(earlyCheckinApprovalText(decideEarlyCheckin({ ...OK, readiness: "not_ready" }, RULE), "tr", null, "2026-10-14")).toBeNull();
    expect(earlyCheckinApprovalText(decideEarlyCheckin({ ...OK, requested: { time: "15:00", sources: 2, conflict: false } }, RULE), "tr", null, "2026-10-14")).toBeNull();
  });

  it("ücret ve gün biçimi dile göre (Türkçede virgül ondalık, binlik nokta)", () => {
    expect(formatEarlyCheckinFee({ amount: 500, currency: "TRY" }, "tr")).toBe("₺500");
    expect(formatEarlyCheckinFee({ amount: 1500, currency: "TRY" }, "tr")).toBe("₺1.500");
    expect(formatEarlyCheckinFee({ amount: 12.5, currency: "EUR" }, "tr")).toBe("€12,50");
    expect(formatEarlyCheckinFee({ amount: 12.5, currency: "EUR" }, "en")).toBe("€12.50");
    expect(formatEarlyCheckinDay("2026-10-14", "tr")).toBe("14 Ekim");
    expect(formatEarlyCheckinDay("2026-10-14", "de")).toBe("14. Oktober");
  });
});

describe("kural doğrulama — host verisi misafire gider, süzgeçten geçer", () => {
  it("geçerli kural temizlenir; ek alanlar yok sayılır", () => {
    expect(validateEarlyCheckinRuleInput({ mode: "auto", earliest: "9:30", fee: { amount: 20, currency: "TRY" }, note: "  Hoş geldiniz  ", x: 1 })).toEqual({
      mode: "auto",
      earliest: "09:30",
      fee: { amount: 20, currency: "TRY" },
      note: "Hoş geldiniz",
    });
    expect(validateEarlyCheckinRuleInput({ mode: "off", earliest: "12:00", fee: null, note: "" })).toEqual({ mode: "off", earliest: "12:00", fee: null, note: null });
  });

  it("iki haneli küsurlu ücret kabul edilir (kayan nokta: 19.99 × 100 = 1998.999… — ilk sürüm reddediyordu)", () => {
    for (const amount of [19.99, 9.95, 1.1, 4.35, 12.5]) {
      expect(validateEarlyCheckinRuleInput({ mode: "auto", earliest: "12:00", fee: { amount, currency: "EUR" }, note: null })?.fee, String(amount)).toEqual({ amount, currency: "EUR" });
    }
  });

  it("🚨 geçersiz değerler REDDEDİLİR (kip, saat, ücret, para birimi, not)", () => {
    const base = { mode: "auto", earliest: "12:00", fee: null, note: null };
    for (const bad of [
      null,
      [],
      { ...base, mode: "always" },
      { ...base, earliest: "25:00" },
      { ...base, earliest: "noon" },
      { ...base, fee: { amount: 0, currency: "EUR" } },
      { ...base, fee: { amount: -5, currency: "EUR" } },
      { ...base, fee: { amount: 10001, currency: "EUR" } },
      { ...base, fee: { amount: 1.234, currency: "EUR" } },
      { ...base, fee: { amount: 0.001, currency: "EUR" } },
      { ...base, fee: { amount: "20", currency: "EUR" } },
      { ...base, fee: { amount: 20, currency: "BTC" } },
      { ...base, note: "x".repeat(201) },
      { ...base, note: "Ödemeyi IBAN ile yapın" },
      { ...base, note: "Pay cash at the door" },
      { ...base, note: "See https://example.com" },
      { ...base, note: "{{guestName}} hoş geldiniz" },
      { ...base, note: 42 },
      // Otomatik cevabın çıktı vetosuna takılacak not kayıtta reddedilir (makbuzsuz "yaptım" iddiası).
      { ...base, note: "Taksinizi ayarladım." },
      { ...base, note: "I have arranged a taxi for you." },
    ]) {
      expect(validateEarlyCheckinRuleInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("para içeren formlar yalnız yöneticiye (kurucu: temizlik ücreti görmez)", () => {
  it("mülk sayfası erken giriş ve gecelik aralık formlarını YALNIZ `canManage` bloğunda çizer; kural personel için hiç okunmaz", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/(app)/properties/[id]/page.tsx"), "utf8");
    const gate = src.indexOf("{canManage ? (\n                <>");
    const end = src.indexOf(") : null}", gate);
    expect(gate).toBeGreaterThan(-1);
    for (const tag of ["<EarlyCheckinRuleForm", "<NightlyRateForm"]) {
      const at = src.indexOf(tag);
      expect(at, tag).toBeGreaterThan(gate);
      expect(at, tag).toBeLessThan(end);
      expect(src.split(tag).length - 1, tag).toBe(1);
    }
    expect(src).toContain("const earlyCheckinRule = canManage ? await loadEarlyCheckinRule(");
    expect(src).toContain("const nightlyRate = canManage ? await getNightlyRate(");
  });
});

describe("formun örnek notu", () => {
  it("doğrulamadan geçer — örnek, kaydedilince hata veren bir cümle öğretmesin (ilk sürümde 'göndereceğiz' reddediliyordu)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/properties/early-checkin-rule-form.tsx"), "utf8");
    const m = /placeholder="Örn\. ([^"]+)"/.exec(src);
    expect(m).not.toBeNull();
    const note = (m as RegExpExecArray)[1];
    expect(validateEarlyCheckinRuleInput({ mode: "auto", earliest: "12:00", fee: null, note })?.note).toBe(note);
  });
});

describe("hazırlık hükmü — tik, çıkıştan SONRA, en az 5 dk, geri alınmamış", () => {
  const checkout = new Date("2026-10-14T08:00:00Z"); // 11:00 İstanbul
  const now = new Date("2026-10-14T10:00:00Z");
  it("çıkıştan sonra atılmış ve oturmuş tik → hazır", () => {
    expect(readinessOf([{ status: "done", doneAt: new Date("2026-10-14T09:30:00Z") }], checkout, now)).toBe("ready");
  });
  it("🚨 çıkıştan ÖNCEKİ tik (dünkü devir), taze tik (<5 dk), açık görev → hazır DEĞİL; görev yok / zamansız tik → bilinmiyor", () => {
    expect(readinessOf([{ status: "done", doneAt: new Date("2026-10-14T07:59:00Z") }], checkout, now)).toBe("not_ready");
    expect(readinessOf([{ status: "done", doneAt: new Date(now.getTime() - READY_SETTLE_MS + 1000) }], checkout, now)).toBe("not_ready");
    expect(readinessOf([{ status: "in_progress", doneAt: null }], checkout, now)).toBe("not_ready");
    expect(readinessOf([], checkout, now)).toBe("unknown");
    expect(readinessOf([{ status: "done", doneAt: null }], checkout, now)).toBe("unknown");
    expect(readinessOf([{ status: "done", doneAt: new Date("2026-10-14T09:30:00Z") }], null, now)).toBe("unknown");
  });
  it("hazır hükmünü veren işaretin zamanı: yalnız hazırken, geçerli işaretlerin EN YENİSİ", () => {
    const a = new Date("2026-10-14T09:10:00Z");
    const b = new Date("2026-10-14T09:30:00Z");
    expect(readyAtOf([{ status: "done", doneAt: a }, { status: "done", doneAt: b }], checkout, now)).toEqual(b);
    // Çıkıştan önceki ve taze işaretler sayılmaz; yeniden açılan görev sayılmaz.
    expect(readyAtOf([{ status: "done", doneAt: new Date("2026-10-14T07:00:00Z") }], checkout, now)).toBeNull();
    expect(readyAtOf([{ status: "done", doneAt: new Date(now.getTime() - 60_000) }], checkout, now)).toBeNull();
    expect(readyAtOf([{ status: "todo", doneAt: b }], checkout, now)).toBeNull();
    expect(readyAtOf([{ status: "done", doneAt: b }], null, now)).toBeNull();
  });
  it("🚨 bu devirde AÇIK temizlik görevi varsa başka bir görevin 'bitti'si hazır yapmaz (inceleme 09-24, P1)", () => {
    const done = { status: "done", doneAt: new Date("2026-10-14T09:30:00Z") };
    expect(readinessOf([done, { status: "todo", doneAt: null }], checkout, now)).toBe("not_ready");
    expect(readinessDetailOf([done, { status: "in_progress", doneAt: null }], checkout, now)).toEqual({ status: "not_ready", note: "open", departureConfirmed: false });
    expect(readyAtOf([done, { status: "todo", doneAt: null }], checkout, now)).toBeNull();
    // Hepsi kapalı: biri çıkıştan önce (konaklama içi), biri sonra ve oturmuş → hazır.
    expect(readinessOf([{ status: "done", doneAt: new Date("2026-10-14T07:00:00Z") }, done], checkout, now)).toBe("ready");
  });
  it("hazır değilse NEDEN: açık · taze · çıkıştan önce · zamansız · görev yok", () => {
    expect(readinessDetailOf([{ status: "todo", doneAt: null }], checkout, now).note).toBe("open");
    expect(readinessDetailOf([{ status: "done", doneAt: new Date(now.getTime() - 60_000) }], checkout, now).note).toBe("fresh");
    expect(readinessDetailOf([{ status: "done", doneAt: new Date("2026-10-14T07:00:00Z") }], checkout, now).note).toBe("before_checkout");
    expect(readinessDetailOf([{ status: "done", doneAt: null }], checkout, now)).toEqual({ status: "unknown", note: "no_time", departureConfirmed: false });
    expect(readinessDetailOf([], checkout, now)).toEqual({ status: "unknown", note: "none", departureConfirmed: false });
  });
  it("🚨 'bitti' işaretinden sonra görev yeniden AÇILDIYSA (host geri aldı) hazır DEĞİL", () => {
    expect(readinessOf([{ status: "todo", doneAt: new Date("2026-10-14T09:30:00Z") }], checkout, now)).toBe("not_ready");
    expect(readinessOf([{ status: "awaiting_review", doneAt: new Date("2026-10-14T09:30:00Z") }], checkout, now)).toBe("not_ready");
  });
  it("önceki çıkış: varsayılan ile misafirin bildirdiğinden GEÇ olanı (temkin)", () => {
    expect(laterTime("10:00", "11:00")).toBe("11:00");
    expect(laterTime("13:00", "11:00")).toBe("13:00");
    expect(laterTime(null, "11:00")).toBe("11:00");
    expect(laterTime("bozuk", null)).toBeNull();
  });
});

describe("istek türü birleşimi + kapı muafiyeti — yalnız KODDAN kurulan metin, yalnız TEK tür erken giriş", () => {
  const STAY = { checkIn: "15:00", checkOut: "11:00" };
  const verdict = (over: Partial<StayGuardVerdict> = {}): StayGuardVerdict => ({
    guestRequestsChange: true,
    kind: "early_checkin",
    requestedCheckinTime: "12:00",
    requestedCheckoutTime: null,
    replyStatesCalendar: false,
    replyGrantsChange: false,
    replyDefersToHost: false,
    replyRefuses: false,
    ...over,
  });

  it("türler tüm katmanlardan toplanır; belirsiz istek `unknown` olur", () => {
    expect([...stayRequestKinds(["Erken giriş yapabilir miyiz?"], {})]).toEqual(["early_checkin"]);
    const multi = stayRequestKinds(["Could we get in at 12?"], {
      declared: { asked: "early_checkin", stance: "none" },
      replyIntent: "late_checkout",
      guard: { status: "ok", verdict: verdict({ requestedCheckoutTime: "13:00" }) },
      stayTimes: STAY,
    });
    expect([...multi].sort()).toEqual(["early_checkin", "late_checkout"]);
    expect([...stayRequestKinds(["x"], { declared: { asked: "unknown", stance: "none" } })]).toEqual(["unknown"]);
    // Tür etiketi tek başına "yalnız erken giriş" dese de KODDA kaymış öteki saat ikinci türü ekler (iki yön).
    expect([...stayRequestKinds(["x"], { guard: { status: "ok", verdict: verdict({ requestedCheckoutTime: "13:00" }) }, stayTimes: STAY })].sort()).toEqual([
      "early_checkin",
      "late_checkout",
    ]);
    expect(
      [...stayRequestKinds(["x"], { understanding: { requested: true, kind: "late_checkout", checkinTime: "12:00", checkoutTime: null }, stayTimes: STAY })].sort(),
    ).toEqual(["early_checkin", "late_checkout"]);
    expect([...stayRequestKinds(["x"], { understanding: { requested: true, kind: "none", checkinTime: null, checkoutTime: null } })]).toEqual(["unknown"]);
    // Kelime ağı ÖNCELİKLİ tek türde durmaz (inceleme 09-24): aynı mesajdaki ikinci tür de birleşime girer.
    expect([...stayRequestKinds(["Could we check in early and also check out late?"], {})].sort()).toEqual(["early_checkin", "late_checkout"]);
  });

  it("🚨 muafiyet YALNIZ birebir aynı metin + tek tür erken giriş; başka her durumda metin izin/iddia sayılır", () => {
    const text = earlyCheckinApprovalText(decideEarlyCheckin(OK, RULE), "tr", null, "2026-10-14") as string;
    const base = { declared: { asked: "early_checkin" as const, stance: "none" as const }, guard: { status: "ok" as const, verdict: verdict() }, stayTimes: STAY };
    const ask = ["Saat 12'de gelebilir miyiz?"];
    expect(evaluateAvailability(text, ask, { ...base, verifiedGrant: { text } }).reason).toBeNull();
    // KONTROL: muafiyet olmadan aynı metin TUTULUR (hassas istek, iki model ertelemesi yok).
    expect(evaluateAvailability(text, ask, base).reason).toBe("availability_unconfirmed");
    // Metin tek karakter değişirse (model metni vb.) muafiyet YOK.
    expect(evaluateAvailability(`${text}!`, ask, { ...base, verifiedGrant: { text } }).reason).toBe("availability_unconfirmed");
    // Boş/eksik muafiyet nesnesi hiçbir şeyi açmaz.
    expect(evaluateAvailability(text, ask, { ...base, verifiedGrant: null }).reason).not.toBeNull();
    // Misafir geç çıkış da istiyorsa (tür birden çok) muafiyet YOK.
    expect(
      evaluateAvailability(text, ["Saat 12'de gelebilir miyiz? Geç çıkış da mümkün mü?"], { ...base, verifiedGrant: { text } }).reason,
    ).not.toBeNull();
    expect(evaluateAvailability(text, ask, { ...base, replyIntent: "late_checkout", verifiedGrant: { text } }).reason).not.toBeNull();
  });

  it("🚨 doğrulanmış sonuç: metin + niyet (early_checkin) değişir; GÜVEN, risk ve beyan AYNEN kalır (inceleme 09-24: güven 1'e çekilmez, insan talebi etiketi muafiyet taşımaz)", () => {
    const r = {
      intent: "complaint",
      riskLevel: "medium",
      riskType: "complaint",
      confidence: 0.5,
      reply: "model",
      usedSources: ["kb:x"],
      stayChange: { asked: "early_checkin", stance: "defers" },
      claimAudit: { total: 1 },
    };
    expect(verifiedEarlyCheckinResult(r, "şablon")).toEqual({ ...r, reply: "şablon", intent: "early_checkin", usedSources: [], claimAudit: undefined });
  });

  it("tek konu: anlama katmanı yalnız erken giriş (± giriş saati / selam) gördüyse", () => {
    const u = (...intents: string[]) => ({ requests: intents.map((intent) => ({ intent, queryTr: "q", queryOriginal: "q" })) }) as unknown as MessageUnderstanding;
    expect(singleTopicEarlyCheckin(u("early_checkin"))).toBe(true);
    expect(singleTopicEarlyCheckin(u("early_checkin", "greeting_thanks", "checkin_time"))).toBe(true);
    expect(singleTopicEarlyCheckin(u("early_checkin", "wifi"))).toBe(false);
    expect(singleTopicEarlyCheckin(u("checkin_time"))).toBe(false);
    expect(singleTopicEarlyCheckin(null)).toBe(false);
  });
});

describe("kanıt + host notu + panel", () => {
  it("`ec` kanıtı yalnız kapalı küme kodlar taşır; tanınmayan değer alanı düşürür", () => {
    const run = { decision: decideEarlyCheckin({ ...OK, readiness: "not_ready" }, RULE), rule: RULE, facts: OK, draft: null };
    const ec = earlyCheckinEvidenceOf(run, false);
    // Dayanak izi (trace) yoksa kimlik alanı yazılmaz; saati okuyan model sayısı her zaman (kanıt modeli U).
    expect(ec).toEqual({ s: "pending", f: ["not_ready"], a: "0", n: "2" });
    for (const s of ["approvable", "needs_host", "not_early"]) {
      expect(JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], earlyCheckin: { ...ec, s } }))).ec.s, s).toBe(s);
    }
    expect(JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], earlyCheckin: ec }))).ec).toEqual(ec);
    for (const bad of [{ ...ec, s: "maybe" }, { ...ec, f: ["Ayşe"] }, { ...ec, a: "yes" }]) {
      expect(buildKbEvidence({ retrieved: [], usedLabels: [], earlyCheckin: bad }), JSON.stringify(bad)).toBeNull();
    }
    expect([...EARLY_CHECKIN_CHECKS].length).toBe(new Set(EARLY_CHECKIN_CHECKS).size);
  });

  it("🚨 host notu yalnız onayda ve ÜCRET TUTARI TAŞIMAZ (görev geçmişini temizlik de görür)", () => {
    expect(earlyCheckinHostNote(decideEarlyCheckin(OK, RULE))).toBe("Erken giriş 12:00 otomatik onaylandı.");
    expect(earlyCheckinHostNote(decideEarlyCheckin({ ...OK, readiness: "unknown" }, RULE))).toBeNull();
  });

  it("panel: her kontrol bir satır; başarısız olan 'ok: false' ve ne yapılacağını söyler", () => {
    const decision = decideEarlyCheckin({ ...OK, readiness: "not_ready" }, { ...RULE, mode: "off" });
    const lines = earlyCheckinPanelLines({
      status: decision.status as "needs_host",
      failed: decision.failed,
      mode: "off",
      fee: RULE.fee,
      facts: { arrivalToday: true, requestedTime: "12:00", previousCheckout: "11:00", readiness: "not_ready", otherOverlaps: 0, previousNightVerifiedVacant: false },
    });
    expect(lines.find((l) => l.text.startsWith("Temizlik"))).toEqual({ ok: false, text: "Temizlik henüz bitti olarak işaretlenmedi." });
    expect(lines.some((l) => !l.ok && l.text.includes("kuralı kapalı"))).toBe(true);
    // Önceki çıkış bir BEKLENTİDİR (misafir erken çıkmış olabilir) — olgu gibi yazılmaz.
    expect(lines.find((l) => l.text.startsWith("Önceki misafir"))).toEqual({ ok: true, text: "Önceki misafirin beklenen çıkışı: 11:00" });
    expect(lines.find((l) => l.text.startsWith("Erken giriş ücreti"))?.text).toBe("Erken giriş ücreti: €30");
  });

  it("panel dürüstlüğü (inceleme 09-24): saati okuyamayınca 'net değil' demez; taze/erken işaret kendi nedeniyle; başka konu uyarısı", () => {
    const facts: EarlyCheckinPanelData["facts"] = {
      arrivalToday: true,
      requestedTime: null,
      previousCheckout: "11:00",
      readiness: "not_ready",
      otherOverlaps: 0,
      previousNightVerifiedVacant: false,
    };
    const text = (failed: string[], over: Partial<EarlyCheckinPanelData["facts"]> = {}) =>
      earlyCheckinPanelLines({ status: "needs_host", mode: "auto", fee: null, failed, facts: { ...facts, ...over } }).map((l) => l.text);
    expect(text(["time_unknown"])[0]).toBe("İstenen saati mesajdan kontrol edin.");
    expect(text(["time_conflict"])[0]).toMatch(/iki kontrolde farklı okundu/);
    expect(text(["not_ready"], { readinessNote: "fresh" })).toContain("Temizlik az önce bitti olarak işaretlendi; birkaç dakika içinde yeniden kontrol edilir.");
    expect(text(["not_ready"], { readinessNote: "before_checkout" })).toContain("Temizlik işareti önceki misafirin çıkışından önce atılmış; bu devir için sayılmaz.");
    expect(text(["ready_unknown"], { readiness: "unknown", readinessNote: "none" })).toContain("Bu devir için temizlik görevi bulunamadı.");
    expect(text(["multi_intent"], { readiness: "ready", requestedTime: "12:00" })).toContain("Mesajda başka bir istek ya da soru da var; hazır cevap yalnız erken girişi yanıtlar.");
  });
});

describe("ücret girişi (form) — Türkçe yazım", () => {
  it("binlik nokta, ondalık virgül; belirsiz / bozuk yazım 'invalid' (sessizce düşmez); boş = ücret yok", () => {
    expect(parseFeeInput("1.500")).toBe(1500);
    expect(parseFeeInput("12,50")).toBe(12.5);
    expect(parseFeeInput("12.5")).toBe(12.5);
    expect(parseFeeInput("1.500,50")).toBe(1500.5);
    expect(parseFeeInput(" ₺500 ")).toBe(500);
    expect(parseFeeInput("")).toBeNull();
    for (const bad of ["1,500", "abc", "0", "1.5.0", "1.2345", "12,345"]) expect(parseFeeInput(bad), bad).toBe("invalid");
  });
});
