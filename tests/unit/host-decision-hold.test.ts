import { describe, it, expect, afterEach, vi } from "vitest";
import { defersDecisionToHost, evaluateAvailability, hasAvailabilityDeferral } from "@/lib/ai/availability-claims";
import { carriesHandoffNotice, vetoOutgoingReply } from "@/lib/ai/output-veto";
import { hostDecisionHoldEnabled } from "@/lib/ai/host-decision-hold";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { EARLY_CHECKIN_LANGS, earlyCheckinApprovalText, earlyCheckinPolicyText } from "@/lib/early-checkin/reply";
import type { StayGuardVerdict } from "@/lib/ai/semantic/stay-change";

// ---------------------------------------------------------------------------
// "EV SAHİBİNİZİN KARARIDIR" MİSAFİRE GİTMEZ (kurucu kararı 10-01: "hiç bir şekilde gitmemeli, sussa bile daha iyi … ertelemeyi
// gönderme"). Anahtar `AI_HOST_DECISION_HOLD_ENABLED` VARSAYILAN KAPALI.
//  · Kararı EV SAHİBİNE bırakan cümle (7 dil) her bağlamda tutulur → K10 yolu (`handoff_notice` + "cevabınızı bekliyor").
//  · Hassas konaklama isteğinde kanıtlı erteleme de (ev sahibini adlandırmasa da: "müsaitliğe bağlı") GİTMEZ.
//  · Koşul cümlesi tek başına ("müsaitliğe bağlıdır", "subject to availability") ev sahibi kararı DEĞİLDİR.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

const HOST_DECIDES = [
  "Bu ev sahibinizin kararıdır.",
  "Saat 14:00'teki çıkış isteği müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır.",
  "Kararı ev sahibiniz verir.",
  "Evcil hayvan kabulü ev sahibinizin onayına bağlıdır.",
  "Whether an earlier arrival is possible is the host's call.",
  "That is up to your host.",
  "Early check-in needs to be approved by your host.",
  "Your host decides on early check-in.",
  "Das entscheidet Ihr Gastgeber.",
  "Das muss Ihr Gastgeber entscheiden.",
  "Bu konuda karar ev sahibinizindir.",
  "C'est la décision de votre hôte.",
  "Es decisión del anfitrión.",
  "Это решение хозяина.",
  "هذا قرار المضيف.",
];

const CONDITION_ONLY = [
  "Erken giriş müsaitliğe bağlıdır.",
  "Early check-in is subject to availability.",
  "Platform üzerinden değişiklik talebi gönderebilirsiniz.",
  "Je nach Verfügbarkeit.",
  "Sous réserve de disponibilité.",
  "Según disponibilidad.",
  "حسب التوفر",
];

const verdict = (over: Partial<StayGuardVerdict> = {}): StayGuardVerdict => ({
  guestRequestsChange: true,
  kind: "late_checkout",
  requestedCheckinTime: null,
  requestedCheckoutTime: "14:00",
  replyStatesCalendar: false,
  replyGrantsChange: false,
  replyDefersToHost: true,
  replyRefuses: false,
  replyAmounts: [],
  replyPriceTerms: false,
  ...over,
});
const ASK = ["Çıkışı 14:00'te yapabilir miyiz?"];
const VERIFIED = { declared: { asked: "late_checkout", stance: "defers" } as const, guard: { status: "ok" as const, verdict: verdict() } };

