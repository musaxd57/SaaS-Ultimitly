// Deterministic evidence check for statedCheckoutTime (Codex #29 + follow-up).
// The model's claim "the guest stated they'll check out at HH:MM" is persisted
// onto the RESERVATION (guestCheckoutTime) and feeds turnover planning — so a
// regex-valid but HALLUCINATED time must never be written. Two requirements,
// both evaluated per sentence-segment of the guest's own message:
//   1. the segment plausibly CONTAINS that time, and
//   2. the same segment carries a CHECKOUT cue (çık/ayrıl/leave/depart/
//      check-out/…) — "Check-in 18:00 mi?" or "Dinner at 18:00" name a time
//      but say nothing about checking out and must be rejected.
// It is a hallucination stopper, not a full NLU parser: conservative on bare
// numbers ("2 valizimiz var" can never anchor a claim), tolerant on real
// checkout statements ("18:00'de çıkacağız", "we'll leave around 6pm").

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// ç[ıi]k / ayr[ıi]l: JS toLowerCase maps ASCII "I" to "i" (not "ı"), so an
// all-caps "ÇIKACAĞIZ" lowercases to "çikacağiz" — match both vowels.
// "check[\s-]?out" never matches "check-in" (the "out" is required).
// (?<!a) excludes "açık" (open/clear) — a very common word that embeds "çık" and
// would otherwise falsely mark any nearby time as a stated checkout time.
const CHECKOUT_CUE =
  /(?<!a)ç[ıi]k|ayr[ıi]l|terk|boşalt|bosalt|check[\s-]?out|leav|depart|vacat|auscheck/;

/**
 * OLUMSUZLAMA VETOSU (denetim, 08-01) — kanıt kontrolü fiilin YÖNÜNÜ okumuyordu.
 * Ampirik ölçüm: "saat 11:00'de çıkmayacağız" ve "çıkış saatimizi 11:00 yapmayın
 * lütfen" ikisi de KABUL ediliyordu; yani misafirin AÇIKÇA REDDETTİĞİ saat
 * rezervasyona yazılıp bir sonraki prompt'a "misafirin belirttiği çıkış saati"
 * diye geri besleniyordu.
 *
 * ⚠️ Kalıplar TAM ÇEKİME çapalı. Çıplak `ma|me` eki ya da geniş `çıkmay`
 * KULLANILMAZ: Türkçede `-ma` hem olumsuzluk eki hem FİİL-İSİM ekidir, yani
 * "10:00'da çıkmayı planlıyoruz" OLUMLU bir beyandır ve geniş kalıp onu da
 * düşürürdü (kendi testim yakaladı). Yalnız gerçekten olumsuz çekimler listelenir.
 * Bu veto YALNIZCA DARALTIR: kabulü genişleten hiçbir dal eklemez.
 */
const CHECKOUT_NEGATION = new RegExp(
  [
    // çıkmıyoruz / çıkmayacağız / çıkmadık / çıkmam / çıkmaz
    "ç[ıi]km[ıi]yor",
    "ç[ıi]kmayaca",
    "ç[ıi]kmad",
    "ç[ıi]kmam",
    "ç[ıi]kmaz",
    // ayrılmıyoruz / ayrılmayacağız / ayrılmadık / ayrılmam / ayrılmaz
    "ayr[ıi]lm[ıi]yor",
    "ayr[ıi]lmayaca",
    "ayr[ıi]lmad",
    "ayr[ıi]lmam",
    "ayr[ıi]lmaz",
    // "çıkış saatimizi 11'e yapmayın"
    "yapmay[ıi]n",
    // İngilizce / diğer diller
    "won'?t leav",
    "will not leav",
    "not leaving",
    "won'?t check\\s?-?out",
    "do(n'?t| not) check\\s?-?out",
    "ne partons pas",
    "nicht aus",
  ].join("|"),
);

