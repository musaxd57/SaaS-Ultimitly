import { describe, it, expect } from "vitest";
import { earlyCheckinPolicyText, EARLY_CHECKIN_LANGS } from "@/lib/early-checkin/reply";
import { stayInfoOnly } from "@/lib/ai/availability-claims";
import { earlyCheckinPolicyAllowed } from "@/lib/early-checkin/workflow";
import type { StayGuardVerdict, UnderstandingStaySignal } from "@/lib/ai/semantic/stay-change";
import type { EarlyCheckinRule } from "@/lib/early-checkin/core";

// ---------------------------------------------------------------------------
// DİLİM 6 — BİLGİ SORUSU ("erken giriş ücretli mi?") → host kuralından KODDA kurulan POLİTİKA metni (kurucu senaryo
// 10: "policy/info flow, gereksiz inceleme yok"). Metin izin vermez, reddetmez, söz vermez; ücret YALNIZ kayıttan.
// Bilgi sorusu yalnız iki anlamsal katman KOŞUP "istek yok" dediğinde ve tek sinyal konu etiketiyken kanıtlanır.
// ---------------------------------------------------------------------------

const RULE: EarlyCheckinRule = { mode: "auto", earliest: "09:00", fee: { amount: 30, currency: "EUR" }, note: null };

describe("politika metni (kodda, altı dil)", () => {
  it("ücret kayıttan biçimlenir; karar söylenmez (izin / ret / söz yok); host notu EKLENMEZ", () => {
    expect(earlyCheckinPolicyText(RULE, "en")).toBe(
      "The early check-in fee is €30. Whether an early check-in is possible depends on that day's cleaning; your host decides.",
    );
    expect(earlyCheckinPolicyText(RULE, "tr")).toBe(
      "Erken giriş ücreti €30. Erken girişin mümkün olup olmadığı o günkü temizliğe bağlıdır; kararı ev sahibiniz verir.",
    );
    // Not ONAY için yazılır ("Ödeme talebi platformdan gelecek"); bilgi cevabında "ücretlendirileceksiniz" gibi okunur ve
    // birebir metin muafiyetiyle bir izin cümlesi ("12:00'den itibaren mümkündür") de taşıyabilirdi (inceleme 09-24).
    expect(earlyCheckinPolicyText({ ...RULE, note: "Erken giriş 12:00'den itibaren mümkündür." }, "tr")).toBe(
      "Erken giriş ücreti €30. Erken girişin mümkün olup olmadığı o günkü temizliğe bağlıdır; kararı ev sahibiniz verir.",
    );
    for (const lang of EARLY_CHECKIN_LANGS) {
      const t = earlyCheckinPolicyText(RULE, lang);
      expect(t, lang).toMatch(/30/);
      // İzin ya da onay cümlesi YOK (onay metninin "hazır / giriş yapabilirsiniz" kalıbı burada olmaz).
      expect(t, lang).not.toMatch(/ready|hazır|bereit|prêt|lista|готова|جاهزة|can check in|giriş yapabilirsiniz/i);
    }
  });

  it("🚨 kayıtlı ücret yoksa metin YOK — 'ücretsiz' de 'ücretli' de varsayılmaz (soru host'a kalır); kural yoksa da", () => {
    expect(earlyCheckinPolicyText({ ...RULE, fee: null }, "en")).toBeNull();
    expect(earlyCheckinPolicyText(null, "en")).toBeNull();
  });
});