describe("ev sahibini karar verici sayan erteleme — yüklem", () => {
  it("7 dilde ev sahibi kararı TANINIR; koşul cümlesi tek başına TANINMAZ (genel erteleme dedektörü onu erteleme sayar — o liste DEĞİŞMEDİ)", () => {
    for (const r of HOST_DECIDES) expect(defersDecisionToHost(r), r).toBe(true);
    for (const r of CONDITION_ONLY) {
      expect(defersDecisionToHost(r), r).toBe(false);
      expect(hasAvailabilityDeferral(r), r).toBe(true); // birleşim (eski dedektör) DEĞİŞMEDİ
    }
    for (const r of [
      "Wi-Fi şifresi Lale2025.",
      "Check-in is from 15:00.",
      "Ev sahibiniz çok misafirperverdir.",
      // aşırı-uygulama: misafirin kararı, ev sahibinin geçmişteki işi, rutin olgu
      "Kararınızı ev sahibinize iletebilirsiniz.",
      "Ev sahibiniz kararınızı bekliyor.",
      "The host decided to renovate the kitchen last year.",
      "Ev sahibiniz her sabah bahçeyi kontrol eder.",
      "Anahtarı ev sahibi için masaya bırakabilirsiniz.",
    ]) {
      expect(defersDecisionToHost(r), r).toBe(false);
    }
  });
});

describe("çıktı vetosu — anahtar", () => {
  it("🚨 anahtar kapalıyken ('true' / '0' dahil) ev sahibi kararı cümlesi vetoya TAKILMAZ (bugünkü davranış birebir)", () => {
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", v);
      expect(hostDecisionHoldEnabled(), JSON.stringify(v)).toBe(false);
      for (const r of HOST_DECIDES) {
        expect(vetoOutgoingReply(r), r).toBeNull();
        expect(carriesHandoffNotice(r), r).toBe(false);
      }
    }
  });

  it("açıkken ev sahibi kararı cümlesi devir sayılır (K10 yolu): veto `handoff_notice`, bildirim yüklemi true", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    for (const r of HOST_DECIDES) {
      expect(vetoOutgoingReply(r), r).toBe("handoff_notice");
      expect(carriesHandoffNotice(r), r).toBe(true);
    }
  });

  it("bekleme sözü ('Your host will let you know.') anahtardan BAĞIMSIZ bugünkü gibi söz olarak tutulur (sınıf değişmez)", () => {
    for (const v of ["", "1"]) {
      vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", v);
      expect(vetoOutgoingReply("Your host will let you know.")).toBe("unverified_commitment");
    }
  });

  it("açıkken bile koşul cümlesi ve olgu cevabı GEÇER (aşırı-uygulama kontrolü)", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    for (const r of [...CONDITION_ONLY, "Wi-Fi şifresi Lale2025.", "Ev sahibiniz çok misafirperverdir."]) {
      expect(vetoOutgoingReply(r), r).toBeNull();
      expect(carriesHandoffNotice(r), r).toBe(false);
    }
  });
});

describe("hassas konaklama isteği — kanıtlı erteleme", () => {
  const CONDITION_DEFERRAL = "Saat 14:00'te çıkış müsaitlik ve temizlik programına bağlı.";

  it("KONTROL: anahtar kapalıyken iki modelin doğruladığı erteleme gider (bugünkü davranış)", () => {
    const e = evaluateAvailability(CONDITION_DEFERRAL, ASK, VERIFIED);
    expect(e.reason).toBeNull();
    expect(e.deferralHeld).toBeFalsy();
  });

  it("🚨 açıkken kanıtlı erteleme de GİTMEZ (ev sahibini adlandırmasa da) ve tutuşun sebebi işaretlenir", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const e = evaluateAvailability(CONDITION_DEFERRAL, ASK, VERIFIED);
    expect(e.reason).toBe("availability_unconfirmed");
    expect(e.enforceReason).toBe("availability_unconfirmed");
    expect(e.deferralHeld).toBe(true);
  });

  it("açıkken öncelik aynı: para söyleyen erteleme `price_claim` (tutuş sebebi erteleme DEĞİL); doğrulanmamış erteleme eskisi gibi", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const priced = evaluateAvailability("Geç çıkış 300 TL; bu ev sahibinizin kararıdır.", ASK, VERIFIED);
    expect(priced.reason).toBe("price_claim");
    expect(priced.deferralHeld).toBeFalsy();
    const unverified = evaluateAvailability(CONDITION_DEFERRAL, ASK, { declared: VERIFIED.declared });
    expect(unverified.reason).toBe("availability_unconfirmed");
    expect(unverified.deferralHeld).toBeFalsy();
  });

  it("açıkken koddan kurulan doğrulanmış erken giriş onayı (birebir metin, tek tür) MUAF kalır", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const text = "Daireniz hazır; bugün (1 Ekim) saat 12:00 itibarıyla giriş yapabilirsiniz.";
    const e = evaluateAvailability(text, ["Saat 12'de girebilir miyiz?"], {
      verifiedGrant: { text },
      declared: { asked: "early_checkin", stance: "none" },
      guard: { status: "ok", verdict: verdict({ kind: "early_checkin", requestedCheckinTime: "12:00", requestedCheckoutTime: null }) },
    });
    expect(e.reason).toBeNull();
    expect(e.deferralHeld).toBeFalsy();
  });

  it("açıkken hassas olmayan bilgi sorusunda koşul cümlesi gider (kural yalnız konaklama isteğinde)", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const e = evaluateAvailability("Bebek yatağı müsaitliğe bağlıdır.", ["Bebek yatağı var mı?"], {
      declared: { asked: "none", stance: "none" },
      guard: { status: "ok", verdict: verdict({ guestRequestsChange: false, kind: "none", requestedCheckoutTime: null, replyDefersToHost: false }) },
    });
    expect(e.reason).toBeNull();
    expect(e.deferralHeld).toBeFalsy();
  });
});

