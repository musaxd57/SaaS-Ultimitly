// ---------------------------------------------------------------------------
// CLAUDE (Anthropic Messages API) — ölçerlerin ZORLU TEST üreticisi ve HAKEMİ (kurucu 10-14: "zorlu ve uzun testlerde Claude API'yi
// kullan"). Ürünün kendisi Claude ÇAĞIRMAZ; bu dosya yalnız tests/eval altındadır ve yalnız `ANTHROPIC_API_KEY` + `RUN_REAL_EVAL=1`
// ile koşar. Anahtar hiçbir çıktıya yazılmaz. Test dosyası DEĞİL (başka ölçer içe aktarabilir).
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

/** Metindeki İLK JSON dizisi / nesnesi (model açıklama eklese de). */
export function extractJson<T>(text: string): T {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  const start = startArr >= 0 && (startObj < 0 || startArr < startObj) ? startArr : startObj;
  const end = start === startArr ? text.lastIndexOf("]") : text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude cevabında JSON yok");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/** Tek Claude çağrısı → JSON. İki geçici hatada yeniden dener (429 / 5xx / ağ). */
export async function claudeJson<T>(opts: { model: string; system: string; user: string; maxTokens?: number }): Promise<T> {
  const key = claudeKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY yok");
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 8000,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Claude HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const body = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { type?: string; message?: string };
      };
      if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${body.error?.type ?? ""}`);
      claudeUsage.calls++;
      claudeUsage.inputTokens += body.usage?.input_tokens ?? 0;
      claudeUsage.outputTokens += body.usage?.output_tokens ?? 0;
      const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      return extractJson<T>(text);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Claude çağrısı başarısız");
}
