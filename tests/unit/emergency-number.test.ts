import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  askedEmergencyServices,
  emergencyNumberLine,
  emergencyNumberReply,
  hostDisputeSignal,
  TR_EMERGENCY_NUMBERS,
  type EmergencyService,
} from "@/lib/ai/emergency-number";
import { hasEmergencyCallDirective } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// ACİL NUMARA → KOD METNİ (kurucu kararları 10-11; anahtar `AI_EMERGENCY_NUMBER_ENABLED` KAPALI). Servis başına numara (polis 155,
// ambulans 112, jandarma 156, itfaiye 110, genel 112), yalnız sorulan servis, yönerge cümlesi yok; ev sahibi / anlaşmazlık sözcüğü ya da
// anlama katmanının şikâyet / iade / insan talebi niyeti → numara VERİLMEZ (ev sahibine kalır). Ölçüm seti: `evals/emergency-number.json`.
// ---------------------------------------------------------------------------

const TR = "Europe/Istanbul";

describe("askedEmergencyServices — hangi servisin numarası soruluyor", () => {
  it.each<[string, EmergencyService[]]>([
    ["Annem fenalaştı, ambulans numarası kaçtı?", ["ambulance"]],
    ["Türkiye'de polis numarası kaç?", ["police"]],
    ["Jandarmanın numarası ne?", ["gendarmerie"]],
    ["Karşı binadan duman yükseliyor, itfaiyenin numarası kaç?", ["fire"]],
    ["Acil durumlar için hangi numarayı aramalıyız?", ["general"]],
    ["Merhaba, acil bir durumda hangi numarayı arayabiliriz?", ["general"]],
    ["Köpeğimiz kayboldu, polise haber vermek istiyoruz. Numarası ne?", ["police"]],
    ["What's the ambulance number here? My husband has chest pain.", ["ambulance"]],
    ["What number do I call for the police in Turkey?", ["police"]],
    ["Is the emergency number 112 or 911 here?", ["general"]],
    ["Wie lautet die Notrufnummer in der Türkei?", ["general"]],
    ["Какой номер скорой помощи? Ребёнку плохо.", ["ambulance"]],
    ["ما هو رقم الإسعاف؟ والدي مريض", ["ambulance"]],
    // Belirli servis sorulduysa genel "acil" sözcüğü ayrı satır üretmez (mutasyon E14).
    ["Acil! Ambulans numarası ne?", ["ambulance"]],
    ["Ambulans kaç?", ["ambulance"]],
    ["How do I call the police?", ["police"]],
    ["Who do we call for an ambulance?", ["ambulance"]],
    ["Ambulans numarası 112 mi?", ["ambulance"]],
    // Haiku 2. tur: acil kısa numarayla süren teyit sorusu, cümle sonundaki "contact", "who can / how do you".
    ["Polis numara 155 mi?", ["police"]],
    ["Acil numara 112 değil mi?", ["general"]],
    ["Police number 155?", ["police"]],
    ["Police contact?", ["police"]],
    ["Who can I call for an ambulance?", ["ambulance"]],
    ["How do you call the police here?", ["police"]],
  ])("%s", (text, expected) => expect(askedEmergencyServices(text)).toEqual(expected));

  it.each([
    "Wi-Fi şifresi ne?",
    "Polis karakolu nerede?",
    "Ambulans geçti, çok gürültü vardı.",
    "Check-in kaçta?",
    "",
    // Haiku incelemesi 10-11: numara sorusu OLMAYAN eşleşmeler.
    "Polis kaç dakikada gelir?",
    "Acil servis kaç saate kadar açık?",
    "Polis geldi, numara 5'teki komşu gürültü yapıyor.",
    "I'm going to call the police about the neighbours' noise.",
    "We will contact the police tomorrow.",
    "Telefonum çalındı, polise gideceğiz.",
    "My phone was stolen, we are going to the police.",
    "Polis 5 numaralı dairede bağırıyor.",
    "The police came to apartment number 5.",
  ])(
    "KONTROL — numara sorusu değil: %s",
    (text) => expect(askedEmergencyServices(text)).toEqual([]),
  );
});

