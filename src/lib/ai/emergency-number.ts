import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// ACİL NUMARA SORUSU → KOD METNİ (kurucu kararları 10-11; anahtar `AI_EMERGENCY_NUMBER_ENABLED`, VARSAYILAN KAPALI).
//
// Kurucu: "112'yi arayın yazmasın … sadece sorulursa numarasını verebilir" · "acil numara 112 değil ki, her tür için ayrı" · "önce ölçüm,
// Luna 6.0" · "ev sahibinin kendisi tehditse size kalsın". Ölçüm (`docs/olcum/acil-numara-2026-10-11-*`): anlama katmanı yardım / merak /
// hastalık sorularının hepsini doğru ayırdı; ev sahibi şikâyetinde "polisi arayacağım" ifadesi onu "acil"e çekip şikâyet etiketini zaman
// zaman düşürüyordu (modelin kendi açıklaması `…-aciklama.md`) → karar İKİ bacaklı: anlama katmanının şikâyet / iade / insan talebi
// niyetlerinden BİRİ ya da koddan ev sahibi / anlaşmazlık sözcüğü varsa numara VERİLMEZ, konuşma ev sahibine kalır. Numara sorusu bir
// konaklama konusuyla birlikteyse ("Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?" — ölçümde iki tekrarda da
// yalnız kapı + acil etiketlendi, modelin açıklaması "bu bir erişim şikâyeti") numara da o konuya bağlıdır → yine ev sahibine kalır; yalnız
// acil / selam / diğer / yakın yer / ulaşım ("en yakın hastane") niyetleriyle birlikte verilir. Aynı turdaki önceki cevapsız misafir
// mesajlarında ev sahibi sözcüğü varsa da verilmez ("Ev sahibi depozitomu vermiyor." → "Polis numarası ne?").
//
// Metin YALNIZ sorulan servisin numarasıdır ("Polis: 155"); "arayın" yönergesi YOK (`hasEmergencyCallDirective` ile pinli). Numaralar
// Türkiye'nindir → yalnız işletmenin saat dilimi Türkiye iken (`Europe/Istanbul`). Anlama katmanı koşmadıysa bağlam doğrulanamaz → numara
// verilmez; tek istisna AÇIK fiziksel tehlike (misafir numarayı açıkça sordu, bağlam belli — yine ev sahibi sözcüğü varsa verilmez).
// LLM'siz, deterministik; misafir metni dışarı taşınmaz.
// ---------------------------------------------------------------------------

export type EmergencyService = "ambulance" | "police" | "gendarmerie" | "fire" | "general";

/** Türkiye resmî numaraları (kurucu: servis başına ayrı). 155 / 156 / 110 tek numara (112) illerinde de 112'ye yönlenir. */
export const TR_EMERGENCY_NUMBERS: Readonly<Record<EmergencyService, string>> = {
  ambulance: "112",
  police: "155",
  gendarmerie: "156",
  fire: "110",
  general: "112",
};

export function emergencyNumberEnabled(): boolean {
  return process.env.AI_EMERGENCY_NUMBER_ENABLED === "1";
}

/** Türkçe ASCII katlama + aksan / hemze sökümü (ä → a, í → i, إ → ا). */
function fold(text: string): string {
  return foldTurkishAscii(text.replace(/\s+/g, " ")).normalize("NFD").replace(/\p{M}/gu, "");
}

