import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { admitsMissingKnowledge, namesInternalSource } from "@/lib/ai/absence";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { containsContactValue } from "@/lib/contact-redact";
import { foldPaymentText, namesPaymentMethod } from "@/lib/payment-method-guard";
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

/** Tam saat biçimleri ("13", "13:00", "13.00") aynı saat sayılır; dakikalı saat ("13:30") yalnız kendisidir. */
function timeAliases(token: string): string[] {
  const m = /^(\d{1,2})(?:[:.]00)?$/u.exec(token);
  if (!m || Number(m[1]) > 24) return [token];
  const h = String(Number(m[1]));
  return [token, h, `${h}:00`, `${h}.00`, h.padStart(2, "0"), `${h.padStart(2, "0")}:00`, `${h.padStart(2, "0")}.00`];
}

/**
 * Akşam / öğleden sonra işareti (7 dil). Ev sahibinin "akşam 8"i misafirin dilinde "20 Uhr" / "20:00" yazılır (ölçüldü 10-31: haksız
 * "uydurulmuş sayı" tutuşu). Yalnız sayının HEMEN yakınındaki işaret sayılır ("sabah 8, akşam 6" → yalnız 6 akşamdır).
 */
const EVENING = /aksam|ogleden sonra|ogle?den sonra|\bgece\b|\bp\.?\s?m\b|evening|tonight|afternoon|abends|nachmittags|soir|apres-midi|tarde|noche|вечер|дня|ночи|مساء/u;
const fold = (s: string) => foldPaymentText(s);

/** 12 saatlik "akşam 8" → 20 (dakika korunur); işaret yoksa ya da saat 1–11 değilse yok. */
function eveningShift(token: string): string | null {
  const m = /^(\d{1,2})([:.]\d{2})?$/u.exec(token);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 1 && h <= 11 ? `${h + 12}${m[2] ?? ""}` : null;
}

/**
 * Metindeki sayıların akşam karşılıkları — yalnız yakınında (aynı yan cümlede, öncesinde 16, sonrasında 14 karakter) akşam işareti olan
 * saatler: "sabah 8, akşam 6" → yalnız 6.
 */
function eveningAliases(text: string): string[] {
  const t = asciiDigits(text);
  const out: string[] = [];
  for (const m of t.matchAll(/\d+(?:[.,:]\d+)*/gu)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const before = t.slice(Math.max(0, at - 16), at).split(/[,;!?\n]/u).at(-1) ?? "";
    const after = t.slice(end, end + 14).split(/[,;!?\n]/u)[0] ?? "";
    const near = fold(`${before}${m[0]}${after}`);
    const shifted = eveningShift(m[0]);
    if (shifted && EVENING.test(near)) out.push(...timeAliases(shifted));
  }
  return out;
}

/**
 * Yapay zekânın KENDİLİĞİNDEN özrü / kusur kabulü (7 dil). Kurucu 10-31: "Ev sahibi isterse gitsin" — ev sahibinin yazısında özür sözcüğü
 * ya da özür isteği ("özür dile", "apologize") varsa geçer; yoksa tutulur (tarafsızlık kuralı 10-21: olaylar netleşmeden ev sahibi haksız
 * duruma düşürülmez).
 */
const APOLOGY = new RegExp(
  [
    "ozur", "uzgun", "kusura bakma", "affiniza", "haklisiniz", "hakli\\s?siniz",
    "sorry", "apolog", "our fault", "my fault", "you(?:'|’| a)re right",
    "entschuldig", "tut (?:uns|mir) leid", "bedauer",
    "desole", "excus", "pardon",
    "lo siento", "lo sentimos", "disculp", "perdon",
    "извин", "прости", "прощени", "сожалеем",
    "اسف", "آسف", "نعتذر", "اعتذار", "معذر", "عذرا",
  ].join("|"),
  "u",
);
export const apologizes = (text: string): boolean => APOLOGY.test(fold(text));