describe("bilgi sorusu yüklemi — iki anlamsal katman koşup 'istek yok' demeli, tek sinyal konu etiketi", () => {
  const STAY = { checkIn: "15:00", checkOut: "11:00" };
  const nlu = (over: Partial<UnderstandingStaySignal> = {}): UnderstandingStaySignal => ({
    requested: false,
    kind: "none",
    checkinTime: null,
    checkoutTime: null,
    ...over,
  });
  const verdict = (over: Partial<StayGuardVerdict> = {}): StayGuardVerdict => ({
    guestRequestsChange: false,
    kind: "none",
    requestedCheckinTime: null,
    requestedCheckoutTime: null,
    replyStatesCalendar: false,
    replyGrantsChange: false,
    replyDefersToHost: false,
    replyRefuses: false,
    replyAmounts: [],
    replyPriceTerms: false,
    ...over,
  });
  const ASK = ["Early check-in ücretli mi?"];
  const base = {
    understanding: nlu(),
    guard: { status: "ok" as const, verdict: verdict() },
    declared: { asked: "none", stance: "none" } as const,
    replyIntent: "early_checkin",
    stayTimes: STAY,
  };

  it("KONTROL (anti-vakum): her katman 'istek yok', etiket erken giriş → bilgi sorusu", () => {
    expect(stayInfoOnly(ASK, base)).toBe(true);
  });

  it("🚨 bir katman bile istek görürse / katman yoksa / düştüyse bilgi sorusu DEĞİL", () => {
    const cases: [string, Record<string, unknown>, string[]?][] = [
      ["anlama kapalı", { understanding: null }],
      ["bekçi kapalı", { guard: undefined }],
      ["bekçi düştü", { guard: { status: "failed" } }],
      ["anlama: istek", { understanding: nlu({ requested: true }) }],
      ["anlama: tür", { understanding: nlu({ kind: "early_checkin" }) }],
      ["anlama: kaymış saat", { understanding: nlu({ checkinTime: "12:00" }) }],
      ["bekçi: istek", { guard: { status: "ok", verdict: verdict({ guestRequestsChange: true }) } }],
      ["bekçi: tür", { guard: { status: "ok", verdict: verdict({ kind: "early_checkin" }) } }],
      ["bekçi: ret", { guard: { status: "ok", verdict: verdict({ replyRefuses: true }) } }],
      ["bekçi: kaymış saat", { guard: { status: "ok", verdict: verdict({ requestedCheckinTime: "12:00" }) } }],
      ["beyan: istek", { declared: { asked: "early_checkin", stance: "none" } }],
      ["beyan: ret", { declared: { asked: "none", stance: "refuses" } }],
      ["etiket başka konu", { replyIntent: "late_checkout" }],
      ["etiket yok", { replyIntent: "general" }],
      ["kelime ağı: BAŞKA değişiklik (geç çıkış)", {}, ["Is early check-in paid? And can we check out late tomorrow?"]],
      ["kelime ağı: BAŞKA değişiklik (ek gece)", {}, ["Early check-in ücretli mi? Bir gece daha kalabilir miyiz?"]],
    ];
    for (const [name, over, texts] of cases) {
      expect(stayInfoOnly(texts ?? ASK, { ...base, ...over } as never), name).toBe(false);
    }
  });

  it("kelime ağının AYNI konu (erken giriş) işareti politika metnini engellemez — konuyu yakalar, isteği ayıramaz (ölçüldü)", () => {
    for (const q of ["Is early check-in paid?", "Erken giriş ücretli mi?", "How much is early check-in?", "Erken giriş var mı?"]) {
      expect(stayInfoOnly([q], base), q).toBe(true);
    }
  });
});

describe("politika metnine uygunluk — modeller her şeyi gördü, mesajda saat / başka gün yok (inceleme 09-24)", () => {
  const run = (autoBlockers: string[] = []) => ({ facts: { autoBlockers } }) as never;
  it("KONTROL: engel yok, saat yok → uygun", () => {
    expect(earlyCheckinPolicyAllowed(run(), ["Is early check-in paid?"])).toBe(true);
    // Onaylanan saat olmadığı için `time_mismatch_text` bilgi sorusunda HER ZAMAN vardır; kuyruk kodu da bu yüklemin
    // konusu değil (politika metni izin taşımaz).
    expect(earlyCheckinPolicyAllowed(run(["time_mismatch_text", "queued_delivery"]), ["Is early check-in paid?"])).toBe(true);
  });
  it("🚨 modeller mesajların tamamını görmedi → uygun DEĞİL", () => {
    expect(earlyCheckinPolicyAllowed(run(["not_fully_read"]), ["Is early check-in paid?"])).toBe(false);
  });
  it("🚨 başka güne işaret → uygun DEĞİL", () => {
    expect(earlyCheckinPolicyAllowed(run(["day_unverified"]), ["Is early check-in paid?"])).toBe(false);
  });
  it("🚨 herhangi bir cevapsız mesajda saat → uygun DEĞİL (somut istek)", () => {
    expect(earlyCheckinPolicyAllowed(run(), ["Is early check-in paid?", "We'd like 11:00."])).toBe(false);
    expect(earlyCheckinPolicyAllowed(run(), ["Erken giriş ücretli mi? Saat 10 gibi gelsek?"])).toBe(false);
  });
});
