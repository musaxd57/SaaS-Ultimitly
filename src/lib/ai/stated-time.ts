// Deterministic evidence check for statedCheckoutTime (Codex #29). The model's
// claim "the guest stated they'll check out at HH:MM" is persisted onto the
// RESERVATION (guestCheckoutTime) and feeds turnover planning — so a regex-valid
// but HALLUCINATED time must never be written. This verifier accepts the claim
// only when the guest's own message plausibly contains that time. It is a
// hallucination stopper, not a full NLU parser: conservative on bare numbers
// ("2 valizimiz var" can never anchor a 02:00/14:00 claim), tolerant on real
// time expressions ("18:00", "6pm", "saat 6", "18'de", "akşam 6 gibi").

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** True when `message` plausibly states the time `hhmm` (24h "HH:MM"). */
export function timeStatedInMessage(hhmm: string, message: string): boolean {
  const parsed = HHMM.exec(hhmm.trim());
  if (!parsed) return false;
  const h = Number(parsed[1]);
  const min = Number(parsed[2]);
  const text = message.toLowerCase();

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
