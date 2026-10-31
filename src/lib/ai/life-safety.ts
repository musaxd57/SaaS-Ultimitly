import { detectRiskTypes, foldTurkishAscii, isAccessLossText, isSafetyEmergencyText } from "@/lib/ai/fallback";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// CAN GÜVENLİĞİ SINIFI — hibrit acil akışın TEK kuralı (tasarım §3.12; kurucu kararı 10-31 sabah). SAF, LLM'siz, veritabanısız.
// Can güvenliği → WhatsApp + e-posta İKİSİ BİRDEN hemen; değilse önce WhatsApp, 10 dk okunmazsa e-posta.
// Kurucunun listesi: yangın / duman · gaz / karbonmonoksit · elektrik · TIBBİ DURUM / YARALANMA · SU BASKINI · MAHSUR KALMA / HIRSIZ /
// TEHDİT · KATEGORİSİZ "ACİL / YARDIM". Kapıda kalma / anahtar kaybı, şikâyet, arıza, para, iptal → standart (önce WhatsApp).
//  · `riskType: safety_emergency` KULLANILMAZ: kelime ağı kapıda kalmayı ve "ACİL klima çalışmıyor"u da o etikete koyuyor.
//  · Yalnız ZAMANLAMAYI belirler (hangi mesajın acil uyarısı olduğu değişmez): fazla eşleşme bugünkü davranışa düşer (ikisi birden) —
//    şüphede can güvenliği.
//  · "Kategorisiz acil": genel acil sözcüğü var ve o sözcük çıkarılınca hiçbir risk kategorisi (kapıda kalma, şikâyet, para…) kalmıyor.
// ---------------------------------------------------------------------------

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";

/** Genel acil / yardım çağrısı (TR katlanmış ASCII + 6 dil). Kendi başına kategori DEĞİLDİR. */
const GENERIC_URGENT = new RegExp(
  `${L}(?:acil|acilen|acile|acilde|acilden|aciliyet|aciliyeti|acildir|imdat|yardim edin|yardim lazim|emergency|emergencies|urgent|urgently|asap|help|please help|dringend|notfall|hilfe|urgence|au secours|urgente|urgencia|emergencia|socorro|ayuda|срочно|экстренно|помогите|عاجل|طارئ|النجدة|ساعدوني)${R}`,
  "giu",
);

/**
 * Bugünkü acil ağının TANIMADIĞI, kurucunun can güvenliği saydığı durumlar (ölçüldü 10-31: "asansörde mahsur kaldık", "hırsız girdi", "biri
 * kapıyı zorluyor", "tehdit ediyor", "allergic reaction" hiçbir ağa takılmıyordu). Yalnız bu sınıflayıcıda — acil uyarısını tetikleyen ağ
 * DEĞİŞMEDİ (o ayrı karar). Sonu "*" olan KÖKTÜR (en çok 24 harf ek alır); öteki TAM sözcük / öbek (sağ sınır şart — "robo" "robot"un başında
 * tutmasın). "*" yalnız sonda olabilir (ortada düzenli ifade niceleyicisi olur — inceleme 10-31: Rusça "застрял* в лифте" çoğulu kaçırıyordu).
 * Kalıplar Latin aksanı sökülmüş metne uygulanır ("inconsciente" / "évanoui" aksanlı yazımla da).
 */
