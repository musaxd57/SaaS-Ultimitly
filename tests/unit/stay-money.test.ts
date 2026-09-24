import { describe, it, expect, vi, afterEach } from "vitest";
import { hasMoneyStatement, hasUnallowedMoney, moneyAmountsOf } from "@/lib/ai/stay-money";
import { evaluateAvailability, stayEvidenceOf, AVAILABILITY_VETO_REASONS } from "@/lib/ai/availability-claims";
import { parseStayGuardVerdict, type StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { guardSeesWholeReply, runStayChangeGuard } from "@/lib/ai/semantic/guard";
import { autoReplyGateFailure, availabilityPolicyFor } from "@/lib/automation";
import { evaluateEscalation, ESCALATION_REASONS } from "@/lib/guest-chat-gate";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { sameMoney } from "@/lib/ai/money-lexicon";

// ---------------------------------------------------------------------------
// PARA (dilim 8, kurucu senaryo 16-17: "onay + model ücret uydurdu / indirim pazarlığı yaptı → engel").
// Konaklama değişikliği isteğinde modelin yazdığı bir cevap ancak iki model ertelemeyi doğrularsa gider. O erteleme
// bir tutar, yüzde, indirim, muafiyet ("ücretsiz / ek ücret yok") ya da pazarlık taşıyorsa GİTMEZ (`price_claim`):
// ücret yalnız host'un kaydından söylenir. Birleşim: deterministik biçim dedektörü ∨ bekçinin fiyat sözü ∨ bekçinin
// çıkardığı ve host'un kaydında OLMAYAN bir tutar (kıyas KODDA). Host'un geç çıkış teklifinin tutarı YALNIZ geç çıkış
// isteğinde izinlidir (çeviride de — aynı tutar + birim).
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

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
  replyAmounts: [],
  replyPriceTerms: false,
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
  "Ücreti 500TL.",
  "It is AED 20.",
  "Ücreti 20 sterlin.",
  "Son 40 dólares.",
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
  "نقدم 20 في المئة.",
  // Kanonik biçimler — satır içi HER alternatifin kendi örneği (satır silme mutantı alternatif kaybını göremez):
  "Erken giriş bizden olsun.",
  "Geç çıkış yarı fiyatına olur.",
  "Early check-in is on the house.",
  "Das wäre zum halben Preis.",
  "Das geht aufs Haus.",
  "Nous pouvons faire un geste commercial.",
  "La nuit serait à moitié prix.",
  "Le départ tardif vous serait offert à titre gracieux.",
  "La entrada es de cortesía.",
  "Sería a mitad de precio.",
  "Podemos mejorarle el precio.",
  "Будет за полцены.",
  "Можем сделать половинную цену.",
  "Ранний заезд за наш счёт.",
  "Можем договориться о цене.",
  "الليلة بنصف السعر.",
  "الدخول المبكر على حسابنا.",
  "يمكننا تقديم سعر أفضل.",
  "Son 1.200 pesos.",
  "الليلة 300 د.إ.",
  "تكلفة الليلة ٤٥٠ ر.س.",
  "The late check-out fee is 45.00 per hour.",
  "Geç çıkışın ücreti 500.",
  // Yalnız rakama bitişikken para sayılan birimler (başka kalıbın yakalamadığı biçimler):
  "That would be 500 TRY.",
  "It is 5 pounds.",
  "Es kostet 20 Franken.",
  "Toplam 100 dolara çıkar.",
  // Rakamsız para adı (yalnız "kesin" adlar; "dolar" Türkçede fiil olduğu için rakamsız sayılmaz):
  "Ödeme lira olarak alınır.",
  "Se paga en dólares.",
  "Se paga en pesos.",
  // İndirim / muafiyet / pazarlık
  "Size indirim yapabiliriz.",
  "İndirimli fiyat uygulanır.",
  "Erken giriş ücretsizdir.",
  "Erken giriş bedava.",
  "Ek ücret alınmaz.",
  "Ekstra bir ödeme gerekmez.",
  "Size özel fiyat verebiliriz.",
  "Bunun için ücret almayacağız.",
  "I can offer you a discount.",
  "We can waive the fee.",
  "You can do it for free.",
  "We offer free early check-in.",
  "Late check-out is free.",
  "It comes without any extra charge.",
  "We can give you a better price.",
  "It would be half-price.",
  "Es entstehen keine zusätzlichen Kosten.",
  "Wir machen Ihnen einen Sonderpreis.",
  "Das bekommen Sie umsonst.",
  "Nous pouvons faire une réduction.",
  "Aucun frais supplémentaire.",
  "Nous avons un prix spécial.",
  "Hay una rebaja.",
  "Tenemos un precio especial.",
  "Сделаем специальную цену.",
  "Отдадим даром.",
  "يمكننا تقديم تخفيض.",
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
  "Your host is free to decide; I'll let you know.",
  "La remise des clés se fait à 15h ; votre hôte confirmera l'heure.",
  // Kör bataryanın ölçtüğü ve ağın çözdüğü tuzaklar (sözcüğün para dışı anlamı):
  "Geç çıkışı ev sahibinize soracağım. Bilginiz olsun, hafta sonları otopark çabuk dolar.",
  "Ev sahibinize yüzde yüz ileteceğim ve dönüş yapacağım.",
  "Please try 10 minutes later if the door code does not work.",
  "Ev sahibinize soruyorum; dairede 2 sarı havlu hazır.",
  "I'll ask the host; you can charge 2 phones at the desk.",
  "Ich kläre das mit dem Gastgeber; das Restaurant nebenan ist preisgekrönt, 2 Minuten zu Fuß.",
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
    expect(hasUnallowedMoney("", [])).toBe(false);
    expect(moneyAmountsOf(null)).toEqual([]);
  });

  it("tutar çözümlemesi ortak sözlükten: değer + ISO kodu (sembol, kod, ad; binlik/ondalık ayraçlı)", () => {
    expect(moneyAmountsOf("Late checkout until 13:00 is possible for 20 EUR.")).toEqual([{ amount: 20, currency: "EUR" }]);
    expect(moneyAmountsOf("€30 ya da 1.500 TL")).toEqual(
      expect.arrayContaining([
        { amount: 30, currency: "EUR" },
        { amount: 1500, currency: "TRY" },
      ]),
    );
    expect(moneyAmountsOf("It is 29,90 €.")).toEqual([{ amount: 29.9, currency: "EUR" }]);
  });

  it("tutar eşitliği: birim bilinmeli ve aynı olmalı; kuruş yazımı farkı tolere edilir, 50 kuruş fark edilmez", () => {
    expect(sameMoney({ amount: 29.9, currency: "EUR" }, { amount: 29.9, currency: "EUR" })).toBe(true);
    expect(sameMoney({ amount: 20, currency: "EUR" }, { amount: 20.5, currency: "EUR" })).toBe(false);
    expect(sameMoney({ amount: 20, currency: "EUR" }, { amount: 20, currency: "TRY" })).toBe(false);
    expect(sameMoney({ amount: 20, currency: null }, { amount: 20, currency: null })).toBe(false);
  });

  it("🚨 izinli tutar ÇIKARILIR, kalan para sinyali sayılır: aynı tutar + birim geçer; başka tutar / birim / yüzde / indirim geçmez", () => {
    const allowed = [{ amount: 20, currency: "EUR" }];
    expect(hasUnallowedMoney("Il est possible de partir à 13h pour 20 €.", allowed)).toBe(false); // çeviri, aynı tutar
    expect(hasUnallowedMoney("It is 20 euros.", allowed)).toBe(false);
    expect(hasUnallowedMoney("It is 25 EUR.", allowed)).toBe(true); // tutar değişti
    expect(hasUnallowedMoney("It is 20 USD.", allowed)).toBe(true); // birim değişti
    expect(hasUnallowedMoney("It is 20 EUR, or 10% off if you book now.", allowed)).toBe(true); // ek yüzde
    expect(hasUnallowedMoney("It is 20 EUR; for you it is free of charge.", allowed)).toBe(true); // ek muafiyet
    expect(hasUnallowedMoney("It is 20 EUR.", [])).toBe(true); // izin yoksa her tutar para
  });
});

