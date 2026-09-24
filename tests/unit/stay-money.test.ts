import { describe, it, expect } from "vitest";
import { hasMoneyStatement } from "@/lib/ai/stay-money";
import { evaluateAvailability, stayEvidenceOf, AVAILABILITY_VETO_REASONS } from "@/lib/ai/availability-claims";
import { parseStayGuardVerdict, type StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { autoReplyGateFailure, availabilityPolicyFor } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { buildKbEvidence } from "@/lib/ai/grounding";

// ---------------------------------------------------------------------------
// PARA (dilim 8, kurucu senaryo 16-17: "onay + model ücret uydurdu / indirim pazarlığı yaptı → engel").
// Konaklama değişikliği isteğinde modelin yazdığı bir cevap ancak iki model ertelemeyi doğrularsa gider. O erteleme
// bir tutar, yüzde, indirim, muafiyet ("ücretsiz / ek ücret yok") ya da pazarlık taşıyorsa GİTMEZ (`price_claim`):
// ücret yalnız host'un kuralından, KODDA kurulan onay metniyle söylenir. İki katman, birleşim: deterministik biçim
// dedektörü (tutar/para birimi/yüzde + dar bir indirim/muafiyet sözlüğü) ∨ bekçinin `reply_states_price` hükmü.
// ---------------------------------------------------------------------------

const STAY = { checkIn: "15:00", checkOut: "11:00" };
const verdict = (over: Partial<StayGuardVerdict> = {}): StayGuardVerdict => ({
  guestRequestsChange: false,
  kind: "none",
  requestedCheckinTime: null,
  requestedCheckoutTime: null,
  replyStatesCalendar: false,
  replyGrantsChange: false,
  replyDefersToHost: false,
  replyRefuses: false,
  replyStatesPrice: false,
  ...over,
});

const MONEY: readonly string[] = [
  // Tutar + sembol / kod / ad (sayı önde ya da arkada, ayraçlı)
  "Early check-in costs €30.",
  "It would be 30€ extra.",
  "The fee is 30 € per stay.",
  "The fee is EUR 30.",
  "It is 30 EUR.",
  "Ücreti 500 TL.",
  "Ücreti 500 TL'dir.",
  "Ücreti ₺500 olur.",
  "It's $40.",
  "It's 40 USD.",
  "It's £25.",
  "It's 25 GBP.",
  "Ücret 500 TRY.",
  "Ücret 1.500 TL.",
  "Das kostet 29,90 €.",
  "It is thirty euros.",
  "Ücreti 500 lira.",
  "That's 40 dollars.",
  "Das kostet 20 Euro.",
  "Стоимость 300 рублей.",
  "Это 50 евро.",
  "الرسوم 50 يورو.",
  "الرسوم 300 ليرة.",
  "Ücreti 100 dolar.",
  "Ücreti 50 avro.",
  // Yüzde
  "We can do %20 less.",
  "We can do 20% less.",
  "We can do 20 % less.",
  "Size yüzde 20 yapabiliriz.",
  "That is twenty percent off.",
  "Wir geben 20 Prozent.",
  "Nous faisons 20 pour cent.",
  "Hacemos un 20 por ciento.",
  "Сделаем 20 процентов.",
  "نقدم لك 20٪.",
  // İndirim / muafiyet / pazarlık
  "Size indirim yapabiliriz.",
  "İndirimli fiyat uygulanır.",
  "Erken giriş ücretsizdir.",
  "Erken giriş bedava.",
  "Ek ücret alınmaz.",
  "I can offer you a discount.",
  "Early check-in is free of charge.",
  "There is no extra charge.",
  "It comes at no additional cost.",
  "Early check-in is complimentary.",
  "Der Early Check-in ist kostenlos.",
  "Wir geben Ihnen Rabatt.",
  "Das geht ohne Aufpreis.",
  "L'arrivée anticipée est gratuite.",
  "C'est sans frais.",
  "Nous vous faisons une remise.",
  "La entrada anticipada es gratis.",
  "Es sin costo.",
  "Le damos un descuento.",
  "Ранний заезд бесплатно.",
  "Сделаем скидку.",
  "Это без доплаты.",
  "الدخول المبكر مجانا.",
  "نقدم لك خصم.",
  "بدون رسوم إضافية.",
];

const CLEAN: readonly string[] = [
  "Thanks! I'll check with the host and get back to you.",
  "Feel free to message us if anything changes.",
  "I'll try my best to confirm by 12:00 on 14.10.",
  "Your host will confirm availability and any possible fee.",
  "Apartment 5 is ready for 2 guests; the walk takes 15 minutes.",
  "We hope you enjoy your time in Europe!",
  "Please rub the stain gently with water.",
  "Talebinizi ev sahibinize iletiyorum; uygunluk onun kararıdır.",
  "Das entscheidet Ihr Gastgeber; wir melden uns.",
  "Votre hôte vous répondra rapidement.",
  "Su anfitrión le confirmará en breve.",
  "Хозяин ответит вам в течение дня, среди прочего уточнит время.",
  "سيقوم المضيف بالرد عليك قريبا.",
  "Check-in is from 15:00; please leave by 11:00 on the 16th.",
];

describe("para dedektörü (deterministik, yalnız sıkılaştırır)", () => {
  it("🚨 tutar / para birimi / yüzde / indirim / muafiyet — yedi dilde", () => {
    const missed = MONEY.filter((t) => !hasMoneyStatement(t));
    expect(missed, `kaçan: ${missed.join(" | ")}`).toEqual([]);
  });

  it("aşırı-uygulama kontrolü: parasız erteleme, saat/tarih/sayı, 'feel free', 'Europe', 'rub', ücretin VARLIĞINDAN söz (tutarsız)", () => {
    const flagged = CLEAN.filter((t) => hasMoneyStatement(t));
    expect(flagged, `yanlış alarm: ${flagged.join(" | ")}`).toEqual([]);
  });

  it("boş / metin dışı girdi para değildir", () => {
    expect(hasMoneyStatement("")).toBe(false);
    expect(hasMoneyStatement(null as never)).toBe(false);
  });
});

describe("bekçi şeması: `reply_states_price` ZORUNLU boolean (eksik = bekçi düştü)", () => {
  const RAW = {
    guest_requests_change: true,
    kind: "early_checkin",
    requested_checkin_time: "12:00",
    requested_checkout_time: null,
    reply_states_calendar: false,
    reply_grants_change: false,
    reply_defers_to_host: true,
    reply_refuses: false,
    reply_states_price: true,
  };
  it("çözülür; eksik ya da boolean değilse hüküm YOK", () => {
    expect(parseStayGuardVerdict(RAW)?.replyStatesPrice).toBe(true);
    expect(parseStayGuardVerdict({ ...RAW, reply_states_price: false })?.replyStatesPrice).toBe(false);
    const { reply_states_price: _omit, ...missing } = RAW;
    expect(parseStayGuardVerdict(missing)).toBeNull();
    expect(parseStayGuardVerdict({ ...RAW, reply_states_price: "true" })).toBeNull();
  });
});

describe("politika: hassas istekte ERTELEYEN cevap para taşıyamaz", () => {
  const ASK = ["Hi! Could we check in at 12:00 today?"];
  const DECL = { asked: "early_checkin", stance: "defers" } as const;
  const GUARD = (over: Partial<StayGuardVerdict> = {}) => ({
    status: "ok" as const,
    verdict: verdict({ guestRequestsChange: true, kind: "early_checkin", requestedCheckinTime: "12:00", replyDefersToHost: true, ...over }),
  });
  const DEFER = "Thanks! I'll check with the host and get back to you.";
  const opts = (over: Record<string, unknown> = {}) => ({ declared: DECL, guard: GUARD(), stayTimes: STAY, ...over });

  it("KONTROL (anti-vakum): iki model ertelemeyi doğruladı, para yok → GİDER", () => {
    expect(evaluateAvailability(DEFER, ASK, opts()).reason).toBeNull();
  });

  it("🚨 uydurma ücret / indirim / muafiyet → `price_claim`; kanıtta `m`", () => {
    for (const money of ["The early check-in fee is €99.", "I can offer you a 20% discount.", "There would be no extra charge."]) {
      const e = evaluateAvailability(`${DEFER} ${money}`, ASK, opts());
      expect(e.reason, money).toBe("price_claim");
      expect(e.signals.lx, money).toContain("m");
    }
    // "Erken giriş ücretsiz olur" bir İZİN de ima eder → önce iddia bacağı yakalar (öncelik, ↓).
    expect(evaluateAvailability(`${DEFER} Early check-in would be free of charge.`, ASK, opts()).reason).toBe("availability_claim");
  });

  it("🚨 bekçinin fiyat hükmü tek başına yeter (kelime ağının göremediği ifade); kanıtta `p`", () => {
    const reply = `${DEFER} It wouldn't cost you anything extra.`;
    expect(evaluateAvailability(reply, ASK, opts()).reason).toBeNull(); // KONTROL: deterministik katman görmüyor
    const e = evaluateAvailability(reply, ASK, opts({ guard: GUARD({ replyStatesPrice: true }) }));
    expect(e.reason).toBe("price_claim");
    expect(e.signals.gv).toContain("p");
  });

  it("öncelik: ertelenmeyen istek `availability_unconfirmed`, izin/takvim iddiası `availability_claim` kalır", () => {
    const money = `${DEFER} The fee is €99.`;
    expect(evaluateAvailability(money, ASK, opts({ guard: undefined })).reason).toBe("availability_unconfirmed");
    expect(evaluateAvailability(`Sure, you can check in at 12:00! The fee is €99.`, ASK, opts({ declared: { asked: "early_checkin", stance: "grants" } })).reason).toBe(
      "availability_claim",
    );
  });

  it("host'un KENDİ teklif metni (ücretiyle) aynen aktarılırsa para sayılmaz; değiştirilmiş tutar sayılır", () => {
    const offer = "Late checkout until 13:00 is possible for 20 EUR.";
    const ask = ["Could we check out at 13:00?"];
    const late = {
      declared: { asked: "late_checkout", stance: "defers" } as const,
      guard: { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", requestedCheckoutTime: "13:00", replyDefersToHost: true }) },
      stayTimes: STAY,
      hostOfferText: offer,
    };
    const relay = `Your host's standing offer: ${offer} Whether it works that day is your host's decision.`;
    expect(evaluateAvailability(relay, ask, late).reason).toBeNull();
    const changed = "Your host's standing offer: late checkout until 13:00 for 15 EUR. Whether it works that day is your host's decision.";
    expect(evaluateAvailability(changed, ask, late).reason).toBe("price_claim");
  });

  it("aşırı-uygulama kontrolü: konaklama isteği YOKSA para bilgisi bu kontrolün konusu değil (bekçi 'fiyat' dese de)", () => {
    const e = evaluateAvailability("Parking costs 10 EUR per day.", ["Is there parking nearby?"], {
      declared: { asked: "none", stance: "none" },
      guard: { status: "ok", verdict: verdict({ replyStatesPrice: true }) },
      stayTimes: STAY,
    });
    expect(e.reason).toBeNull();
  });

  it("doğrulanmış onay (KODDA kurulan metin, host'un ücretiyle) muaf kalır", () => {
    const text = "The apartment is ready — you can check in today (14 October) from 12:00. The early check-in fee is €30.";
    expect(evaluateAvailability(text, ASK, opts({ verifiedGrant: { text } })).reason).toBeNull();
  });

  it("gerekçe kapalı kümede; kanıt `sc` yeni kodu ve harfleri taşır, tanınmayan harf düşer", () => {
    expect([...AVAILABILITY_VETO_REASONS]).toContain("price_claim");
    const e = evaluateAvailability(`${DEFER} The fee is €99.`, ASK, opts({ guard: GUARD({ replyStatesPrice: true }) }));
    const sc = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], stay: stayEvidenceOf(e) }))).sc;
    expect(sc).toMatchObject({ v: "price_claim", ev: "price_claim" });
    expect(sc.lx).toContain("m");
    expect(sc.gv).toContain("p");
    const bad = buildKbEvidence({ retrieved: [], usedLabels: [], stay: { ...stayEvidenceOf(e), lx: "rdmm" } });
    expect(bad).toBeNull();
  });
});

