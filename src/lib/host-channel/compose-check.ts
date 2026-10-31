import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { admitsMissingKnowledge, namesInternalSource } from "@/lib/ai/absence";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { containsContactValue } from "@/lib/contact-redact";
import { foldPaymentText, namesPaymentMethodInProse } from "@/lib/payment-method-guard";
import { asciiDigits } from "./digits";

// ---------------------------------------------------------------------------
// Ev sahibinin cevabından kurulan MİSAFİR cevabının KOD denetimi (tasarım §3.6). SAF. Model ev sahibinin sözünü misafirin dilinde, ev
// sahibinin ağzından yazar; bu denetim yazılanın YALNIZ o söze ve verilen bilgi tabanı metnine dayandığını sınar. Herhangi biri düşerse
// misafire gitmez, ev sahibine "panelde yazın" denir. Bugünkü çıktı kapıları (gönderim yolu) ayrıca aynen koşar.
// ---------------------------------------------------------------------------

export type ComposeCheckFailure =
  | "empty"
  | "number_not_in_source"
  | "host_voice"
  | "output_veto"
  | "host_contact"
  | "absence"
  | "internal_source"
  | "contact_value"
  | "payment_method"
  | "channel_mention"
  | "apology";

// Arapça "٥٠٠", Farsça "۵۰۰", Devanagari "५००" `\d` ile görülmüyordu (inceleme 10-30 gece D) — tek kural `digits.ts`.
export { asciiDigits } from "./digits";

/** Metindeki sayı dizileri (saat, tutar, kod, telefon parçası) — "20" ile "200" ayrı. Binlik ayracı / ondalık normalize edilmez: kaynakta
 *  harfiyen geçmeyen biçim reddedilir (şüphede reddet). Rakam yazısı fark etmez (`asciiDigits`). */
export function numberTokens(text: string): string[] {
  return [...asciiDigits(text).matchAll(/\d+(?:[.,:]\d+)*/gu)].map((m) => m[0]);
}

/**
 * Saat biçimleri: tam saat ("13", "13:00", "13.00") aynı saattir; dakikalı saatte ayraç fark etmez ("20.30" = "20:30", inceleme 10-31: model
 * Türkçede noktalı yazıyordu) ama dakika uydurulamaz. Para / ondalık değildir diye bir sınır yok — kaynakta harfiyen geçen sayı zaten serbest.
 */
function timeAliases(token: string): string[] {
  const whole = /^(\d{1,2})(?:[:.]00)?$/u.exec(token);
  if (whole && Number(whole[1]) <= 24) {
    const h = String(Number(whole[1]));
    return [token, h, `${h}:00`, `${h}.00`, h.padStart(2, "0"), `${h.padStart(2, "0")}:00`, `${h.padStart(2, "0")}.00`];
  }
  const hm = /^(\d{1,2})[:.](\d{2})$/u.exec(token);
  if (hm && Number(hm[1]) <= 23 && Number(hm[2]) <= 59) {
    const h = String(Number(hm[1]));
    const p = h.padStart(2, "0");
    return [token, `${h}:${hm[2]}`, `${h}.${hm[2]}`, `${p}:${hm[2]}`, `${p}.${hm[2]}`];
  }
  return [token];
}

const fold = (s: string) => foldPaymentText(s).replace(/’/g, "'");

/**
 * Akşam saati (ev sahibinin "akşam 8"i misafirin dilinde "20 Uhr"). İşaret KONUMSALDIR (inceleme 10-31: "3 gece kalabilirsiniz" / "2 noches"
 * / "Минимум 2 дня" uydurulmuş saati geçiriyordu): sayıdan HEMEN önce (bağlaç olabilir: "this evening at 8", "akşam saat 8") ya da HEMEN
 * sonra ("8 pm", "8pm", "8 de la tarde", "8 вечера", "2 часа дня"). Gece sözcükleri ("gece", "de la noche", "ночи") yalnız 6–11'i kaydırır
 * ("gece 2" = 02:00, asla 14:00); "gece 12" gece yarısıdır.
 */
