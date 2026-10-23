import { describe, it, expect } from "vitest";
import { evaluateAvailability, kbFactsOf, vetoAvailability } from "@/lib/ai/availability-claims";
import { availabilityPolicyFor } from "@/lib/automation";
import { evaluateEscalation, qrAvailabilityPolicy } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// 24 EK — BİLGİ TABANINDA YAZILI SABİT OTOPARK YERİ TAHSİSİ KONAKLAMA MÜSAİTLİĞİ DEĞİLDİR (kurucu onayı 10-02 akşam:
// "KB'de doğrulanmış sabit park yeri tahsisini güncel müsaitlik iddiasından ayırmak mantıklı; '2 numaralı yer dairenize
// ayrılmış' ile 'bugün boş yer var' aynı şey değil").
//
// Önce: QR geliştirme setinde "Arabamızı nereye park edebiliriz?" sorusunun DOĞRU cevabı ("…2 numaralı yer dairenize ayrılmış
// durumda") takvim iddiası sayıldı (`yer … ayrılmış`); QR'da devirde misafire metin gitmediği için misafir HİÇBİR cevap almadı
// (Sabah Kararları 24 EK 2). Kayıtlı 6.081 model cevabında bugün tutulan 18 iddianın en çok 6'sı bu istisnayla serbest kalır ve
// altısı da otopark tahsisi cümlesidir (rapor). Kelime ağı BÜYÜMEZ: yeni hiçbir cümle tutulmaz.
// ---------------------------------------------------------------------------

const KB_TR = kbFactsOf([
  {
    title: "Otopark",
    content: "Binanın arkasındaki açık otopark ücretsizdir; 2 numaralı yer dairenize ayrılmıştır. Gece 00:00'dan sonra ön girişi kullanın.",
  },
]);
const KB_B2 = kbFactsOf([{ title: "Otopark", content: "Kapalı otopark -2. kattadır; dairenize ayrılmış yer B2-17 numaralı yerdir." }]);
const KB_ONE = kbFactsOf([{ title: "Otopark", content: "Otoparkta dairenize ayrılmış 1 araçlık yer var." }]);
const KB_NO_ASSIGNMENT = kbFactsOf([{ title: "Otopark", content: "Otopark binanın arkasında, ücretsizdir; yer bulunursa park edebilirsiniz." }]);
const KB_ASSIGNMENT_NOT_PARKING = kbFactsOf([
  { title: "Bagaj", content: "Girişteki dolap misafirlerin bavulları için ayrılmıştır. Ücretsizdir ve 2 numaralı raf size aittir." },
]);

const GUEST = ["Arabamızı nereye park edebiliriz?"];
/** Kelime ağının iddia işareti ("c") — model katmanları bu testte yok (yalnız deterministik yedek). */
const claims = (reply: string, kbFacts?: readonly string[] | null) =>
  evaluateAvailability(reply, GUEST, { kbFacts, deterministicReply: true }).signals.lx.includes("c");

