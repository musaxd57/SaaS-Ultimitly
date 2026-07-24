import "server-only";

// ---------------------------------------------------------------------------
// translate — hospitality-aware translation via OpenAI (model from
// OPENAI_TRANSLATE_MODEL / OPENAI_MODEL, default gpt-4.1).
//
// STRUCTURED RESULT (Codex #30): failures used to return the ORIGINAL text as
// if it were the translation — the reply route then SENT the untranslated
// message to the guest while the host believed it went out in the guest's
// language. Callers now get { ok:false, reason } and decide (both routes fail
// closed: no silent wrong-language sends). Never throws.
//
// Bounded cache: the old module Map grew without limit, holding guest text in
// memory forever. Now a small LRU with TTL. Input/output are length-capped so
// a pathological body can't run up token spend or flood the UI.
// ---------------------------------------------------------------------------

export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "failed" | "too_long" };

/** Well above any realistic guest/host message; below abuse territory. */
const MAX_INPUT_CHARS = 6000;
const MAX_OUTPUT_CHARS = 8000;
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — same thread gets re-read soon, not forever

/** Reasoning (o-series) and GPT-5 models reject custom temperature; omit it. */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.trim());
}

// Small LRU+TTL cache: repeated "translate this message" clicks on the same
// thread stay free, while memory stays bounded and entries age out.
const _cache = new Map<string, { value: string; expires: number }>();

function cacheGet(key: string): string | null {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    _cache.delete(key);
    return null;
  }
  _cache.delete(key); // refresh recency (Map preserves insertion order)
  _cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: string): void {
  if (_cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/** Test hooks — mirror the __resetRateLimit precedent. */
export function __resetTranslateCache(): void {
  _cache.clear();
}
export function __translateCacheSize(): number {
  return _cache.size;
}

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

export async function translate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<TranslateResult> {
  // Nothing to translate — the unchanged text IS the correct result.
  if (!text.trim()) return { ok: true, text };
  if (sourceLanguage && sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
    return { ok: true, text };
  }
  if (text.length > MAX_INPUT_CHARS) return { ok: false, reason: "too_long" };

  const key = cacheKey(text, targetLanguage, sourceLanguage);
  const cached = cacheGet(key);
  if (cached !== null) return { ok: true, text: cached };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const model = process.env.OPENAI_TRANSLATE_MODEL || process.env.OPENAI_MODEL || "gpt-4.1";
  const reasoning = isReasoningModel(model);
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(targetLanguage, sourceLanguage) },
      { role: "user", content: text },
    ],
  };
  if (!reasoning) payload.temperature = 0.2;
  // Output token cap — a runaway generation must not run up spend.
  if (reasoning) payload.max_completion_tokens = 4000;
  else payload.max_tokens = 3000;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(reasoning ? 60000 : 15000),
    });

    if (!res.ok) return { ok: false, reason: "failed" };
    const data = await res.json();
    // Truncated output (hit max_tokens) = a HALF translation. Never send it —
    // fail closed so the caller keeps the message queued for a human, matching
    // ai/index.ts's finish_reason==="length" → fallback handling.
    if (data?.choices?.[0]?.finish_reason === "length") return { ok: false, reason: "failed" };
    const translated = (data?.choices?.[0]?.message?.content as string | undefined)
      ?.trim()
      .slice(0, MAX_OUTPUT_CHARS);
    if (!translated) return { ok: false, reason: "failed" };
    cacheSet(key, translated);
    return { ok: true, text: translated };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
