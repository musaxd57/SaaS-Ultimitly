// ---------------------------------------------------------------------------
// CEVAP MODELİ YERİNE CLAUDE (kurucu 10-31: "Haiku 5.5'i 5.1'in kullanıldığı yerlerde test et … reasoning içinde ekstra testler yap").
// Ürün kodu DEĞİŞMEZ: ölçer, OpenAI sohbet ucuna giden cevap çağrısını (aynı sistem + kullanıcı istemi) yakalar, Anthropic Messages
// API'sine çevirir ve cevabı OpenAI biçiminde geri verir — bilgi tabanı seçimi, istem kurucu, STRICT çözüm ve gönderim kapısı
// birebir üretimdeki gibi koşar. Yalnız tests/eval altında; anahtar `ANTHROPIC_API_KEY` (Actions sırrı), hiçbir çıktıya yazılmaz.
//
// Çeviri kuralları (Haiku 5.5): `temperature` GÖNDERİLMEZ (400), ön dolgu yok (son mesaj kullanıcı), düşünme `adaptive` ya da
// `disabled` + `output_config.effort`; sistem istemi `cache_control` ile önbelleğe alınır (üretimdeki OpenAI önbelleğinin karşılığı).
// JSON: OpenAI `json_object` kipinin karşılığı yok — istem zaten JSON istiyor; cevap ```json çitiyle gelirse çit SÖKÜLÜR ve sayılır
// (üretim bağdaştırıcısı da sökerdi; sayım raporda görünür). Cevap çağrısı DIŞINDA bir OpenAI çağrısı gelirse SAYILIR ve
// hata döner (sessizce gerçek OpenAI'ye gitmez — anahtar yok, ölçüm yalnız cevap katmanını kıyaslar).
// ---------------------------------------------------------------------------

export interface ShimStats {
  calls: number;
  fenced: number;
  nonReplyCalls: number;
  refusals: number;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
}
export const shimStats: ShimStats = { calls: 0, fenced: 0, nonReplyCalls: 0, refusals: 0, inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0 };

const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";

export interface ShimOptions {
  model: string;
  /** `adaptive` (varsayılan) ya da `disabled` (yalnız effort ≤ high). */
  thinking: "adaptive" | "disabled";
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ```json … ``` çitini söker (yalnız bütün cevabı saran çit). */
export function stripFence(text: string): { text: string; fenced: boolean } {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/u.exec(text);
  return m ? { text: m[1], fenced: true } : { text, fenced: false };
}

/** OpenAI sohbet yükü → Anthropic Messages gövdesi. Sistem mesajları birleşir; kullanıcı / asistan sırası korunur. */
export function toAnthropicBody(payload: { messages?: { role: string; content: unknown }[] }, opts: ShimOptions): Record<string, unknown> {
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of payload.messages ?? []) {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.role === "system" || m.role === "developer") system.push(content);
    else messages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") throw new Error("shim: son mesaj kullanıcı olmalı (ön dolgu Haiku 5.5'te 400)");
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: [{ type: "text", text: system.join("\n\n"), cache_control: { type: "ephemeral" } }],
    messages,
    thinking: { type: opts.thinking },
    output_config: { effort: opts.effort },
  };
}

/** Global `fetch`'i sarar: cevap çağrısı → Claude; başka OpenAI çağrısı → sayılır + hata. Geri alma fonksiyonu döner. */
export function installAnthropicReplyShim(opts: ShimOptions, apiKey: string): () => void {
  const original = globalThis.fetch;
  const shimmed = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.openai.com/")) return original(input, init);
    if (url !== OPENAI_CHAT) {
      shimStats.nonReplyCalls++;
      return new Response(JSON.stringify({ error: { message: "shim: yalnız cevap çağrısı ölçülür" } }), { status: 400 });
    }
    const payload = JSON.parse(String(init?.body ?? "{}"));
    const body = JSON.stringify(toAnthropicBody(payload, opts));
    for (let attempt = 0; ; attempt++) {
      const res = await original(ANTHROPIC_MESSAGES, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body,
        signal: init?.signal,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        error?: { type?: string; message?: string };
      };
      if (!res.ok) return new Response(JSON.stringify({ error: { message: `anthropic ${res.status} ${data.error?.type ?? ""}` } }), { status: res.status });
      shimStats.calls++;
      const u = data.usage ?? {};
      const read = u.cache_read_input_tokens ?? 0;
      const write = u.cache_creation_input_tokens ?? 0;
      shimStats.inputTokens += u.input_tokens ?? 0;
      shimStats.cacheRead += read;
      shimStats.cacheWrite += write;
      shimStats.outputTokens += u.output_tokens ?? 0;
      if (data.stop_reason === "refusal") shimStats.refusals++;
      const raw = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const { text, fenced } = stripFence(raw);
      if (fenced) shimStats.fenced++;
      const finish = data.stop_reason === "max_tokens" ? "length" : "stop";
      return new Response(
        JSON.stringify({
          model: data.model ?? opts.model,
          choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: text } }],
          usage: {
            // OpenAI biçimi: istem = önbelleksiz + okunan + yazılan; "cached" yalnız okunan (fiyat ↓ ayrıca hesaplanır).
            prompt_tokens: (u.input_tokens ?? 0) + read + write,
            completion_tokens: u.output_tokens ?? 0,
            prompt_tokens_details: { cached_tokens: read },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
  };
  globalThis.fetch = shimmed as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Haiku 5.5 fiyatı (≤100K istem): girdi 0,10 · önbellek okuma 0,01 · önbellek yazma 0,125 · çıktı 0,50 $/M token. */
export function haikuCostUsd(s: ShimStats): number {
  return (s.inputTokens * 0.1 + s.cacheRead * 0.01 + s.cacheWrite * 0.125 + s.outputTokens * 0.5) / 1e6;
}