/** Platform dışına (başka uygulamaya) çağrı — Airbnb / Booking kuralı; telefon / bağlantı ayrıca `contact_value`. */
const OFF_PLATFORM_CHANNEL = /whats\s?app|wa\.me|telegram|viber|wechat|instagram|facebook|messenger|imessage|ватсап|вотсап|телеграм|واتس|تيليجرام|تلغرام/u;
export const mentionsOffPlatformChannel = (text: string): boolean => OFF_PLATFORM_CHANNEL.test(fold(text));

/**
 * Ev sahibinin cevabı kendi SÖZÜNÜ veriyor mu ("yarın havlu göndereceğim", "I'll bring it"). Öyleyse cevaptaki söz ev sahibinindir —
 * "makbuzsuz söz" vetosu (yapay zekânın uydurduğu eylem iddiası için) uygulanmaz; ev sahibi önizlemeyi görüp [Gönder]'e basar.
 * Türkçe 1. kişi gelecek (resmî + konuşma dili) + İngilizce; öteki diller çıktı vetosunun kendisiyle (ev sahibi metni de veto alıyorsa).
 */
const HOST_OWN_PROMISE =
  /[a-z](?:ecegi[mz]|acagi[mz]|ecem|acam|icem|icam|ucam|ucem|ecez|acaz|icez|icaz|ucaz|ucez)(?![a-z])|(?<![a-z])(?:i'?ll|i will|we'?ll|we will|i am going to|i'm going to|we are going to|we're going to)(?![a-z])/u;
export function hostMakesOwnPromise(hostAnswer: string): boolean {
  return HOST_OWN_PROMISE.test(fold(hostAnswer).replace(/’/g, "'")) || vetoOutgoingReply(hostAnswer) === "unverified_commitment";
}

export function checkComposedGuestReply(input: { reply: string; hostAnswer: string; kbTexts?: readonly string[] }): ComposeCheckFailure | null {
  const reply = input.reply.trim();
  if (!reply) return "empty";
  const sources = [input.hostAnswer, ...(input.kbTexts ?? [])].join("\n").normalize("NFKC");
  const sourceNumbers = new Set([...numberTokens(sources).flatMap(timeAliases), ...eveningAliases(sources)]);
  // Her sayı kaynakta tam belirteç olarak geçmeli (alt dize değil: "20" kaynaktaki "200"den türemez). Tam saat denktir: ev sahibinin "13"ü
  // cevapta "13:00" / "13.00" olabilir (gerçek model denemesi 10-30: "14 olmaz, en geç 13" → "13:00" reddediliyordu); dakika uydurulamaz.
  // Akşam saati iki yönde denktir: kaynakta "akşam 8" → cevapta 20; kaynakta "20" → cevapta yanında akşam işaretiyle "8 pm".
  const replyEvening = new Set(eveningAliases(reply));
  if (
    numberTokens(reply).some((n) => {
      if (timeAliases(n).some((a) => sourceNumbers.has(a))) return false;
      const shifted = eveningShift(n);
      return !(shifted && timeAliases(shifted).some((a) => replyEvening.has(a) && sourceNumbers.has(a)));
    })
  ) {
    return "number_not_in_source";
  }
  if (hostVoiceViolation(reply) !== null) return "host_voice";
  // Platform kuralları ev sahibi istese de değişmez (tasarım §3.6b): ödeme yöntemi, başka uygulama, telefon / e-posta / bağlantı.
  if (namesPaymentMethod(reply)) return "payment_method";
  if (mentionsOffPlatformChannel(reply)) return "channel_mention";
  if (apologizes(reply) && !apologizes(input.hostAnswer)) return "apology";
  const veto = vetoOutgoingReply(reply);
  if (veto !== null && !(veto === "unverified_commitment" && hostMakesOwnPromise(input.hostAnswer))) return "output_veto";
  // Ev sahibinin ağzından "ev sahibinize yazın" anlamsız: süzgeç bir şey silerse cevap gitmez.
  if (analyzeHostContact(reply).removals.length > 0) return "host_contact";
  if (admitsMissingKnowledge(reply)) return "absence";
  if (namesInternalSource(reply)) return "internal_source";
  // Airbnb kuralı: telefon / e-posta / bağlantı misafire bu yoldan gitmez (ev sahibi yazmış olsa bile).
  if (containsContactValue(reply) || containsContactValue(asciiDigits(reply))) return "contact_value";
  return null;
}