const CONNECTOR = "(?:(?:saat|at|um|a las|a la|à|a|vers|в|الساعة|ab|from|after|until|till|bis|des|desde)\\s+)?";
const BEFORE_PM = new RegExp(
  `(?:aksam\\p{L}{0,8}|ogle?den sonra|this evening|in the evening|evening|afternoon|abends?|nachmittags?|ce soir|soir|apres-midi|esta tarde|por la tarde|вечером|مساء)(?:\\s+\\p{L}{1,12})?\\s*${CONNECTOR}$`,
  "u",
);
const BEFORE_NIGHT = new RegExp(`(?:gece|at night|tonight|nachts|cette nuit|esta noche|por la noche|ночью|ليلا)\\s*${CONNECTOR}$`, "u");
const AFTER_PM =
  /^\s*(?:p\.?\s?m(?![a-z])|(?:uhr\s+)?(?:abends|nachmittags)|(?:h|heures?)?\s*(?:du soir|de l'apres-midi)|de la tarde|(?:час(?:а|ов)?\s+)?вечера|час(?:а|ов)?\s+дня|in the (?:evening|afternoon)|(?:'?(?:d[ae]n|t[ae]n))?\s*sonra aksam|aksam\p{L}{0,8})/u;
const AFTER_NIGHT = /^\s*(?:de la noche|(?:час(?:а|ов)?\s+)?ночи|at night|in the night|la nuit)/u;
/** Bir aralığın ikinci ucu öncekinin işaretini taşır ("akşam 8-9 arası", "8 to 9 pm"). */
const RANGE_GAP = /^\s*(?:-|–|ile|ve|veya|or|to|and|bis|und|a|à|ou|y|o|и|или|до|و|الى)\s*$/u;
const CLOCK = /^(\d{1,2})([:.]\d{2})?$/u;

/** "akşam 8" → 20 (dakika korunur); gece işaretinde yalnız 6–11; 12 gece → 0. */
function shiftedAliases(token: string, kind: "pm" | "night"): string[] {
  const m = CLOCK.exec(token);
  if (!m) return [];
  const h = Number(m[1]);
  const mm = m[2] ?? "";
  if (kind === "night" && h === 12 && !mm) return ["0", "00:00", "0:00", "24:00", "24"];
  if (h < 1 || h > 11 || (kind === "night" && h < 6)) return [];
  return timeAliases(`${h + 12}${mm}`);
}

/** Metindeki saatlerin akşam / gece karşılıkları (24 saat). Yalnız işaretin hemen bitişiğindeki ya da aralıkla bağlı saatler. */
function eveningAliases(text: string): string[] {
  const t = asciiDigits(text);
  const out: string[] = [];
  let prev: { end: number; kind: "pm" | "night" | null } | null = null;
  for (const m of t.matchAll(/\d+(?:[.,:]\d+)*/gu)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    // Önceki sayıdan / yan cümle sınırından sonrası (başka saatin işareti bu saate geçmesin: "akşam 7, sabah 8", "sabah 8 akşam 6").
    const start: number = Math.max(prev ? prev.end : 0, at - 30);
    const before: string = fold(t.slice(start, at)).split(/[,;!?\n]/u).at(-1) ?? "";
    const after: string = fold(t.slice(end, end + 24)).split(/[,;!?\n]/u)[0] ?? "";
    let kind: "pm" | "night" | null =
      BEFORE_PM.test(before) || AFTER_PM.test(after) ? "pm" : BEFORE_NIGHT.test(before) || AFTER_NIGHT.test(after) ? "night" : null;
    if (!kind && prev?.kind && RANGE_GAP.test(t.slice(prev.end, at))) kind = prev.kind;
    if (!kind && /^\s*(?:-|–|to|bis|a|à|до)\s*\d/u.test(t.slice(end, end + 6))) {
      // Aralığın ilk ucu ikincinin işaretini alır ("8-9 pm").
      const second = /^\s*(?:-|–|to|bis|a|à|до)\s*(\d+(?:[.,:]\d+)*)/u.exec(t.slice(end, end + 12));
      if (second) {
        const tail = fold(t.slice(end + second[0].length, end + second[0].length + 24));
        kind = AFTER_PM.test(tail) ? "pm" : AFTER_NIGHT.test(tail) ? "night" : null;
      }
    }
    if (kind) out.push(...shiftedAliases(m[0], kind));
    prev = { end, kind };
  }
  return out;
}