describe("bekçi şeması: tutarlar + fiyat sözü ZORUNLU (eksik / bozuk = bekçi düştü)", () => {
  const RAW = {
    guest_requests_change: true,
    kind: "early_checkin",
    requested_checkin_time: "12:00",
    requested_checkout_time: null,
    reply_states_calendar: false,
    reply_grants_change: false,
    reply_defers_to_host: true,
    reply_refuses: false,
    reply_amounts: [{ amount: 30, currency: "eur" }],
    reply_price_terms: true,
  };
  it("çözülür; para birimi ISO koduna çevrilir, tanınmayan → null", () => {
    expect(parseStayGuardVerdict(RAW)).toMatchObject({ replyAmounts: [{ amount: 30, currency: "EUR" }], replyPriceTerms: true });
    expect(parseStayGuardVerdict({ ...RAW, reply_amounts: [{ amount: 500, currency: "lira" }] })?.replyAmounts).toEqual([{ amount: 500, currency: "TRY" }]);
    expect(parseStayGuardVerdict({ ...RAW, reply_amounts: [{ amount: 5, currency: "coins" }] })?.replyAmounts).toEqual([{ amount: 5, currency: null }]);
    // Sözlükte olmayan ÜÇ HARFLİ ISO kodu aynen korunur (yalnız adlar sözlükten çevrilir).
    expect(parseStayGuardVerdict({ ...RAW, reply_amounts: [{ amount: 5, currency: "chf" }] })?.replyAmounts).toEqual([{ amount: 5, currency: "CHF" }]);
    expect(parseStayGuardVerdict({ ...RAW, reply_amounts: [{ amount: 5, currency: null }] })?.replyAmounts).toEqual([{ amount: 5, currency: null }]);
  });
  it("🚨 eksik alan, tavan aşımı, sayı olmayan / negatif / sonsuz tutar, dizi olmayan liste → hüküm YOK", () => {
    const { reply_amounts: _a, ...noAmounts } = RAW;
    const { reply_price_terms: _t, ...noTerms } = RAW;
    for (const bad of [
      noAmounts,
      noTerms,
      { ...RAW, reply_price_terms: "true" },
      { ...RAW, reply_amounts: "30 EUR" },
      { ...RAW, reply_amounts: [{ amount: "30", currency: "EUR" }] },
      { ...RAW, reply_amounts: [{ amount: -1, currency: "EUR" }] },
      { ...RAW, reply_amounts: [{ amount: Number.POSITIVE_INFINITY, currency: "EUR" }] },
      { ...RAW, reply_amounts: [{ amount: 1, currency: 7 }] },
      { ...RAW, reply_amounts: [null] },
      { ...RAW, reply_amounts: [[1, "EUR"]] },
      { ...RAW, reply_amounts: Array.from({ length: 11 }, () => ({ amount: 1, currency: "EUR" })) },
    ]) {
      expect(parseStayGuardVerdict(bad), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
    // Tavan sınırı dahil: 10 tutar geçerli.
    expect(parseStayGuardVerdict({ ...RAW, reply_amounts: Array.from({ length: 10 }, () => ({ amount: 1, currency: "EUR" })) })).not.toBeNull();
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

  it("🚨 bekçinin fiyat SÖZÜ ya da çıkardığı İZİNSİZ tutar tek başına yeter (kelime ağının göremediği ifade); kanıtta `p`", () => {
    const reply = `${DEFER} It wouldn't cost you anything extra.`;
    expect(evaluateAvailability(reply, ASK, opts()).reason).toBeNull(); // KONTROL: deterministik katman görmüyor
    const terms = evaluateAvailability(reply, ASK, opts({ guard: GUARD({ replyPriceTerms: true }) }));
    expect(terms.reason).toBe("price_claim");
    expect(terms.signals.gv).toContain("p");
    const amount = evaluateAvailability(`${DEFER} It would be forty-five.`, ASK, opts({ guard: GUARD({ replyAmounts: [{ amount: 45, currency: null }] }) }));
    expect(amount.reason).toBe("price_claim");
    expect(amount.signals.gv).toContain("p");
  });

  it("öncelik: ertelenmeyen istek `availability_unconfirmed`, izin/takvim iddiası `availability_claim` kalır", () => {
    const money = `${DEFER} The fee is €99.`;
    expect(evaluateAvailability(money, ASK, opts({ guard: undefined })).reason).toBe("availability_unconfirmed");
    expect(evaluateAvailability(`Sure, you can check in at 12:00! The fee is €99.`, ASK, opts({ declared: { asked: "early_checkin", stance: "grants" } })).reason).toBe(
      "availability_claim",
    );
  });

  describe("host'un geç çıkış teklifi — yalnız KENDİ konusunda (geç çıkış) ve yalnız AYNI tutarla", () => {
    const offer = "Late checkout until 13:00 is possible for 20 EUR.";
    const lateGuard = (over: Partial<StayGuardVerdict> = {}) => ({
      status: "ok" as const,
      verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", requestedCheckoutTime: "13:00", replyDefersToHost: true, ...over }),
    });
    const late = (over: Record<string, unknown> = {}) => ({
      declared: { asked: "late_checkout", stance: "defers" } as const,
      guard: lateGuard(),
      stayTimes: STAY,
      hostOfferText: offer,
      ...over,
    });
    const ask = ["Could we check out at 13:00?"];

    it("aynen aktarım, çeviri ve kısmi aktarım AYNI tutarla geçer (bekçi de o tutarı çıkarsa)", () => {
      expect(evaluateAvailability(`Your host's standing offer: ${offer} Whether it works that day is your host's decision.`, ask, late()).reason).toBeNull();
      const translated = "Votre hôte propose un départ tardif jusqu'à 13h pour 20 € ; c'est lui qui décide.";
      expect(evaluateAvailability(translated, ask, late({ guard: lateGuard({ replyAmounts: [{ amount: 20, currency: "EUR" }] }) })).reason).toBeNull();
      expect(evaluateAvailability("Your host offers late check-out for 20 EUR; they will decide.", ask, late()).reason).toBeNull();
    });

    it("🚨 değiştirilmiş tutar, farklı birim ya da teklife EKLENEN indirim → `price_claim` (deterministik ya da bekçi)", () => {
      expect(evaluateAvailability("Your host offers late check-out for 15 EUR; they will decide.", ask, late()).reason).toBe("price_claim");
      expect(evaluateAvailability("Your host offers late check-out for 20 USD; they will decide.", ask, late()).reason).toBe("price_claim");
      expect(evaluateAvailability(`${offer} For you we can make it 10% cheaper; your host decides.`, ask, late()).reason).toBe("price_claim");
      const words = "Your host offers late check-out for twenty-five euros; they will decide.";
      expect(evaluateAvailability(words, ask, late({ guard: lateGuard({ replyAmounts: [{ amount: 25, currency: "EUR" }] }) })).reason).toBe("price_claim");
    });

    it("teklifin KENDİ sözü (\"ücretsiz\") aynen aktarımda muaf; tutar paritesi tek başına bunu kurtarmaz", () => {
      const freeOffer = "Late checkout until 12:00 is free; until 14:00 it is 20 EUR.";
      const relay = `Your host's standing offer: ${freeOffer} Whether it works that day is your host's decision.`;
      expect(evaluateAvailability(relay, ask, late({ hostOfferText: freeOffer })).reason).toBeNull();
    });

    it("🚨 istek türlerinin HEPSİ geç çıkış olmalı: karışık tür (geç çıkış + erken giriş) ya da türü olmayan hassas istek → teklif tutarı izinli değil", () => {
      const relay = `Your host's standing offer: ${offer} Whether it works that day is your host's decision.`;
      expect(evaluateAvailability(relay, ask, late({ replyIntent: "early_checkin" })).reason).toBe("price_claim");
      // Türsüz hassas istek (bekçi yalnız "ret" gördü): boş kümede "hepsi geç çıkış" boş doğru OLMAMALI.
      const kindless = {
        declared: { asked: "none", stance: "defers" } as const,
        guard: { status: "ok" as const, verdict: verdict({ replyRefuses: true, replyDefersToHost: true }) },
        stayTimes: STAY,
        hostOfferText: offer,
      };
      expect(evaluateAvailability(relay, ["hmm"], kindless).reason).toBe("price_claim");
    });

    it("🚨 teklif BAŞKA bir isteğe aktarılırsa (erken giriş, ek gece) tutarı izinli değildir — aynen aktarılsa da", () => {
      const relay = `Your host's standing offer: ${offer} Whether anything else is possible is your host's decision.`;
      expect(evaluateAvailability(relay, ASK, opts({ hostOfferText: offer })).reason).toBe("price_claim");
      const extend = {
        declared: { asked: "extend", stance: "defers" } as const,
        guard: { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "extend", replyDefersToHost: true }) },
        stayTimes: STAY,
        hostOfferText: offer,
      };
      expect(evaluateAvailability(relay, ["Could we stay one more night?"], extend).reason).toBe("price_claim");
      // KONTROL: aynı isteklerde parasız erteleme gider.
      expect(evaluateAvailability(DEFER, ["Could we stay one more night?"], extend).reason).toBeNull();
    });
  });

  it("aşırı-uygulama kontrolü: konaklama isteği YOKSA para bilgisi bu kontrolün konusu değil (bekçi 'fiyat' dese de)", () => {
    const e = evaluateAvailability("Parking costs 10 EUR per day.", ["Is there parking nearby?"], {
      declared: { asked: "none", stance: "none" },
      guard: { status: "ok", verdict: verdict({ replyPriceTerms: true, replyAmounts: [{ amount: 10, currency: "EUR" }] }) },
      stayTimes: STAY,
    });
    expect(e.reason).toBeNull();
  });

  it("bilinen bedel (pinli): hassas istekte erteleme + konuyla ilgisiz ücretsiz tesis de tutulur (kelime ağı konuyu ayırmaz)", () => {
    expect(evaluateAvailability(`${DEFER} Parking is free for guests.`, ASK, opts()).reason).toBe("price_claim");
  });

  it("doğrulanmış onay (KODDA kurulan metin, host'un ücretiyle) muaf kalır", () => {
    const text = "The apartment is ready — you can check in today (14 October) from 12:00. The early check-in fee is €30.";
    expect(evaluateAvailability(text, ASK, opts({ verifiedGrant: { text } })).reason).toBeNull();
  });

  it("gerekçe kapalı kümede; kanıt `sc` yeni kodu ve harfleri taşır, tanınmayan harf düşer", () => {
    expect([...AVAILABILITY_VETO_REASONS]).toContain("price_claim");
    // QR gerekçe listesi müsaitlik gerekçeleriyle BİREBİR (yoksa QR kaydı tanımadığı kodu sessizce null yazardı).
    expect([...ESCALATION_REASONS]).toEqual(expect.arrayContaining([...AVAILABILITY_VETO_REASONS]));
    const e = evaluateAvailability(`${DEFER} The fee is €99.`, ASK, opts({ guard: GUARD({ replyPriceTerms: true }) }));
    const sc = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], stay: stayEvidenceOf(e) }))).sc;
    expect(sc).toMatchObject({ v: "price_claim", ev: "price_claim" });
    expect(sc.lx).toContain("m");
    expect(sc.gv).toContain("p");
    const bad = buildKbEvidence({ retrieved: [], usedLabels: [], stay: { ...stayEvidenceOf(e), lx: "rdmm" } });
    expect(bad).toBeNull();
  });
});