describe("QR kapısı — kanalla AYNI yüklem", () => {
  // Misafir mesajı kelime ağına takılmayan bir bilgi sorusu (evcil hayvan sorusu kural ihlali kelimesiyle zaten devreder).
  const pets = {
    intent: "wifi",
    riskLevel: "none",
    confidence: 0.92,
    source: "openai",
    riskType: null,
    reply: "The Wi-Fi network is Lale-5G. Whether you can also use the office network is the host's call.",
    usedSources: ["kb:wifi"],
    stayChange: { asked: "none" as const, stance: "none" as const },
  };
  it("KONTROL: anahtar kapalıyken ev sahibi kararı cümlesi QR'da handoff_notice ile devretmez (ses kapısı acil durdurmada — anahtarın kendi etkisi)", () => {
    vi.stubEnv("AI_HOST_VOICE_GUARD_DISABLED", "1");
    expect(evaluateEscalation(pets, "What is the wifi?")).toEqual({ escalate: false, reason: null });
  });
  it("🚨 kurucu 10-30: anahtar kapalı olsa da üçüncü kişi ev sahibi ('the host's call') misafire gitmez — reply_host_voice", () => {
    expect(evaluateEscalation(pets, "What is the wifi?")).toEqual({ escalate: true, reason: "reply_host_voice" });
  });
  it("🚨 açıkken QR'da devreder (handoff_notice) — misafire metin gitmez (K10 devri)", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    expect(evaluateEscalation(pets, "What is the wifi?")).toEqual({ escalate: true, reason: "handoff_notice" });
  });
});

describe("koddan kurulan erken giriş metinleri", () => {
  const rule = { mode: "auto" as const, earliest: "12:00", fee: { amount: 300, currency: "TRY" as const }, note: null };
  it("🚨 açıkken politika metni ('kararı ev sahibiniz verir', 6 dil) TUTULUR — kurucu: 'ev sahibinizin kararına bağlıdır demesin' (yeniden yazımı sabah kararı)", () => {
    for (const lang of EARLY_CHECKIN_LANGS) {
      const text = earlyCheckinPolicyText(rule, lang)!;
      vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "");
      expect(vetoOutgoingReply(text), `${lang} kapalı`).toBeNull();
      vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
      expect(vetoOutgoingReply(text), `${lang} açık`).toBe("handoff_notice");
    }
  });
  it("açıkken doğrulanmış ONAY metni (6 dil, ücretli) tutulmaz", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    for (const lang of EARLY_CHECKIN_LANGS) {
      const text = earlyCheckinApprovalText(
        { status: "approvable", approvedTime: "12:00", fee: rule.fee } as never,
        lang,
        null,
        "2026-10-01",
      )!;
      expect(text.length, lang).toBeGreaterThan(10);
      expect(vetoOutgoingReply(text), lang).toBeNull();
    }
  });
});