describe("24 EK — bilgi tabanında yazılı otopark tahsisi takvim iddiası DEĞİL", () => {
  it.each([
    ["Arabanızı binanın arkasındaki otoparka bırakabilirsiniz; 2 numaralı yer dairenize ayrılmış durumda.", KB_TR],
    ["Binanın arkasındaki açık otoparkı ücretsiz olarak kullanabilirsiniz; 2 numaralı yer sizin dairenize ayrılmış durumda.", KB_TR],
    ["Binanın arkasındaki ücretsiz açık otoparkta dairenize ayrılmış 2 numaralı yere park edebilirsiniz.", KB_TR],
    ["Merhaba, 2 numaralı park yeri dairenize ayrılmış durumda.", KB_TR],
    ["Dairenize 2 numaralı yer ayrılmış.", KB_TR],
    ["Binanın kapalı otoparkında dairenize ayrılmış B2-17 numaralı yer var.", KB_B2],
    ["Binanın kapalı otoparkı -2. kattadır ve dairenize ayrılmış yer vardır; B2-17 numaralı yeri kullanabilirsiniz.", KB_B2],
    ["Dairenize ayrılmış park yeri, bodrum kattaki kapalı otoparkta B17 numaralı alandır.", KB_ONE],
    ["Parking place 2 is reserved for your apartment.", KB_TR],
    ["Парковочное место номер 2 забронировано для вашей квартиры.", KB_TR],
    ["Un coche puede quedarse en vuestra plaza del garaje.", KB_ONE],
    ["الشقة لها موقف محجوز رقم 2 في المرآب.", KB_TR],
    ["Pour votre appartement une place de parking est réservée au sous-sol.", KB_ONE],
  ])("%j → gider (bilgi tabanı tahsisi yazıyor)", (reply, kb) => {
    expect(claims(reply, kb)).toBe(false);
  });

  // KONTROL: aynı cümleler bilgi tabanı VERİLMEDEN bugünkü gibi tutulur — istisna bilgi tabanına bağlı.
  it.each([
    "Arabanızı binanın arkasındaki otoparka bırakabilirsiniz; 2 numaralı yer dairenize ayrılmış durumda.",
    "Binanın kapalı otoparkında dairenize ayrılmış B2-17 numaralı yer var.",
    "Parking place 2 is reserved for your apartment.",
    "Dairenize 2 numaralı yer ayrılmış.",
    "Парковочное место номер 2 забронировано для вашей квартиры.",
    "Un coche puede quedarse en vuestra plaza del garaje.",
    "الشقة لها موقف محجوز رقم 2 في المرآب.",
    "Pour votre appartement une place de parking est réservée au sous-sol.",
  ])("KONTROL %j → bilgi tabanı yoksa TUTULUR (bugünkü davranış)", (reply) => {
    expect(claims(reply)).toBe(true);
    expect(claims(reply, [])).toBe(true);
  });

  it("dayanaksız tahsis: bilgi tabanında otopark var ama TAHSİS yazmıyor → tutulur", () => {
    expect(claims("2 numaralı yer dairenize ayrılmış durumda.", KB_NO_ASSIGNMENT)).toBe(true);
  });

  it("dayanaksız tahsis: bilgi tabanında tahsis var ama OTOPARK değil (bagaj dolabı) → tutulur", () => {
    expect(claims("2 numaralı yer dairenize ayrılmış durumda.", KB_ASSIGNMENT_NOT_PARKING)).toBe(true);
  });

  it("YANLIŞ YER NUMARASI: bilgi tabanı 2 diyor, cevap 5 → tutulur", () => {
    expect(claims("5 numaralı yer dairenize ayrılmış durumda.", KB_TR)).toBe(true);
    expect(claims("Binanın kapalı otoparkında dairenize ayrılmış B2-18 numaralı yer var.", KB_B2)).toBe(true);
  });

  // İKİZLER — konaklama iddiası istisnanın İÇİNE gizlenemez (yalnız bitişik yapı silinir, kalan metin yine aranır).
  it.each([
    ["2 numaralı yer dairenize ayrılmış ve daireniz o tarihlerde müsait.", KB_TR],
    ["2 numaralı yer dairenize ayrılmış ve şu an boş.", KB_TR],
    ["Daireniz bu tarihlerde size ayrılmış durumda.", KB_TR],
    ["Dairenize ayrılmış yer var; daire de cumartesi gecesi boş.", KB_ONE],
    // Ayıklanan yapının yerine "yer" kalır: tahsis ayıklanınca "şu an boş" müsaitlik iddiası özne kaybedip kaçmasın.
    ["Dairenize ayrılmış yer şu an boş.", KB_TR],
    ["The apartment is reserved for you on those dates.", KB_TR],
    ["Pueden quedarse una noche más.", KB_ONE],
    // Araç izni SAATLİ: bir uzatma olabilir → istisna yok.
    ["Su coche puede quedarse en la plaza hasta las 14:00 del día de salida.", KB_ONE],
  ])("İKİZ %j → TUTULUR", (reply, kb) => {
    expect(claims(reply, kb)).toBe(true);
  });

  it.each(["Der Stellplatz Nr. 2 ist für Ihre Wohnung reserviert.", "La plaza 2 está reservada para su apartamento."])(
    "Almanca / İspanyolca 'reserviert / está reservada' otopark cümlesi bugün de iddia sayılmıyor (istisna gerekmez): %j",
    (reply) => {
      expect(claims(reply)).toBe(false);
      expect(claims(reply, KB_TR)).toBe(false);
    },
  );

  it("kelime ağı BÜYÜMEDİ: 'Otoparkta bugün boş yer var' bugün de iddia sayılmıyor (istisna yeni tutuş üretmez)", () => {
    expect(claims("Otoparkta bugün boş yer var.", KB_TR)).toBe(false);
    expect(claims("Otoparkta bugün boş yer var.")).toBe(false);
  });

  it("bilgi sorusuna giden otopark cevabı kapının müsaitlik kararında temiz (veto null)", () => {
    const reply = "Binanın arkasındaki açık otoparkı kullanabilirsiniz; 2 numaralı yer dairenize ayrılmış durumda.";
    expect(vetoAvailability(reply, GUEST, { declared: { asked: "none", stance: "none" }, replyIntent: "parking", kbFacts: KB_TR })).toBeNull();
    expect(vetoAvailability(reply, GUEST, { declared: { asked: "none", stance: "none" }, replyIntent: "parking" })).toBe(
      "availability_claim",
    );
  });
});