const L = "(?<![\\p{L}\\p{N}])";
const SERVICE_WORDS: readonly [EmergencyService, string][] = [
  ["ambulance", "ambulans\\p{L}{0,8}|ambulance|ambulancia|krankenwagen|rettungs\\p{L}{0,8}|notarzt|samu|скор\\p{L}{0,8}|(?:ب|و|ل)?(?:ال)?اسعاف"],
  ["police", "polis\\p{L}{0,8}|police|policia|polizei|полици\\p{L}{0,8}|(?:ب|و|ل)?(?:ال)?شرط\\p{L}{0,2}"],
  ["gendarmerie", "jandarma\\p{L}{0,8}|gendarm\\p{L}{0,6}|жандарм\\p{L}{0,6}|(?:ب|و|ل)?(?:ال)?درك"],
  ["fire", "itfaiye\\p{L}{0,8}|fire\\s+(?:department|brigade|service)|pompiers|bomberos|feuerwehr|пожарн\\p{L}{0,8}|(?:ب|و|ل)?(?:ال)?اطفاء"],
  ["general", "acil(?![\\p{L}])|acil\\s+(?:durum\\p{L}{0,8}|cagri\\p{L}{0,4}|numara\\p{L}{0,6}|servis\\p{L}{0,4}|hat\\p{L}{0,4})|emergency|urgences|emergencias|notruf\\p{L}{0,8}|экстренн\\p{L}{0,8}|(?:ب|و|ل)?(?:ال)?طوار\\p{L}{0,2}"],
];
/**
 * "Numara / telefon" sorusu: numara, telefon, cümle sonundaki "kaç", nasıl arar / çağırır; number, phone, dial, "how do I call / contact";
 * Nummer; numero; номер; رقم. Haiku incelemesi (10-11, iki tur) — numara sorusu OLMAYAN eşleşmeler elendi: rakamla süren "numara 5'teki
 * komşu" (daire numarası; acil kısa numara — 1xx / 911 / 999 — ile süren "Polis numara 155 mi?" yine sorudur), "5 numaralı daire",
 * "Polis kaç dakikada gelir?" (kaç cümle sonunda değil), "telefonum çalındı" / "my phone" (kendi telefonu), cümle ortasındaki "call /
 * contact" ("We'll call the police about the noise"); cümle sonundaki "Police contact?" sorudur.
 */
const NOT_LOCAL_NUMBER = "(?!\\s*(?!(?:1\\d\\d|911|999)(?!\\d))\\d)";
const NUMBER_CUE =
  `numara${NOT_LOCAL_NUMBER}(?!li\\b)\\p{L}{0,8}|telefon(?!um)\\p{L}{0,8}|kac(?=\\s*(?:[?.!,]|$))|nasil\\s+(?:ara|cagir|ulas)\\p{L}{0,8}|number${NOT_LOCAL_NUMBER}|(?<!my\\s)(?<!our\\s)phone|dial|contact(?:\\s+(?:number|details|info))?(?=\\s*(?:[?.!,]|please|$))|how\\s+(?:(?:do|can|should)\\s+(?:i|we|you)\\s+|to\\s+)(?:call|reach|contact)|who\\s+(?:do|should|can)\\s+(?:i|we)\\s+call|nummer${NOT_LOCAL_NUMBER}|numero${NOT_LOCAL_NUMBER}|номер${NOT_LOCAL_NUMBER}\\p{L}{0,3}|телефон\\p{L}{0,3}|رقم|هاتف`;
const SERVICE_RE = SERVICE_WORDS.map(([s, w]) => [s, new RegExp(`${L}(?:${w})`, "iu")] as const);
/** Servis adı ile numara sorusu aynı yakınlıkta (≤ 60 karakter, iki sıra; bir cümle sınırını geçebilir: "Polise haber vereceğiz. Numarası?"). */
const ASK_RE = new RegExp(
  `${L}(?:${SERVICE_WORDS.map(([, w]) => w).join("|")})[\\s\\S]{0,60}?${L}(?:${NUMBER_CUE})|${L}(?:${NUMBER_CUE})[\\s\\S]{0,60}?${L}(?:${SERVICE_WORDS.map(([, w]) => w).join("|")})`,
  "iu",
);

/**
 * Servis adı GEÇMEYEN "hangi numarayı arayayım / which number" sorusu (kör set a1 / a4, 10-11: "Babam nefes alamıyor … hangi numarayı
 * arayayım?"). Yalnız ACİL bağlamda (anlama katmanı "acil" dedi ya da açık tehlike) genel acil numarası sayılır — "Temizlikçinin hangi
 * numarasını arayayım?" acil bağlam olmadığı için numara sorusu DEĞİLDİR.
 */
