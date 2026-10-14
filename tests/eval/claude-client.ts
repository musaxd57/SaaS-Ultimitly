// ---------------------------------------------------------------------------
// CLAUDE (Anthropic Messages API) — ölçerlerin ZORLU TEST üreticisi ve HAKEMİ (kurucu 10-14: "zorlu ve uzun testlerde Claude API'yi
// kullan"). Ürünün kendisi Claude ÇAĞIRMAZ; bu dosya yalnız tests/eval altındadır ve yalnız `ANTHROPIC_API_KEY` + `RUN_REAL_EVAL=1`
// ile koşar. Anahtar hiçbir çıktıya yazılmaz. Test dosyası DEĞİL (başka ölçer içe aktarabilir).
//
// Ücret kuralı (Haiku incelemesi 10-14): yalnız GEÇİCİ hata (429 / 5xx / ağ) yeniden denenir. Kalıcı hata (diğer 4xx — yanlış model
// adı, anahtar), kesilmiş cevap (`max_tokens`) ve JSON'a çevrilemeyen cevap AYNI pahalı isteği tekrar göndermez: `ClaudeFatalError`.
// ---------------------------------------------------------------------------

export const CLAUDE_GEN_MODEL = process.env.CLAUDE_EVAL_GEN_MODEL?.trim() || "claude-sonnet-5-5";
export const CLAUDE_JUDGE_MODEL = process.env.CLAUDE_EVAL_JUDGE_MODEL?.trim() || "claude-opus-5-5";

export function claudeKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
}

export interface ClaudeUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}
export const claudeUsage: ClaudeUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };

/** Yeniden denenmemesi gereken hata (ücret israfı olur). Mesajı yalnız hata TÜRÜNÜ taşır — istek / cevap gövdesi yok. */
export class ClaudeFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeFatalError";
  }
}

/**
 * Cevaptaki JSON. Adaylar: bütün metin · her ```json çiti · ilk birkaç `[` / `{` konumundan SON eşine kadar. Ayrışan adaylardan EN UZUN
 * kaynaklı olan seçilir (Haiku 10-14 ikinci tur: önce gelen çitli bir ÖRNEK ya da açıklamadaki "[not]" gerçek cevabın yerine geçmesin).
 * Hiçbiri ayrışmazsa `ClaudeFatalError`.
 */
export function extractJson<T>(text: string): T {
  const attempts: string[] = [text.trim()];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gu)) if (m[1]) attempts.push(m[1].trim());
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const end = text.lastIndexOf(close);
    let from = -1;
    for (let k = 0; k < 5; k++) {
      from = text.indexOf(open, from + 1);
      if (from < 0 || from >= end) break;
      attempts.push(text.slice(from, end + 1));
    }
  }
  let best: { value: unknown; len: number } | null = null;
  for (const a of attempts) {
    try {
      const value = JSON.parse(a) as unknown;
      if (value !== null && typeof value === "object" && (!best || a.length > best.len)) best = { value, len: a.length };
    } catch {
      /* sıradaki aday */
    }
  }
  if (!best) throw new ClaudeFatalError("Claude cevabı JSON değil");
  return best.value as T;
}

/** Dizi bekleyen çağıran için: düz dizi ya da `{ items | results | data: [...] }` sarmalı. Başka biçim kalıcı hata. */
export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    for (const k of ["items", "results", "data", "verdicts"]) {
      const v = (value as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  throw new ClaudeFatalError("Claude cevabı dizi değil");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tek Claude çağrısı → JSON. Yalnız geçici hatada (429 / 5xx / ağ) en çok iki kez yeniden dener. */
export async function claudeJson<T>(opts: { model: string; system: string; user: string; maxTokens?: number }): Promise<T> {
  const key = claudeKey();
  if (!key) throw new ClaudeFatalError("ANTHROPIC_API_KEY yok");
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 8000,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
    } catch (err) {
      lastErr = err; // ağ hatası — geçici
      if (attempt < 2) await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Claude HTTP ${res.status}`);
      if (attempt < 2) await sleep(2000 * (attempt + 1));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
      error?: { type?: string };
    };
    if (!res.ok) throw new ClaudeFatalError(`Claude HTTP ${res.status}: ${body.error?.type ?? ""}`);
    claudeUsage.calls++;
    claudeUsage.inputTokens += body.usage?.input_tokens ?? 0;
    claudeUsage.outputTokens += body.usage?.output_tokens ?? 0;
    if (body.stop_reason === "max_tokens") throw new ClaudeFatalError("Claude cevabı kesildi (max_tokens)");
    const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return extractJson<T>(text);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Claude çağrısı başarısız");
}