describe("24 EK — bağlantı: kapıların politika kurucuları bilgi tabanını taşır", () => {
  const result = { intent: "parking", stayChange: { asked: "none", stance: "none" } as const, source: "openai" };

  it("kanal: availabilityPolicyFor kbFacts'i aynen geçirir; verilmezse null (davranış eski)", () => {
    expect(availabilityPolicyFor(result, { kbFacts: KB_TR }).kbFacts).toEqual(KB_TR);
    expect(availabilityPolicyFor(result, {}).kbFacts).toBeNull();
  });

  it("QR: qrAvailabilityPolicy kbFacts'i aynen geçirir; verilmezse null", () => {
    expect(qrAvailabilityPolicy(result, { kbFacts: KB_TR }).kbFacts).toEqual(KB_TR);
    expect(qrAvailabilityPolicy(result, {}).kbFacts).toBeNull();
  });

  it("QR kapısı: aynı otopark cevabı bilgi tabanıyla GİDER, bilgi tabanı olmadan devredilir (availability_claim)", () => {
    const reply = {
      reply: "Binanın arkasındaki açık otoparkı kullanabilirsiniz; 2 numaralı yer dairenize ayrılmış durumda.",
      intent: "parking",
      riskLevel: "none",
      confidence: 0.95,
      source: "openai",
      riskType: null,
      stayChange: { asked: "none", stance: "none" } as const,
      usedSources: ["kb:Otopark"],
    };
    const msg = "Arabamızı nereye park edebiliriz?";
    expect(evaluateEscalation(reply, msg, null, [], { kbFacts: KB_TR })).toEqual({ escalate: false, reason: null });
    expect(evaluateEscalation(reply, msg, null, [], {})).toEqual({ escalate: true, reason: "availability_claim" });
  });

  it("kbFactsOf: başlık + içerik, boş kalemler düşer", () => {
    expect(kbFactsOf([{ title: "A", content: "b" }, { title: "", content: "  " }, { title: null, content: null }])).toEqual(["A\nb"]);
    expect(kbFactsOf(null)).toEqual([]);
  });
});

// SÜRE (ReDoS kuralı): yapı kalıpları sınırlı ayraçlı; bilgi tabanı penceresi tavanlı (50). Uzun cevap / uzun bilgi tabanı doğrusal.
describe("24 EK — uzun girdide süre", () => {
  it.each([
    ["dairenize ayrılmış yer ", 1_000],
    ["2 numaralı yer ", 1_500],
    ["yer ", 5_000],
    ["место номер 2 ", 1_500],
    ["موقف محجوز ", 2_000],
  ])("cevap %j × %i, bilgi tabanı 24k → < 1,5 sn", (unit, n) => {
    const reply = (unit as string).repeat(n as number).slice(0, 4_000);
    const kb = ["Otopark " + "2 numaralı yer dairenize ayrılmıştır otopark ".repeat(600).slice(0, 23_900)];
    const t0 = performance.now();
    evaluateAvailability(reply, GUEST, { kbFacts: kb, deterministicReply: true });
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});