const GENERIC_ASK_RE = new RegExp(
  `${L}(?:hangi\\s+(?:numara|telefon)\\p{L}{0,8}|which\\s+number|what\\s+number|welche\\s+nummer|quel\\s+numero|que\\s+numero|какой\\s+номер|какой\\s+телефон|اي\\s+رقم)`,
  "iu",
);

/** Misafir hangi servisin numarasını soruyor (yoksa boş). Birleşik sözcük ("Notrufnummer") tek başına yeter. */
export function askedEmergencyServices(text: string, opts: { emergencyContext?: boolean } = {}): EmergencyService[] {
  if (typeof text !== "string" || !text.trim() || text.length > 2_000) return [];
  const f = fold(text);
  if (!ASK_RE.test(f) && !/notrufnummer|emergency\s*number/i.test(f)) {
    return opts.emergencyContext === true && GENERIC_ASK_RE.test(f) ? ["general"] : [];
  }
  const out = SERVICE_RE.filter(([, re]) => re.test(f)).map(([s]) => s);
  // Belirli bir servis sorulduysa genel "acil" sözcüğü ayrıca satır üretmez ("ambulans numarası, acil!" → yalnız ambulans).
  const specific = out.filter((s) => s !== "general");
  return specific.length > 0 ? specific : out;
}

/**
 * Ev sahibi / anlaşmazlık sözcüğü (kod bacağı): ev sahibi (bitişik yazım dahil), mal sahibi, kiraya veren, yönetici, depozito, iade,
 * "geri ödemezseniz", şikâyet, dolandırılma, hakaret, iptal, itiraz (depozito eş anlamlıları: güvence parası / bedeli, kapora, teminat —
 * kör set a10, 10-11) — yedi dil. Fazla eşleşme bilinçli: bedeli numaranın gitmemesidir (bugünkü
 * davranış, ev sahibi uyarılır). Haiku 2. tur (10-11): platform adı (Airbnb / Booking) ve çıplak "tehdit" ÇIKARILDI — "Booking'den
 * geldik, annem fenalaştı" ya da "Biri beni tehdit ediyor" ev sahibiyle anlaşmazlık değildir (kurucu: yalnız ev sahibinin KENDİSİ
 * tehditse size kalsın; o durumda "ev sahibi / mal sahibi / landlady" zaten eşleşir). "hostel / hostes" ev sahibi değildir.
 */
const HOST_DISPUTE = new RegExp(
  `${L}(?:ev\\s*sahib\\p{L}*|mal\\s+sahib\\p{L}*|kiraya\\s+veren\\p{L}*|yonetici\\p{L}*|host(?!el|es)\\p{L}*|owner|landlord|landlady|manager|vermieter\\p{L}*|gastgeber\\p{L}*|proprietaire|hote|anfitrion|dueno|propietari\\p{L}*|хозя\\p{L}*|владел\\p{L}*|المالك|صاحب|depozit\\p{L}*|deposit|kaution|guvence\\s+(?:para|bedel)\\p{L}*|kapora\\p{L}*|teminat\\p{L}*|itiraz\\p{L}*|dispute\\p{L}*|chargeback|caution|iade\\p{L}*|refund\\p{L}*|erstatt\\p{L}*|rembours\\p{L}*|reembols\\p{L}*|возврат\\p{L}*|залог\\p{L}*|استرداد|sikayet\\p{L}*|complain\\p{L}*|beschwer\\p{L}*|plainte|queja|жалоб\\p{L}*|شكو\\p{L}*|dolandir\\p{L}*|scam\\p{L}*|fraud\\p{L}*|betrug|betrog\\p{L}*|arnaque|estafa\\p{L}*|мошен\\p{L}*|احتيال|hakaret\\p{L}*|insult\\p{L}*|beleidig\\p{L}*|geri\\s+(?:ode|ver)\\p{L}*|money\\s+back|iptal\\p{L}*|cancel\\p{L}*|storn\\p{L}*|annul\\p{L}*|отмен\\p{L}*|الغاء)`,
  "iu",
);
export function hostDisputeSignal(text: string): boolean {
  return typeof text === "string" && HOST_DISPUTE.test(fold(text));
}