const EXTRA_WORDS = [
  // Mahsur kalma (asansör / içeride sıkışma). "İçeride kaldı / kilitli" BİLEREK YOK — anahtar için de söylenir (kapıda kalma = standart);
  // içeride kilitli kalmayı ("çocuk banyoda kilitli kaldı") acil ağı zaten tanıyor ve kapıda kalma değilse can güvenliği sayılır.
  "mahsur*", "asansorde kald*", "asansorde sikis*", "trapped", "eingesperrt", "eingeschlossen", "atrapad*", "застрял(?:а|и|о)? в лифте",
  // Hırsız / zorla giriş / tehdit
  "hirsiz*", "soyuldu*", "soydular", "kapiyi zorlu*", "zorla gir*", "tehdit*", "birisi iceri girdi", "biri iceri girdi",
  "thief", "thieves", "burglar*", "broke in", "break-in", "break in", "breaking in", "intruder*", "robbed", "threaten*", "stalker*",
  "einbrecher*", "einbruch*", "dieb", "diebe", "diebstahl", "bedroht*", "voleur*", "cambriol*", "menace*", "ladron*", "robo", "amenaz*",
  "вор", "воры", "вора", "ограб*", "взлом*", "угрож*",
  // Tıbbi / yaralanma ("bayıldık / bayılıyorum" = çok beğendik — yalnız 3. tekil tam biçimler)
  "bayildi", "bayiliyor", "kalp krizi*", "nefes alamiyor*", "alerji*", "nobet geciriyor*", "kriz geciriyor*", "zehirlen*", "yaralandi*",
  "kaniyor", "bacagi kirildi", "kolu kirildi", "bacagim kirildi", "kolum kirildi",
  "fainted", "passed out", "unconscious", "heart attack", "can.t breathe", "cannot breathe", "not breathing", "allergic reaction", "seizure*",
  "overdose*", "poisoned", "bleeding", "injured", "broke (?:his|her|my|a) (?:leg|arm|ankle|wrist|hip)", "broken (?:leg|arm|bone|ankle|hip)",
  "bewusstlos", "ohnmacht*", "herzinfarkt", "allergische reaktion", "verletzt", "blutet", "evanoui*", "crise cardiaque", "blesse*", "saigne*",
  "inconsciente", "desmay*", "infarto", "herid[oa]s?", "sangra*", "без сознания", "сердечный приступ", "аллерги*", "кровотеч*", "ранен*",
  // Kendine zarar
  "intihar*", "kendimi oldur*", "suicide", "kill myself", "selbstmord*", "suicid*", "самоубий*",
] as const;
/** Arapça: tanım edatı ve bitişik ön ekler ("اللص", "للتهديد", "فاللص") kelimenin parçasıdır — ön ek isteğe bağlı. */
const AR_PREFIX = "(?:[وفبك]?ال|[وف]?لل|[وفبلك])?";
const EXTRA_AR = ["لص", "لصوص", "سرقة*", "تهديد*", "إغماء", "اغماء", "نوبة قلبية", "حساسية*", "انتحار*", "مصاب*", "نزيف*"] as const;

for (const w of [...EXTRA_WORDS, ...EXTRA_AR]) {
  if (w.slice(0, -1).includes("*")) throw new Error(`life-safety: "*" yalnız sonda olabilir: ${w}`);
}
const stem = (w: string, prefix = "") => (w.endsWith("*") ? `${L}${prefix}${w.slice(0, -1)}\\p{L}{0,24}` : `${L}${prefix}${w}${R}`);
const EXTRA_LIFE_SAFETY = new RegExp([...EXTRA_WORDS.map((w) => stem(w)), ...EXTRA_AR.map((w) => stem(w, AR_PREFIX))].join("|"), "iu");

/**
 * Asansörde mahsur kalma — sözcük sırası serbest, arada en çok 4 sözcük ("stuck in an elevator", "the lift is stuck and we are inside",
 * "bloqués dans l'ascenseur", "застряли в лифте"). Türkçe "kaldık" çok genel → yalnız bitişik biçim (↑"asansorde kald*").
 */
const TRAP = "(?:stuck|trapped|feststeck|steck|eingeschlossen|bloque|coince|atrapad|encerrad|застря|mahsur|sikis)";
const ELEVATOR = "(?:elevator|lift|aufzug|fahrstuhl|ascenseur|ascensor|лифт|asansor)";
const GAP = "(?:[\\s'’]+\\p{L}{1,24}){0,4}?[\\s'’]+";
const TRAPPED_IN_ELEVATOR = new RegExp(`${L}${TRAP}\\p{L}{0,24}${GAP}${ELEVATOR}|${L}${ELEVATOR}\\p{L}{0,24}${GAP}${TRAP}`, "iu");

/** Latin aksanını söker (Kiril / Arap yazısına dokunmaz: "й" ayrışıp "и" olmasın). */
const stripLatinMarks = (s: string) => s.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");