describe("uzun metin — tavan + süre (misafir metni; karesel iş yok)", () => {
  it("2.000 karakteri aşan mesaj numara sorusu sayılmaz (mutasyon E18) ve hızlı döner", () => {
    expect(askedEmergencyServices(`${"a".repeat(1_990)} Ambulans numarası ne?`)).toEqual([]);
    expect(askedEmergencyServices(`${"a ".repeat(980)}Ambulans numarası ne?`)).toEqual(["ambulance"]);
  });
  it.each([
    ["boşluklu tekrar", "polis ".repeat(330)],
    ["tek sözcük", "ambulans".repeat(240)],
    ["ipucu tekrarı", "numara kaç ".repeat(180)],
  ])("askedEmergencyServices %s < 200 ms", (_n, text) => {
    const t = performance.now();
    askedEmergencyServices(text);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it.each([
    ["boşluk dizisi", "ev " + " ".repeat(50_000) + "x"],
    ["tek sözcük", "evsahib".repeat(7_000)],
    ["tekrarlanan kök", "iade ".repeat(10_000)],
  ])("hostDisputeSignal %s (50.000 karakter) < 300 ms", (_n, text) => {
    const t = performance.now();
    hostDisputeSignal(text);
    expect(performance.now() - t).toBeLessThan(300);
  });
});

describe("hostDisputeSignal — ev sahibi / anlaşmazlık sözcüğü (kod bacağı)", () => {
  it.each([
    "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?",
    "Ev sahibi rezervasyonumu son anda iptal etti, polise gideceğim. Numara?",
    "Daire ilandaki gibi değil, dolandırıldık. Polis numarasını verin.",
    "The host is not responding, give me the police number.",
    "Хозяин не возвращает залог. Какой номер полиции?",
    "Ev sahibi kapıyı izinsiz açıp içeri girdi, korkuyorum. Polis numarası ne?", // kurucu: ev sahibi tehditse size kalsın
    // Haiku incelemesi 10-11: bitişik yazım, başka adlandırmalar, sözcüksüz iade dili.
    "Evsahibimiz gece bizi dışarı attı, polis numarası ne?",
    "Mal sahibi bizi tehdit etti, polis numarası?",
    "Hostumuz telefonu açmıyor, polis numarası?",
    "Kiraya veren kapıyı açmıyor, polis numarası?",
    "Bina yöneticisi bağırıyor, polis numarası ne?",
    "Paramı geri ödemezseniz polisi arayacağım, polis numarası ne?",
    "The manager locked us out, what is the police number?",
    "The landlady threatened us. Police number?",
    "I want my money back or I call the police. What's the number?",
  ])("🚨 %s", (t) => expect(hostDisputeSignal(t)).toBe(true));
  it.each([
    "Annem fenalaştı, ambulans numarası kaçtı?",
    "Türkiye'de polis numarası kaç?",
    "Sokakta kavga var, polis numarası?",
    // Haiku 2. tur: platform adı, yabancının tehdidi ve hostel ev sahibiyle anlaşmazlık DEĞİLDİR (kurucu: yalnız ev sahibinin kendisi).
    "Booking'den rezervasyon yaptık, annem fenalaştı, ambulans numarası?",
    "Airbnb'den geldik, babam düştü, ambulans numarası?",
    "Biri beni tehdit ediyor, polis numarası?",
    "Someone is threatening us outside, police number?",
    "Hostelde kalan arkadaşım bayıldı, ambulans numarası?",
  ])(
    "KONTROL: %s",
    (t) => expect(hostDisputeSignal(t)).toBe(false),
  );
});

describe("emergencyNumberLine — yalnız numara, yönerge yok, servis başına", () => {
  it("servis başına numara (kurucu: 'acil numara 112 değil ki, her tür için ayrı')", () => {
    expect(TR_EMERGENCY_NUMBERS).toEqual({ ambulance: "112", police: "155", gendarmerie: "156", fire: "110", general: "112" });
    expect(emergencyNumberLine(["police"], "tr")).toBe("Polis: 155");
    expect(emergencyNumberLine(["ambulance", "fire"], "tr")).toBe("Ambulans: 112 · İtfaiye: 110");
    expect(emergencyNumberLine(["police"], "en")).toBe("Police: 155");
    expect(emergencyNumberLine(["police"], "it")).toBe("Polis: 155"); // bilinmeyen dil → Türkçe
  });
  it("🚨 hiçbir dilde hiçbir satır 'arayın' yönergesi değildir", () => {
    const all: EmergencyService[] = ["ambulance", "police", "gendarmerie", "fire", "general"];
    for (const lang of ["tr", "en", "de", "fr", "es", "ru", "ar"]) {
      const line = emergencyNumberLine(all, lang);
      expect(hasEmergencyCallDirective(line), `${lang}: ${line}`).toBe(false);
    }
  });
});

describe("emergencyNumberReply — karar", () => {
  beforeEach(() => {
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());
  const ask = (message: string, intents: string[] | null, extra: Partial<Parameters<typeof emergencyNumberReply>[0]> = {}) =>
    emergencyNumberReply({ message, timeZone: TR, language: "tr", understandingIntents: intents, ...extra });

  it("🚨 yardım / hastalık: numara verilir (anlama katmanı 'acil')", () => {
    expect(ask("Annem fenalaştı, ambulans numarası kaçtı?", ["emergency"])?.text).toBe("Ambulans: 112");
  });
  it("🚨 ev sahibi şikâyeti: numara VERİLMEZ — anlama niyeti ya da kod sözcüğü (ölçümdeki iki hata: h1, h12)", () => {
    expect(ask("Daire ilandaki gibi değil. Polis numarası?", ["complaint_issue", "emergency"])).toBeNull();
    // Luna bir tekrarda yalnız "acil" dedi — kod bacağı yakalar.
    expect(ask("Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?", ["emergency"])).toBeNull();
    expect(ask("Ev sahibi rezervasyonumu son anda iptal etti, polise gideceğim. Numara?", ["emergency"])).toBeNull();
  });
  it("🚨 ev sahibinin kendisi tehdit → size kalır (kurucu kararı)", () => {
    expect(ask("Ev sahibi kapıyı izinsiz açıp içeri girdi, korkuyorum. Polis numarası ne?", ["emergency"])).toBeNull();
  });
  it("🚨 açık tehlike dalında da bitişik 'Evsahibi' numarayı durdurur (Haiku 10-11)", () => {
    expect(ask("Yangın çıktı! Evsahibimiz bizi dışarı attı, itfaiye numarası lazım!", null, { hazard: true })).toBeNull();
  });
  it("🚨 numara sorusu bir konaklama konusuyla birlikte → ev sahibine kalır (ölçümdeki h4); yakın yer / ulaşım sorusuyla birlikte verilir", () => {
    expect(ask("Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?", ["access_keys", "emergency"])).toBeNull();
    expect(ask("Klima bozuldu, itfaiye numarası ne?", ["appliance_help", "emergency"])).toBeNull();
    expect(ask("Babam fenalaştı, ambulans numarası ne, en yakın hastane nerede?", ["emergency", "local_recommendations"])?.text).toBe(
      "Ambulans: 112",
    );
    expect(ask("Merhaba, acil bir durumda hangi numarayı arayabiliriz?", ["greeting_thanks", "emergency"])?.text).toBe("Acil çağrı: 112");
    expect(ask("Ambulans numarası ne, hastaneye nasıl gideriz?", ["emergency", "directions_transport"])?.text).toBe("Ambulans: 112");
    expect(ask("Ambulans numarası ne?", ["other"])?.text).toBe("Ambulans: 112");
  });
  it("🚨 aynı turdaki önceki cevapsız misafir mesajında ev sahibi sözcüğü → numara verilmez", () => {
    expect(ask("Polis numarası ne?", ["emergency"], { earlierGuestTexts: ["Ev sahibi depozitomu vermiyor."] })).toBeNull();
    expect(ask("Polis numarası ne?", ["emergency"], { earlierGuestTexts: ["Merhaba", "Arabamızın camı kırılmış."] })?.text).toBe("Polis: 155");
    expect(ask("Polis numarası ne?", null, { hazard: true, earlierGuestTexts: ["The host never answers."] })).toBeNull();
  });
  it("anlama katmanı koşmadı → numara verilmez; AÇIK tehlike dalında sorulursa verilir", () => {
    expect(ask("Karşı binadan duman yükseliyor, itfaiyenin numarası kaç?", null)).toBeNull();
    expect(ask("Karşı binadan duman yükseliyor, itfaiyenin numarası kaç?", null, { hazard: true })?.text).toBe("İtfaiye: 110");
    expect(ask("Ev sahibi ilgilenmiyor, duman var, itfaiye numarası?", null, { hazard: true })).toBeNull();
  });
  it("KONTROL: bayrak kapalı / Türkiye dışı / numara sorusu yok → null", () => {
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "");
    expect(ask("Türkiye'de polis numarası kaç?", ["emergency"])).toBeNull();
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "1");
    expect(ask("Türkiye'de polis numarası kaç?", ["emergency"], { timeZone: "Europe/Berlin" })).toBeNull();
    expect(ask("Wi-Fi şifresi ne?", ["wifi"])).toBeNull();
  });

  it("ölçüm seti uçtan uca (Luna 6.0 koşusunun niyetleriyle): numara verilmesi gerekenlerin HEPSİ verilir, bırakılması gerekenlerin HEPSİ bırakılır", () => {
    const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/emergency-number.json"), "utf8")) as {
      scenarios: { id: string; text: string; lang: string; expect: string }[];
    };
    // Koşunun niyetleri (docs/olcum/acil-numara-2026-10-11-gpt-6-luna-*.json) sabit fikstür: kodun KARARINI sınar, modeli değil.
    const lunaIntents: Record<string, string[][]> = JSON.parse(
      readFileSync(path.resolve(__dirname, "../fixtures/emergency-number-luna-intents.json"), "utf8"),
    );
    const wrong: string[] = [];
    for (const s of data.scenarios) {
      for (const intents of lunaIntents[s.id] ?? []) {
        const got = emergencyNumberReply({ message: s.text, timeZone: TR, language: s.lang, understandingIntents: intents }) ? "give" : "hold";
        if (s.expect !== "either" && got !== s.expect) wrong.push(`${s.id}:${got}`);
      }
    }
    // h4 ("Kapı kodu çalışmıyor … Polisi arayacağız"; ev sahibi sözcüğü yok, Luna kapı + acil) konaklama konusu kuralıyla kapandı.
    expect(wrong).toEqual([]);
  });
});
