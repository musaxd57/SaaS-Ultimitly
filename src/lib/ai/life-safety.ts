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
 * DEĞİŞMEDİ (o ayrı karar).
 */
const EXTRA_LIFE_SAFETY = new RegExp(
  [
    // Mahsur kalma (asansör / içeride sıkışma). "İçeride kaldı / kilitli" BİLEREK YOK — anahtar için de söylenir (kapıda kalma = standart);
    // içeride kilitli kalmayı ("çocuk banyoda kilitli kaldı") acil ağı zaten tanıyor ve kapıda kalma değilse can güvenliği sayılır.
    "mahsur*", "asansorde kald*", "asansorde sikis*", "stuck in the (?:lift|elevator)", "trapped", "eingesperrt", "im aufzug stecken*",
    "bloque dans l.ascenseur", "atrapad[oa]s?", "застрял* в лифте", "عالق*", "محبوس*",
    // Hırsız / zorla giriş / tehdit
    "hirsiz*", "soyuldu*", "soydular", "kapiyi zorlu*", "zorla gir*", "tehdit*", "birisi iceri girdi", "biri iceri girdi",
    "thief", "thieves", "burglar*", "broke in", "break-in", "intruder*", "robbed", "threaten*", "stalker*",
    "einbrecher*", "einbruch*", "dieb", "diebe", "diebstahl", "bedroht*", "voleur*", "cambriol*", "menace*", "ladron*", "robo", "amenaz*",
    "вор", "воры", "вора", "ограб*", "взлом*", "угрож*", "لص", "لصوص", "سرقة", "تهديد",
    // Tıbbi ("bayıldık / bayılıyorum" = çok beğendik — yalnız 3. tekil tam biçimler)
    "bayildi", "bayiliyor", "kalp krizi*", "nefes alamiyor*", "alerji*", "nobet geciriyor*", "kriz geciriyor*", "zehirlen*",
    "fainted", "passed out", "unconscious", "heart attack", "can.t breathe", "cannot breathe", "allergic reaction", "seizure*", "overdose*",
    "poisoned", "bewusstlos", "ohnmacht*", "herzinfarkt", "allergische reaktion", "evanoui*", "crise cardiaque", "inconsciente", "desmay*",
    "infarto", "без сознания", "сердечный приступ", "аллерги*", "إغماء", "نوبة قلبية", "حساسية",
    // Kendine zarar
    "intihar*", "kendimi oldur*", "suicide", "kill myself", "selbstmord*", "suicid*", "самоубий*", "انتحار",
  ]
    // Sonu "*" olan KÖKTÜR (ek alabilir); öteki TAM sözcük / öbek (sağ sınır şart — "robo" "robot"un başında tutmasın).
    .map((w) => (w.endsWith("*") ? `${L}${w.slice(0, -1)}` : `${L}${w}${R}`))
    .join("|"),
  "iu",
);

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
  if (EXTRA_LIFE_SAFETY.test(folded)) return "extra";
  // Kapıda kalma / anahtar kaybı → standart (acil sözcüğü olsa bile — "ACİL kapıda kaldık").
  if (isAccessLossText(text)) return "none";
  // `replace` (g bayraklı) her çağrıda baştan tarar — `test` + `lastIndex` durumu yok; değişen metin = genel acil sözcüğü vardı.
  const stripped = folded.replace(GENERIC_URGENT, " ");
  if (isSafetyEmergencyText(stripped)) return "safety_net";
  if (stripped !== folded) {
    const categories = detectRiskTypes(stripped).filter((c) => c !== "prompt_injection" && c !== "safety_emergency");
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
