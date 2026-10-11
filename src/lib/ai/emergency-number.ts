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
/** "Numara / telefon" sorusu: numara, kaç, hangi numara, nasıl arar / çağırır; number, phone, call, dial; Nummer; номер; رقم. */
const NUMBER_CUE =
  "numara\\p{L}{0,8}|telefon\\p{L}{0,8}|kac(?![\\p{L}])|hangi\\s+numara\\p{L}{0,8}|nasil\\s+(?:ara|cagir|ulas)\\p{L}{0,8}|number|phone|call|dial|contact|nummer|numero|номер\\p{L}{0,3}|телефон\\p{L}{0,3}|رقم|هاتف";
const SERVICE_RE = SERVICE_WORDS.map(([s, w]) => [s, new RegExp(`${L}(?:${w})`, "iu")] as const);
const CUE_RE = new RegExp(`${L}(?:${NUMBER_CUE})`, "iu");
/** Servis adı ile numara sorusu aynı yakınlıkta (≤ 60 karakter, iki sıra; bir cümle sınırını geçebilir: "Polise haber vereceğiz. Numarası?"). */
const ASK_RE = new RegExp(
  `${L}(?:${SERVICE_WORDS.map(([, w]) => w).join("|")})[\\s\\S]{0,60}?${L}(?:${NUMBER_CUE})|${L}(?:${NUMBER_CUE})[\\s\\S]{0,60}?${L}(?:${SERVICE_WORDS.map(([, w]) => w).join("|")})`,
  "iu",
);

/** Misafir hangi servisin numarasını soruyor (yoksa boş). Birleşik sözcük ("Notrufnummer") tek başına yeter. */
export function askedEmergencyServices(text: string): EmergencyService[] {
  if (typeof text !== "string" || !text.trim() || text.length > 2_000) return [];
  const f = fold(text);
  if (!ASK_RE.test(f) && !/notrufnummer|emergency\s*number/i.test(f)) return [];
  const out = SERVICE_RE.filter(([, re]) => re.test(f)).map(([s]) => s);
  // Belirli bir servis sorulduysa genel "acil" sözcüğü ayrıca satır üretmez ("ambulans numarası, acil!" → yalnız ambulans).
  const specific = out.filter((s) => s !== "general");
  return specific.length > 0 ? specific : out;
}

/** Ev sahibi / anlaşmazlık sözcüğü (kod bacağı): ev sahibi, depozito, iade, şikâyet, dolandırılma, hakaret, iptal — yedi dil. */
const HOST_DISPUTE = new RegExp(
  `${L}(?:ev\\s+sahib\\p{L}*|host|owner|landlord|vermieter\\p{L}*|gastgeber\\p{L}*|proprietaire|hote|anfitrion|dueno|propietari\\p{L}*|хозя\\p{L}*|владел\\p{L}*|المالك|صاحب|depozit\\p{L}*|deposit|kaution|caution|iade\\p{L}*|refund\\p{L}*|erstatt\\p{L}*|rembours\\p{L}*|reembols\\p{L}*|возврат\\p{L}*|залог\\p{L}*|استرداد|sikayet\\p{L}*|complain\\p{L}*|beschwer\\p{L}*|plainte|queja|жалоб\\p{L}*|شكو\\p{L}*|dolandir\\p{L}*|scam\\p{L}*|fraud\\p{L}*|betrug|betrog\\p{L}*|arnaque|estafa\\p{L}*|мошен\\p{L}*|احتيال|hakaret\\p{L}*|insult\\p{L}*|beleidig\\p{L}*|iptal\\p{L}*|cancel\\p{L}*|storn\\p{L}*|annul\\p{L}*|отмен\\p{L}*|الغاء)`,
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
  const services = askedEmergencyServices(input.message);
  if (services.length === 0) return null;
  if (hostDisputeSignal(input.message) || (input.earlierGuestTexts ?? []).some(hostDisputeSignal)) return null;
  if (input.understandingIntents === null) {
    if (!input.hazard) return null;
  } else if (input.understandingIntents.some((i) => !NUMBER_CO_INTENTS.has(i))) {
    return null;
  }
  return { text: emergencyNumberLine(services, input.language), services };
}