/**
 * Numarayla BİRLİKTE bulunabilen anlama niyetleri. Bunların dışındaki her niyet numarayı ev sahibine bırakır: şikâyet / iade / insan
 * talebi (ölçümdeki kural) ve bir konaklama konusu (kapı kodu, arıza, temizlik… — numara sorusu o konuya bağlıdır).
 */
const NUMBER_CO_INTENTS = new Set(["emergency", "greeting_thanks", "other", "local_recommendations", "directions_transport"]);

const LABELS: Readonly<Record<string, Readonly<Record<EmergencyService, string>>>> = {
  tr: { ambulance: "Ambulans", police: "Polis", gendarmerie: "Jandarma", fire: "İtfaiye", general: "Acil çağrı" },
  en: { ambulance: "Ambulance", police: "Police", gendarmerie: "Gendarmerie", fire: "Fire department", general: "Emergency" },
  de: { ambulance: "Rettungsdienst", police: "Polizei", gendarmerie: "Gendarmerie", fire: "Feuerwehr", general: "Notruf" },
  fr: { ambulance: "Ambulance", police: "Police", gendarmerie: "Gendarmerie", fire: "Pompiers", general: "Urgences" },
  es: { ambulance: "Ambulancia", police: "Policía", gendarmerie: "Gendarmería", fire: "Bomberos", general: "Emergencias" },
  ru: { ambulance: "Скорая помощь", police: "Полиция", gendarmerie: "Жандармерия", fire: "Пожарная служба", general: "Экстренная служба" },
  ar: { ambulance: "الإسعاف", police: "الشرطة", gendarmerie: "الدرك", fire: "الإطفاء", general: "الطوارئ" },
};

/** Yalnız sorulan servislerin numarası, misafirin dilinde (bilinmeyen dil → Türkçe). Yönerge cümlesi YOK. */
export function emergencyNumberLine(services: readonly EmergencyService[], language: string | null | undefined): string {
  const labels = (language && LABELS[language]) || LABELS.tr;
  return services.map((s) => `${labels[s]}: ${TR_EMERGENCY_NUMBERS[s]}`).join(" · ");
}

export interface EmergencyNumberInput {
  message: string;
  /** İşletmenin saat dilimi (`orgTimezone`) — numaralar Türkiye'nin. */
  timeZone: string;
  language: string | null | undefined;
  /** Anlama katmanı sonucu; koşmadıysa `null` (bağlam doğrulanamaz → numara verilmez, açık tehlike hariç). */
  understandingIntents: readonly string[] | null;
  /** AÇIK fiziksel tehlike dalı (modelsiz): misafir numarayı açıkça sorduysa anlama katmanı aranmaz. */
  hazard?: boolean;
  /** Aynı turdaki önceki cevapsız misafir mesajları — ev sahibi / anlaşmazlık sözcüğü onlarda da aranır. */
  earlierGuestTexts?: readonly string[];
}

export interface EmergencyNumberDecision {
  text: string;
  services: EmergencyService[];
}

/** Numara verilecekse kod metni; aksi hâlde `null` (bugünkü davranış: ev sahibine kalır). */
export function emergencyNumberReply(input: EmergencyNumberInput): EmergencyNumberDecision | null {
  if (!emergencyNumberEnabled()) return null;
  if (input.timeZone !== "Europe/Istanbul") return null;
  // Acil bağlam: anlama katmanı "acil" dedi ya da AÇIK tehlike dalı — servis adı geçmeyen "hangi numara?" sorusu ancak o zaman sayılır.
  const emergencyContext = input.hazard === true || (input.understandingIntents ?? []).includes("emergency");
  const services = askedEmergencyServices(input.message, { emergencyContext });
  if (services.length === 0) return null;
  if (hostDisputeSignal(input.message) || (input.earlierGuestTexts ?? []).some(hostDisputeSignal)) return null;
  if (input.understandingIntents === null) {
    if (!input.hazard) return null;
  } else if (input.understandingIntents.some((i) => !NUMBER_CO_INTENTS.has(i))) {
    return null;
  }
  return { text: emergencyNumberLine(services, input.language), services };
}