describe("maliyet — her cevaba uygulanan yüklem karesel iş yapmaz", () => {
  it("50.000 karakterlik tekrarlı / tek sözcük / boşluk girdisinde yüklem < 250 ms", () => {
    const inputs = [
      "ev sahibi ".repeat(5000),
      "ev sahibinizin ".repeat(5000) + "x",
      "the host ".repeat(5000),
      "a".repeat(50000),
      "ev" + " ".repeat(50000) + "sahibi",
      "решение ".repeat(6000),
      "ihr gastgeber ".repeat(4000),
      "im ermessen des ".repeat(3500),
      "a decision for ".repeat(3500),
      "ev sahibinize kalmis ".repeat(2500),
      "зависит от ".repeat(5000),
    ];
    for (const v of inputs) {
      const t0 = performance.now();
      defersDecisionToHost(v);
      expect(performance.now() - t0, v.slice(0, 20)).toBeLessThan(250);
    }
  });
});

describe("dar liste — her kalıp kendi örneğiyle pinli (mutasyon 10-01: örneksiz kalıp ölü kod sayılır)", () => {
  it.each([
    "It is for your host to decide.",
    "It is the host who decides.",
    "Late checkout needs the host's approval.",
    "Early check-in is subject to host approval.",
    "The host will need to confirm this.",
    "Das ist die Entscheidung des Gastgebers.",
    "Das liegt bei Ihrem Gastgeber.",
    "Der Gastgeber muss das bestätigen.",
    "Cela revient à votre hôte.",
    "C'est à la discrétion de votre hôte.",
    "À confirmer par votre hôte.",
    "Lo confirma su anfitrión.",
    "Depende del anfitrión.",
    "Это на усмотрение хозяина.",
    "Хозяин должен подтвердить.",
    "Решает ваш хозяин.",
  ])("ev sahibi kararı: %s", (r) => {
    expect(defersDecisionToHost(r)).toBe(true);
  });

  // 10-02 (Luna öğe kipi ölçümünde misafire GİTTİ; 5.052 kayıtlı model cevabında 46 yeni tutuş, hepsi gerçek ev sahibi kararı cümlesi,
  // düşen 0): aynı anlamın öteki biçimleri — en sık olanı Almanca "liegt im Ermessen Ihres Gastgebers".
  it.each([
    "An extra night would be a decision for your host.",
    "The final decision rests with your host.",
    "Ein früherer Check-in um 12:00 Uhr liegt im Ermessen Ihres Gastgebers.",
    "Das liegt nach Ermessen des Gastgebers.",
    "Die Parkgebühr ist Sache Ihres Gastgebers.",
    "Das obliegt Ihrem Gastgeber.",
    "Cela relève de votre hôte.",
    "C'est à votre hôte de décider.",
    "El reembolso depende de tu anfitrión.",
    "Queda a criterio del anfitrión.",
    "Está en manos de su anfitrión.",
    "Продление зависит от вашего хозяина.",
    "هذا حسب تقدير المضيف.",
    "الأمر متروك للمضيف.",
    "Bu ev sahibinize kalmış.",
    "Geç çıkış ev sahibinizin inisiyatifindedir.",
  ])("ev sahibi kararı (10-02 biçimleri): %s", (r) => {
    expect(defersDecisionToHost(r)).toBe(true);
  });

  // 10-02 (kör set 11 — 5.1'in Almanca cevabı GİTTİ: "dazu kann Ihre Gastgeberin am besten eine Entscheidung treffen"): DİŞİL ev sahibi
  // (Gastgeberin / hôtesse / anfitriona) ve dişil belirleyiciler (Ihre / die / Ihrer / der / de la); "Entscheidung treffen" deyimi; FR gelecek
  // zaman ve ES özne-önce sıra.
  it.each([
    "Dazu kann Ihre Gastgeberin am besten eine Entscheidung treffen.",
    "Die Entscheidung trifft Ihre Gastgeberin.",
    "Ihre Gastgeberin trifft die Entscheidung.",
    "Ihre Gastgeberin entscheidet über einen späteren Check-out.",
    "Das muss Ihre Gastgeberin bestätigen.",
    "Das liegt im Ermessen Ihrer Gastgeberin.",
    "Das liegt bei Ihrer Gastgeberin.",
    "Das ist die Entscheidung der Gastgeberin.",
    "Cela relève de votre hôtesse.",
    "Votre hôtesse décide pour l'arrivée anticipée.",
    "Votre hôte confirmera l'heure de départ.",
    "Es decisión de la anfitriona.",
    "Lo decide su anfitriona.",
    "Su anfitrión decidirá si es posible.",
    // her kalıbın dişil biçimi kendi örneğiyle (mutasyon: örneksiz parça ölü kod sayılır)
    "Das ist Sache Ihrer Gastgeberin.",
    "Das obliegt Ihrer Gastgeberin.",
    "Das entscheidet Ihre Gastgeberin.",
    "Darüber entscheidet die Vermieterin.",
    "C'est la décision de votre hôtesse.",
    "Cela revient à votre hôtesse.",
    "C'est à la discrétion de votre hôtesse.",
    "À confirmer par votre hôtesse.",
    "C'est à votre hôtesse de décider.",
    "Votre hôtesse confirmera l'heure d'arrivée.",
    "Depende de la anfitriona.",
    "Queda a criterio de la anfitriona.",
    "Está en manos de la anfitriona.",
    "La anfitriona decidirá.",
  ])("ev sahibi kararı (dişil / deyim): %s", (r) => {
    expect(defersDecisionToHost(r)).toBe(true);
  });

  it.each([
    // takdir / iş başkasının ya da misafirin
    "Bitte parken Sie nach eigenem Ermessen.",
    "Ihre Gastgeberin trifft Sie am Eingang.",
    "Die Gastgeberin hat die Wohnung letztes Jahr renoviert.",
    "Eine Entscheidung treffen Sie bitte bis morgen.",
    "L'hôtesse de l'air vous indiquera la sortie.",
    "Votre hôtesse vous attend à l'entrée.",
    "La anfitriona vive en el segundo piso.",
    "Das ist Sache der Reinigungsfirma.",
    "The decision for your dates is yours.",
    "The key rests with the concierge.",
    "Cela relève de la mairie.",
    "Queda a criterio del huésped.",
    "Depende de la disponibilidad.",
    "Это зависит от погоды.",
    "حسب تقدير الضيف",
    // "kalmış" nesne: ev sahibine kalan eşya / iş
    "Ev sahibinize kalmış bir paket yok.",
    "Ev sahibine kalmış olan anahtarı kutuya bıraktık.",
  ])("ev sahibi kararı DEĞİL: %s", (r) => {
    expect(defersDecisionToHost(r)).toBe(false);
  });

  it("hassas istek YOKSA (beyan 'defers' + bekçi 'erteliyor' olsa da) tutuş işareti konmaz — gönderilen cevap için e-posta gitmesin", () => {
    vi.stubEnv("AI_HOST_DECISION_HOLD_ENABLED", "1");
    const e = evaluateAvailability("Bu ev sahibinizin takdirindedir.", ["Havlu var mı?"], {
      declared: { asked: "none", stance: "defers" },
      guard: {
        status: "ok",
        verdict: verdict({ guestRequestsChange: false, kind: "none", requestedCheckoutTime: null, replyDefersToHost: true }),
      },
    });
    expect(e.reason).toBeNull();
    expect(e.deferralHeld).toBeFalsy();
  });
});
