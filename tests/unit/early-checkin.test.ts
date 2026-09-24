import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agreeRequestedTime,
  decideEarlyCheckin,
  EARLY_CHECKIN_CHECKS,
  type EarlyCheckinFacts,
  type EarlyCheckinRule,
} from "@/lib/early-checkin/core";
import { earlyCheckinApprovalText, earlyCheckinLang, EARLY_CHECKIN_LANGS, formatEarlyCheckinFee } from "@/lib/early-checkin/reply";
import { validateEarlyCheckinRuleInput } from "@/lib/early-checkin/rules";
import { earlyCheckinPanelLines } from "@/lib/early-checkin/panel";
import { laterTime, READY_SETTLE_MS, readinessOf, readyAtOf } from "@/lib/early-checkin/load";
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

  it("🚨 her başarısız kontrol tek başına onayı düşürür (kapalı küme kodu ile)", () => {
    const cases: [string, EarlyCheckinFacts, EarlyCheckinRule | null, string][] = [
      ["kural yok", OK, null, "rule_off"],
      ["kural kapalı", OK, { ...RULE, mode: "off" }, "rule_off"],
      ["rezervasyon yok", { ...OK, reservation: null }, RULE, "no_reservation"],
      ["onaylı değil", { ...OK, reservation: { status: "pending", arrivalKey: "2026-10-14" } }, RULE, "reservation_not_confirmed"],
      ["varış bugün değil", { ...OK, reservation: { status: "confirmed", arrivalKey: "2026-10-15" } }, RULE, "not_arrival_day"],
      ["saat bilinmiyor", { ...OK, requested: { time: null, sources: 0, conflict: false } }, RULE, "time_unknown"],
      ["iki model farklı saat", { ...OK, requested: { time: null, sources: 2, conflict: true } }, RULE, "time_conflict"],
      ["izin penceresinden önce", { ...OK, requested: { time: "11:30", sources: 2, conflict: false } }, RULE, "before_window"],
      ["çakışan rezervasyon", { ...OK, otherOverlaps: 1 }, RULE, "overlap"],
      ["önceki misafir hâlâ içeride", { ...OK, previousSameDay: { checkoutTime: "13:00" } }, RULE, "previous_still_in"],
      ["önceki çıkış saati bilinmiyor", { ...OK, previousSameDay: { checkoutTime: null } }, RULE, "previous_checkout_unknown"],
      ["temizlik bitmedi", { ...OK, readiness: "not_ready" }, RULE, "not_ready"],
      ["temizlik görevi yok", { ...OK, readiness: "unknown" }, RULE, "ready_unknown"],
    ];
    for (const [name, facts, rule, code] of cases) {
      const d = decideEarlyCheckin(facts, rule);
      expect(d.status, name).toBe("needs_host");
      expect(d.failed, name).toContain(code);
      expect(d.autoSend, name).toBe(false);
      expect(d.approvedTime, name).toBeNull();
    }
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
    const at = (time: string) => decideEarlyCheckin({ ...OK, requested: { time, sources: 2, conflict: false } }, { ...RULE, earliest: "00:00" });
    expect(at("01:30")).toMatchObject({ status: "not_early", autoSend: false, approvedTime: null });
    expect(at("04:59").status).toBe("not_early");
    // Eşiğin hemen üstü erken giriştir (önceki misafir 11:00'de çıktığı için burada dolu).
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

  it("altı dilde saat + ücret; Arapçada Latin rakamlar; tanınmayan dil → İngilizce", () => {
    for (const lang of EARLY_CHECKIN_LANGS) {
      const t = earlyCheckinApprovalText(approvable, lang, null);
      expect(t, lang).toContain("12:00");
      expect(t, lang).toContain("30");
      expect(t ?? "", lang).not.toMatch(/[٠-٩۰-۹]/);
    }
    expect(earlyCheckinLang("pt")).toBe("en");
    expect(earlyCheckinLang("TR")).toBe("tr");
    expect(earlyCheckinLang("de-DE")).toBe("de");
    expect(earlyCheckinLang(null)).toBe("en");
    expect(earlyCheckinApprovalText(approvable, "tr", null)).toBe("Merhaba, daireniz hazır; saat 12:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti €30.");
  });

  it("ücretsiz kuralda ücret cümlesi YOK; host notu en sona olduğu gibi eklenir", () => {
    const free = decideEarlyCheckin(OK, { ...RULE, fee: null });
    expect(earlyCheckinApprovalText(free, "en", "Please message us when you arrive.")).toBe(
      "Hello, the apartment is ready — you can check in from 12:00. Please message us when you arrive.",
    );
  });

  it("onaylanabilir DEĞİLSE metin YOK (çağıran insan akışına döner)", () => {
    expect(earlyCheckinApprovalText(decideEarlyCheckin({ ...OK, readiness: "not_ready" }, RULE), "tr", null)).toBeNull();
    expect(earlyCheckinApprovalText(decideEarlyCheckin({ ...OK, requested: { time: "15:00", sources: 2, conflict: false } }, RULE), "tr", null)).toBeNull();
  });

  it("ücret biçimi: tam sayıda kuruş yok, küsurda iki hane", () => {
    expect(formatEarlyCheckinFee({ amount: 500, currency: "TRY" }, "tr")).toMatch(/^₺?500(,00)? ?₺?$|500/);
    expect(formatEarlyCheckinFee({ amount: 12.5, currency: "EUR" }, "en")).toBe("€12.50");
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
  });

  it("🚨 muafiyet YALNIZ birebir aynı metin + tek tür erken giriş; başka her durumda metin izin/iddia sayılır", () => {
    const text = earlyCheckinApprovalText(decideEarlyCheckin(OK, RULE), "tr", null) as string;
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

  it("doğrulanmış sonuç yalnız metni, güveni ve kaynakları değiştirir; niyet / risk / beyan AYNEN kalır (kapının diğer kontrolleri koşsun)", () => {
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
    expect(verifiedEarlyCheckinResult(r, "şablon")).toEqual({ ...r, reply: "şablon", confidence: 1, usedSources: [], claimAudit: undefined });
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
    expect(ec).toEqual({ s: "needs_host", f: ["not_ready"], a: "0" });
    expect(JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], earlyCheckin: ec }))).ec).toEqual(ec);
    for (const bad of [{ ...ec, s: "maybe" }, { ...ec, f: ["Ayşe"] }, { ...ec, a: "yes" }]) {
      expect(buildKbEvidence({ retrieved: [], usedLabels: [], earlyCheckin: bad }), JSON.stringify(bad)).toBeNull();
    }
    expect([...EARLY_CHECKIN_CHECKS].length).toBe(new Set(EARLY_CHECKIN_CHECKS).size);
  });

  it("host notu yalnız onayda; ücret Türkçe biçimde", () => {
    expect(earlyCheckinHostNote(decideEarlyCheckin(OK, RULE))).toMatch(/^Erken giriş 12:00 otomatik onaylandı · ücret .*30.*\.$/);
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
    expect(lines.find((l) => l.text.startsWith("Önceki misafir"))?.ok).toBe(true);
  });
});