/**
 * Yapay zekânın KENDİLİĞİNDEN özrü (7 dil) — kurucu 10-31: "Ev sahibi isterse gitsin". KUSUR KABULÜ ayrı ("haklısınız", "our fault"):
 * tarafsızlık kuralı (10-21/22) gereği yalnız ev sahibi kusuru kendisi yazdıysa gider. Kalıplar katlanmış metinde; belirsiz sözcükler
 * dar biçimde (inceleme 10-31: "excusado" tuvalet, Arapça "أسفل" aşağıda, "للأسف" ne yazık ki, "bedauerlicherweise" ne yazık ki,
 * "You're right next to the beach" konum).
 */
const APOLOGY = new RegExp(
  [
    "ozur", "uzgun", "kusura bakma", "affiniza", "affeders", "affedin",
    "sorry", "apolog", "(?<![a-z])regret(?!tab)", "entschuldig", "tut (?:uns|mir) leid", "bedauer(?:n|e|t)(?![a-z])",
    "desole", "excus(?:ez|er|es)(?![a-z])", "excuse (?:us|the)", "m'excuse", "(?<![a-z])pardon", "regrett", "lo siento", "lo sentimos", "lament(?:o|amos)(?![a-z])", "disculp", "perdon",
    "извин", "прости", "прощени", "сожале(?:ем|ю|ет)", "жаль", "сочувств",
    "(?<!\\p{L})(?:ا|ن)?اسف(?:ة|ون|ين)?(?!\\p{L})", "نعتذر", "اعتذار", "معذر", "عذرا", "يؤسف",
  ].join("|"),
  "u",
);
const FAULT = /our fault|my fault|haklisiniz|hakli\s?siniz|hatamiz|kusur bizde|unser fehler|notre faute|nuestra culpa|наша вина|خطؤنا|you(?:'| a)re (?:absolutely |completely |quite )?right(?=\s*(?:[,.!;]|$|about))/u;
/** Ev sahibinin "özür DİLEME" demesi özrü açmaz. */
const NO_APOLOGY = /ozur dileme(?![kys])|ozur dilemeyin|don'?t apologi|do not apologi|no apolog/u;
export const apologizes = (text: string): boolean => {
  const f = fold(text);
  return APOLOGY.test(f) || FAULT.test(f);
};
function apologyHeld(reply: string, hostAnswer: string): boolean {
  const r = fold(reply);
  const h = fold(hostAnswer);
  if (FAULT.test(r) && !FAULT.test(h)) return true;
  return APOLOGY.test(r) && !((APOLOGY.test(h) || FAULT.test(h)) && !NO_APOLOGY.test(h));
}

/**
 * Platform dışına (başka uygulamaya) çağrı — Airbnb / Booking kuralı; telefon / bağlantı ayrıca `contact_value`. Görünmez karakter silinir,
 * harf arası ayraç birleştirilmiş biçim de denenir ("What​sApp", "Whats-App"). Belirsiz kısa adlar (signal, line, wa, dm) BİLEREK yok —
 * "Wi-Fi signal" sıradan cevap; ev sahibi önizlemeyi görür.
 */
const OFF_PLATFORM_CHANNEL =
  /whats\s?app|wa\.me|watsapp?|vatsap|telegram|viber|wechat|weixin|instagram|(?<![a-z])insta(?![a-z])|facebook|messenger|imessage|snapchat|skype|discord|kakao ?talk|(?<![a-z])wp'?(?:den|dan|ten|tan)(?![a-z])|ватсап|вотсап|вацап|вайбер|телеграм|инстаграм|фейсбук|واتس|تيليجرام|تليجرام|تلجرام|تلغرام|انستغرام|انستجرام|انستا|فيسبوك|سناب/u;
const NOT_CHANNEL = /messenger ?bags?|instagram(?:-| )?worthy|instagrammable/gu;
export const mentionsOffPlatformChannel = (text: string): boolean => {
  const f = fold(text.replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}⠀]/gu, "")).replace(NOT_CHANNEL, " ");
  return OFF_PLATFORM_CHANNEL.test(f) || OFF_PLATFORM_CHANNEL.test(f.replace(/(?<=\p{L})[-_.](?=\p{L})/gu, ""));
};