describe("iki kapı — bağlantı DAVRANIŞSAL (kanal + QR aynı yüklem)", () => {
  const ASK = "Hi! Could we check in at 12:00 today?";
  const guard = {
    status: "ok" as const,
    verdict: verdict({ guestRequestsChange: true, kind: "early_checkin", requestedCheckinTime: "12:00", replyDefersToHost: true }),
  };
  const result = {
    intent: "early_checkin",
    riskLevel: "none",
    confidence: 0.92,
    source: "openai",
    reply: "Thanks! I'll check with the host and get back to you. I can offer you a 20% discount.",
    stayChange: { asked: "early_checkin", stance: "defers" } as const,
  };

  it("kanal: gerekçe `price_claim`; parasız aynı cevap geçer", () => {
    const ctx = { stayTimes: { checkIn: "15:00", checkOut: "11:00" }, stayGuard: guard };
    expect(autoReplyGateFailure(result, ASK, ctx)).toBe("price_claim");
    expect(autoReplyGateFailure({ ...result, reply: "Thanks! I'll check with the host and get back to you." }, ASK, ctx)).toBeNull();
    // Politika girdisi kapıyla aynı kurucudan (karar kaydı ile hüküm ayrışamaz).
    expect(evaluateAvailability(result.reply, [ASK], availabilityPolicyFor(result, ctx)).reason).toBe("price_claim");
  });

  it("QR: devir gerekçesi `price_claim`", () => {
    const v = evaluateEscalation({ ...result, usedSources: [] }, ASK, null, [], { stayTimes: { checkIn: "15:00", checkOut: "11:00" }, stayGuard: guard });
    expect(v).toMatchObject({ escalate: true, reason: "price_claim" });
  });
});
