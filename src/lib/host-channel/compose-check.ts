import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { admitsMissingKnowledge, namesInternalSource } from "@/lib/ai/absence";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { containsContactValue } from "@/lib/contact-redact";

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
  | "contact_value";

/** Metindeki sayı dizileri (saat, tutar, kod, telefon parçası) — "20" ile "200" ayrı. Binlik ayracı / ondalık normalize edilmez: kaynakta
 *  harfiyen geçmeyen biçim reddedilir (şüphede reddet). */
export function numberTokens(text: string): string[] {
  return [...text.normalize("NFKC").matchAll(/\d+(?:[.,:]\d+)*/gu)].map((m) => m[0]);
}

/** Tam saat biçimleri ("13", "13:00", "13.00") aynı saat sayılır; dakikalı saat ("13:30") yalnız kendisidir. */
function timeAliases(token: string): string[] {
  const m = /^(\d{1,2})(?:[:.]00)?$/u.exec(token);
  if (!m || Number(m[1]) > 24) return [token];
  const h = String(Number(m[1]));
  return [token, h, `${h}:00`, `${h}.00`, h.padStart(2, "0"), `${h.padStart(2, "0")}:00`, `${h.padStart(2, "0")}.00`];
}

export function checkComposedGuestReply(input: { reply: string; hostAnswer: string; kbTexts?: readonly string[] }): ComposeCheckFailure | null {
  const reply = input.reply.trim();
  if (!reply) return "empty";
  const sources = [input.hostAnswer, ...(input.kbTexts ?? [])].join("\n").normalize("NFKC");
  const sourceNumbers = new Set(numberTokens(sources).flatMap(timeAliases));
  // Her sayı kaynakta tam belirteç olarak geçmeli (alt dize değil: "20" kaynaktaki "200"den türemez). Tam saat denktir: ev sahibinin "13"ü
  // cevapta "13:00" / "13.00" olabilir (gerçek model denemesi 10-30: "14 olmaz, en geç 13" → "13:00" reddediliyordu); dakika uydurulamaz.
  if (numberTokens(reply).some((n) => !timeAliases(n).some((a) => sourceNumbers.has(a)))) return "number_not_in_source";
  if (hostVoiceViolation(reply) !== null) return "host_voice";
  if (vetoOutgoingReply(reply) !== null) return "output_veto";
  // Ev sahibinin ağzından "ev sahibinize yazın" anlamsız: süzgeç bir şey silerse cevap gitmez.
  if (analyzeHostContact(reply).removals.length > 0) return "host_contact";
  if (admitsMissingKnowledge(reply)) return "absence";
  if (namesInternalSource(reply)) return "internal_source";
  // Airbnb kuralı: telefon / e-posta / bağlantı misafire bu yoldan gitmez (ev sahibi yazmış olsa bile).
  if (containsContactValue(reply)) return "contact_value";
  return null;
}
