import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// CEVAP ÖLÇÜLERİ — eval araçlarının ORTAK yardımcıları (model kıyası + Konuşma Anlama Durumu). Deterministik; LLM
// grader YOK. Test dosyası başka bir test dosyasını içe aktarmaz (vitest onun testlerini ikinci kez kaydederdi) —
// paylaşılan ölçü burada yaşar.
// ---------------------------------------------------------------------------

/** Cevabın selamla açılması (önceki cevaptan SONRA = selam tekrarı). */
export const GREETING =
  /^\s*(merhaba|selam|iyi (?:günler|akşamlar)|hi\b|hello|hey|dear|hallo|guten|bonjour|hola|buenos|здравствуй|привет|добр|مرحب|أهلا|السلام)/iu;

/**
 * Bekleme sözü ölçüsü: ürünün çıktı vetosu cevabı SÖZ sayıyor mu. Tek kaynak ürünün yüklemi — eval ikinci bir söz
 * sözlüğü YAZMAZ (ölçü ile kapı ayrışırsa hangisinin doğru olduğu bilinemez). Yer tutucu vetosu söz değildir.
 */
export function promiseInReply(reply: string): boolean {
  return vetoOutgoingReply(reply) === "unverified_commitment";
}

/**
 * Cevabın misafire sorduğu soru cümleleri: soru işaretiyle (Latin, tam genişlik, Arapça) biten cümle. İspanyolca açılış
 * işareti cümleye dahil edilmez. Sayım kabadır — rapor soruları AYNEN basar, insan okur.
 */
export function questionSentences(reply: string): string[] {
  return (reply.match(/[^.!?？؟¿\n]*[?？؟]/gu) ?? []).map((q) => q.trim()).filter((q) => /\p{L}/u.test(q));
}

const NL = "(?<!\\p{L})";

/**
 * GENEL NETLEŞTİRME (MÇ v2 §1.4: "Biraz daha açıklar mısınız?" yazılmaz — iki anlam gerçekten eşitse EN OLASI anlamı
 * öneren tek soru). Olası anlamı adlandırmadan açıklama isteyen soru kalıpları, yedi dil. Kapalı liste, KABA bir ölçüdür
 * (karar değil): hedef 0 olduğu için kaçan biçim rapordaki soru listesinde görünür.
 */
const GENERIC_CLARIFICATION: readonly RegExp[] = [
  new RegExp(`${NL}(?:biraz\\s+)?(?:daha\\s+)?(?:açıklar|açabilir|detaylandırabilir|netleştirebilir|açıklayabilir)\\s*m[ıi]s[ıi]n[ıi]z`, "iu"),
  new RegExp(`${NL}ne(?:yi)?\\s+(?:demek\\s+istediğinizi|kastettiğinizi)`, "iu"),
  new RegExp(`${NL}daha\\s+fazla\\s+(?:bilgi|detay|ayrıntı)\\s+(?:verebilir|paylaşabilir|iletebilir)`, "iu"),
  /\b(?:could|can|would)\s+you\s+(?:please\s+)?(?:clarify|elaborate|explain|be\s+more\s+specific|provide\s+(?:some\s+)?more\s+(?:details|information|context))/iu,
  /\bwhat\s+(?:exactly\s+)?do\s+you\s+mean\b/iu,
  /\b(?:können|könnten)\s+sie\s+(?:das\s+)?(?:genauer|näher)\s+(?:erklären|beschreiben|erläutern)|\bwas\s+meinen\s+sie\b/iu,
  /\bpourriez-vous\s+(?:préciser|clarifier|expliquer)|\bque\s+voulez-vous\s+dire\b/iu,
  /\b(?:podría|puede)s?\s+(?:aclarar|especificar|explicar)|\bqué\s+quiere\s+decir\b/iu,
  /уточните|что\s+вы\s+имеете\s+в\s+виду/iu,
  /هل\s+يمكنك\s+التوضيح|ماذا\s+تقصد/u,
];

export function isGenericClarification(question: string): boolean {
  return GENERIC_CLARIFICATION.some((re) => re.test(question));
}
