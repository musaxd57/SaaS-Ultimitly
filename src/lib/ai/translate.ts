import "server-only";

// ---------------------------------------------------------------------------
// translateText — high-quality, hospitality-aware translation via OpenAI
// (gpt-4o-mini). Returns the original text unchanged if OpenAI is not
// configured or on any error. Never throws.
// ---------------------------------------------------------------------------

// Module-level cache: avoids re-translating the same (text, lang) pair.
const _cache = new Map<string, string>();

function cacheKey(text: string, target: string, source?: string): string {
  return `${source ?? "auto"}→${target}:${text}`;
}

// Readable language names give the model much clearer instructions than bare
// codes. Falls back to the raw code for anything not listed.
const LANGUAGE_NAMES: Record<string, string> = {
  tr: "Turkish (Türkçe)",
  en: "English",
  de: "German (Deutsch)",
  fr: "French (Français)",
  es: "Spanish (Español)",
  it: "Italian (Italiano)",
  ru: "Russian (Русский)",
  ar: "Arabic (العربية)",
  nl: "Dutch (Nederlands)",
  pt: "Portuguese (Português)",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  fa: "Persian (فارسی)",
  el: "Greek (Ελληνικά)",
  pl: "Polish (Polski)",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

// Hospitality-grade translation system prompt. The goal is a translation a
// native-speaking host would actually send — natural, warm, and faithful —
// while protecting the data that must NOT be altered (codes, passwords,
// addresses, proper nouns, links).
function buildSystemPrompt(targetLang: string, sourceLang?: string): string {
  const target = languageName(targetLang);
  const from = sourceLang ? ` from ${languageName(sourceLang)}` : "";
  return `You are a professional translator specialized in short-term rental (Airbnb/Booking) guest communication.

Translate the user's message${from} into ${target}.

STRICT RULES:
1. Output ONLY the translation. No quotes, no explanations, no notes, no preamble.
2. Produce a natural, native-quality translation — the way a warm, professional host would write it. Do NOT translate word-for-word; convey meaning and tone.
3. Preserve the original tone and register (formal stays formal; friendly stays friendly).
4. Keep these UNCHANGED, exactly as written: Wi-Fi names/passwords, door/lock codes, street addresses, URLs, email addresses, phone numbers, prices with currency, dates/times, and brand or property proper names.
5. Preserve formatting: line breaks, paragraphs, lists, and emojis.
6. Do not add or remove information. Do not answer questions in the text — only translate them.
7. If the text is already in ${target}, return it unchanged.`;
}

export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<string> {
  if (!text.trim()) return text;

  // If source and target are the same, skip the call entirely.
  if (sourceLanguage && sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
    return text;
  }

  const key = cacheKey(text, targetLanguage, sourceLanguage);
  const cached = _cache.get(key);
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No OpenAI configured — return the original (never a dummy translation).
    return text;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: buildSystemPrompt(targetLanguage, sourceLanguage) },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return text;
    const data = await res.json();
    const translated = (data?.choices?.[0]?.message?.content as string | undefined)?.trim();
    if (translated) {
      _cache.set(key, translated);
      return translated;
    }
    return text;
  } catch {
    return text;
  }
}