/** True when `message` plausibly states HH:MM AS A CHECKOUT TIME. */
export function timeStatedInMessage(hhmm: string, message: string): boolean {
  const parsed = HHMM.exec(hhmm.trim());
  if (!parsed) return false;
  // Misafir çıkışı REDDEDİYORSA hiçbir saat "beyan edilmiş çıkış saati" değildir.
  if (CHECKOUT_NEGATION.test(message.toLowerCase())) return false;
  const h = Number(parsed[1]);
  const min = Number(parsed[2]);

  // Evaluate sentence by sentence: the time and the checkout cue must sit in
  // the SAME segment, so "Dinner at 18:00. We leave tomorrow." can't borrow
  // the cue from a different sentence to legitimize the dinner time.
  // A dot BETWEEN digits is a time separator ("18.30"), not a sentence end.
  //
  // ⚠️ VİRGÜL/NOKTALI VİRGÜL AYIRICIYA EKLENDİ (denetim, 08-01). Ayırıcıda
  // yalnız `. ! ? \n` vardı; Türkçede (ve konuşma dilinde İngilizcede) cümlecikler
  // ağırlıkla VİRGÜLLE bağlandığı için garanti fiilen yoktu. Ampirik ölçüm:
  //   "Uçağımız 19:30'da, sabah 8 gibi çıkarız."  → 19:30 KABUL ediliyordu
  //   "Check-in 22:00, we will leave on Sunday"   → 22:00 KABUL ediliyordu
  // Yani fonksiyonun TEK varlık sebebi olan halüsinasyon sınıfı açıktı ve
  // misafirin hiç söylemediği bir saat rezervasyona kalıcı yazılabiliyordu.
  //
  // ⚠️ ASCII TİRE AYIRICIYA EKLENMEZ: "check-out" ipucunu ikiye böler ve TÜM
  // İngilizce "check-out at 11:00" beyanlarını sessizce öldürür (ölçüldü).
  const segments = message.toLowerCase().split(/(?:[!?\n,;]|(?<!\d)\.|\.(?!\d))+/);
  for (let i = 0; i < segments.length; i++) {
    if (!CHECKOUT_CUE.test(segments[i])) continue;
    // (a) İpucunun KENDİ cümleciği.
    if (segmentStatesTime(segments[i], h, min)) return true;
    // (b) İpucundan HEMEN SONRAKİ cümlecik: "yarın çıkıyoruz, saat 10:00 gibi".
    //     Virgül ayırıcısı tek başına bu meşru kalıbı da kırıyordu (ölçüldü).
    //     YÖN TEK: yalnız İLERİ bakılır. Geriye bakmak, düzeltilen tehdidin ta
    //     kendisini geri açardı ("Uçağımız 19:30'da, … çıkarız" → 19:30).
    const next = segments[i + 1];
    if (next && segmentStatesTime(next, h, min)) return true;
  }
  return false;
}

/** Does this (lowercased) segment plausibly contain the time h:min? */
function segmentStatesTime(text: string, h: number, min: number): boolean {
  // 1) Explicit hour:minute / hour.minute mentions, optional am/pm suffix.
  for (const m of text.matchAll(/(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?/g)) {
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const isPm = m[3]?.startsWith("p") ?? false;
    const isAm = m[3]?.startsWith("a") ?? false;
    if (isPm && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    if (mm !== min) continue;
    if (hh === h) return true;
    // A bare "6:30" for a checkout honestly means 18:30 as often as 06:30 —
    // accept the afternoon reading when no am/pm pins it down.
    if (!isPm && !isAm && hh < 12 && hh + 12 === h) return true;
  }

  // 2) Bare-hour mentions — ONLY next to a time cue, whole hours only.
  if (min === 0) {
    for (const m of text.matchAll(/\d{1,2}/g)) {
      const n = Number(m[0]);
      if (n > 23) continue;
      const before = text.slice(0, m.index);
      const after = text.slice((m.index ?? 0) + m[0].length);
      // (?:^|\s) instead of \b — JS \b is ASCII-only and fails on ö/ğ/ş etc.
      const cueBefore = /(?:^|\s)(?:saat|at|um|around|öğlen|sabah|akşam)\s*$/.test(before);
      const cueAfter =
        /^\s*(?:a\.?m\.?\b|p\.?m\.?\b|o'?clock\b|uhr\b|gibi\b|civar|sular)/.test(after) ||
        /^'?[dt][ae]\b/.test(after); // "18'de", "18de"
      if (!cueBefore && !cueAfter) continue;
      const isPm = /^\s*p\.?m\.?\b/.test(after);
      const isAm = /^\s*a\.?m\.?\b/.test(after);
      let hh = n;
      if (isPm && hh < 12) hh += 12;
      if (isAm && hh === 12) hh = 0;
      if (hh === h) return true;
      if (!isPm && !isAm && n < 12 && n + 12 === h) return true;
    }
  }
  return false;
}