/**
 * Ev sahibinin cevabı kendi SÖZÜNÜ veriyor mu ("yarın havlu göndereceğim", "I'll bring it"). Öyleyse cevaptaki söz ev sahibinindir —
 * "makbuzsuz söz" vetosu (yapay zekânın uydurduğu eylem iddiası için) uygulanmaz; ev sahibi önizlemeyi görüp [Gönder]'e basar.
 * Türkçe 1. kişi gelecek (resmî + konuşma dili) + İngilizce (kesme işareti ŞART: "well" / "ill" söz değildir); öteki diller çıktı vetosunun
 * kendisiyle (ev sahibi metni de veto alıyorsa). Bilinen sınır: muafiyet mesaj düzeyinde, cümle düzeyinde değil.
 */
const HOST_OWN_PROMISE =
  /[a-z](?:ecegi[mz]|acagi[mz]|ecem|acam|icem|icam|ucam|ucem|ecez|acaz|icez|icaz|ucaz|ucez)(?![a-z])|(?<![a-z])(?:i'll|i will|we'll|we will|i am going to|i'm going to|we are going to|we're going to)(?![a-z])/u;
export function hostMakesOwnPromise(hostAnswer: string): boolean {
  return HOST_OWN_PROMISE.test(fold(hostAnswer)) || vetoOutgoingReply(hostAnswer) === "unverified_commitment";
}

export function checkComposedGuestReply(input: { reply: string; hostAnswer: string; kbTexts?: readonly string[] }): ComposeCheckFailure | null {
  const reply = input.reply.trim();
  if (!reply) return "empty";
  // Airbnb kuralı: telefon / e-posta / bağlantı misafire bu yoldan gitmez (ev sahibi yazmış olsa bile). ÖNCE: telefon numarası "uydurulmuş
  // sayı" diye değil, gerçek nedeniyle söylensin.
  if (containsContactValue(reply) || containsContactValue(asciiDigits(reply))) return "contact_value";
  const sources = [input.hostAnswer, ...(input.kbTexts ?? [])].join("\n").normalize("NFKC");
  const sourceNumbers = new Set([...numberTokens(sources).flatMap(timeAliases), ...eveningAliases(sources)]);
  // Her sayı kaynakta tam belirteç olarak geçmeli (alt dize değil: "20" kaynaktaki "200"den türemez). Tam saat denktir: ev sahibinin "13"ü
  // cevapta "13:00" / "13.00" olabilir (gerçek model denemesi 10-30: "14 olmaz, en geç 13" → "13:00" reddediliyordu); dakika uydurulamaz.
  // Akşam saati iki yönde denktir: kaynakta "akşam 8" → cevapta 20; kaynakta "20" → cevapta yanında akşam işaretiyle "8 pm".
  const replyEvening = new Set(eveningAliases(reply));
  if (
    numberTokens(reply).some((n) => {
      if (timeAliases(n).some((a) => sourceNumbers.has(a))) return false;
      // Ters yön: cevapta "8 pm" / "gece 11" yazıldıysa 24 saatlik karşılığı kaynakta olmalı.
      return ![...shiftedAliases(n, "pm"), ...shiftedAliases(n, "night")].some((a) => replyEvening.has(a) && sourceNumbers.has(a));
    })
  ) {
    return "number_not_in_source";
  }
  if (hostVoiceViolation(reply) !== null) return "host_voice";
  // Platform kuralları ev sahibi istese de değişmez (tasarım §3.6b): ödeme yöntemi, başka uygulama, telefon / e-posta / bağlantı.
  if (namesPaymentMethodInProse(reply)) return "payment_method";
  if (mentionsOffPlatformChannel(reply)) return "channel_mention";
  if (apologyHeld(reply, input.hostAnswer)) return "apology";
  const veto = vetoOutgoingReply(reply);
  if (veto !== null && !(veto === "unverified_commitment" && hostMakesOwnPromise(input.hostAnswer))) return "output_veto";
  // Ev sahibinin ağzından "ev sahibinize yazın" anlamsız: süzgeç bir şey silerse cevap gitmez.
  if (analyzeHostContact(reply).removals.length > 0) return "host_contact";
  if (admitsMissingKnowledge(reply)) return "absence";
  if (namesInternalSource(reply)) return "internal_source";
  return null;
}