describe("bekçi taslağın TAMAMINI görmeli (inceleme 09-24)", () => {
  it("redaksiyonla uzayıp tavanı aşan taslakta bekçi hüküm vermez → düşmüş sayılır, model ÇAĞRILMAZ", async () => {
    const name = "Ali"; // ≥3 harf: redaksiyon "[Misafir]" yazar (her geçişte +6 karakter)
    // 2.000 karakterlik otomatik gönderim tavanının altında; her ad yer tutucuyla uzar.
    const reply = `${`${name} `.repeat(600)}`.slice(0, 1990);
    expect(reply.length).toBeLessThanOrEqual(2000);
    expect(guardSeesWholeReply({ reply, names: [name] })).toBe(false);
    expect(guardSeesWholeReply({ reply: "Thanks! I'll check with the host.", names: [name] })).toBe(true);
    // Sınır: tavana TAM eşit taslak sığar (bir fazlası sığmaz).
    expect(guardSeesWholeReply({ reply: "x".repeat(2000), names: [] })).toBe(true);
    expect(guardSeesWholeReply({ reply: "x".repeat(2001), names: [] })).toBe(false);
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchImpl = vi.fn();
    const out = await runStayChangeGuard({ guestMessages: ["Could we check in at 12?"], reply, stayTimes: STAY, names: [name], fetchImpl });
    expect(out).toEqual({ status: "failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
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