/** Yan cümleler (kapıda kalma ifadesi öteki tehlike sözünü gizlemesin diye): noktalama ve 7 dilde "ve". */
const CLAUSES = /[.,;:!?\n]+|\s(?:and|ve|und|et|y|e|и|و)\s/u;
/** Giriş / kapı / anahtar / kilit sözü taşıyan yan cümle kapıda kalmanın parçasıdır ("Lost the key, can't get in"). Katlanmış metinde. */
const ENTRY_HINT =
  /get in|getting in|come in|go in|enter|door|key|lock|ic[ei]ri|gir|kapi|anahtar|kilit|sifre|kod|schlussel|tur(?!\p{L})|rein|porte|cle(?!\p{L})|entrer|puerta|llave|entrar|двер|ключ|войти|зайти|باب|مفتاح|دخول/u;

export type LifeSafetyBasis = "hazard" | "safety_net" | "extra" | "generic_urgent" | "understanding" | "none";

export interface LifeSafetyVerdict {
  lifeSafety: boolean;
  basis: LifeSafetyBasis;
}

/** Bir misafir metni can güvenliği mi (gerekçesiyle). */
function textVerdict(text: string): LifeSafetyBasis {
  const h = hazardEvidenceOf(text);
  if (h.level === "clear" || h.level === "possible") return "hazard";
  const folded = foldTurkishAscii(text).toLowerCase();
  const latin = stripLatinMarks(folded);
  if (EXTRA_LIFE_SAFETY.test(latin) || TRAPPED_IN_ELEVATOR.test(latin)) return "extra";
  // Kapıda kalma / anahtar kaybı → standart (acil sözcüğü olsa bile — "ACİL kapıda kaldık"). Acil ağı kapıda kalma ifadelerini de tanıdığı
  // için o yan cümle ayrılır; KALAN yan cümlelerde acil ağı tutarsa can güvenliğidir ("kapıda kaldık, çocuk içeride nefes almıyor").
  if (isAccessLossText(text)) {
    const others = text
      .split(CLAUSES)
      .map((c) => stripLatinMarks(foldTurkishAscii(c).toLowerCase()))
      .filter((c) => c.trim() !== "" && !isAccessLossText(c) && !ENTRY_HINT.test(c));
    return others.some((c) => isSafetyEmergencyText(c.replace(GENERIC_URGENT, " "))) ? "safety_net" : "none";
  }
  // `replace` (g bayraklı) her çağrıda baştan tarar — `test` + `lastIndex` durumu yok; değişen metin = genel acil sözcüğü vardı.
  const stripped = folded.replace(GENERIC_URGENT, " ");
  if (isSafetyEmergencyText(stripped)) return "safety_net";
  if (stripped !== folded) {
    // `safety_emergency` burada çıkamaz (aynı ağ bir satır yukarıda aynı metinle bakıldı). Enjeksiyon ve "ev sahibiyle görüşmek istiyorum"
    // kategori sayılmaz (inceleme 10-31: "URGENT my wife fell … I need to talk to the host" standarda düşüyordu) — acil çağrının parçası.
    const categories = detectRiskTypes(stripped).filter((c) => c !== "prompt_injection" && c !== "human_request");
    if (categories.length === 0) return "generic_urgent";
  }
  return "none";
}

/**
 * Turun misafir metinleri (yalnız tetikleyen mesaj değil — model yolunda cevapsız bütün misafir mesajları) + model yolunda anlama katmanının
 * "acil" hükmü (`true` = acil; koşmadıysa / bilinmiyorsa verilmez).
 */
export function lifeSafetyOf(input: { texts: readonly string[]; understandingEmergency?: boolean | null }): LifeSafetyVerdict {
  for (const t of input.texts) {
    if (typeof t !== "string" || t.trim() === "") continue;
    const basis = textVerdict(t.slice(0, 8_000));
    if (basis !== "none") return { lifeSafety: true, basis };
  }
  if (input.understandingEmergency === true) return { lifeSafety: true, basis: "understanding" };
  return { lifeSafety: false, basis: "none" };
}
