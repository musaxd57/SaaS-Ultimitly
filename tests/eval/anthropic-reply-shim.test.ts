import { describe, it, expect, afterEach, vi } from "vitest";
import { installAnthropicReplyShim, shimStats, stripFence, toAnthropicBody, haikuCostUsd, claudeArmFromEnv } from "./anthropic-reply-shim";

// Claude kolu köprüsünün çevrimdışı pinleri (ağ YOK): çeviri Haiku 5.5'in 400 kurallarına uyar, cevap OpenAI biçimine döner,
// cevap dışı OpenAI çağrısı sessizce gerçek uca GİTMEZ.

const OPTS = { model: "claude-haiku-5-5", thinking: "adaptive" as const, effort: "low" as const, maxTokens: 4000 };

describe("anthropic-reply-shim", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("gövde: sistem birleşir + önbellek işareti; sıcaklık / ön dolgu yok; düşünme + çaba output_config'te", () => {
    const body = toAnthropicBody(
      { messages: [{ role: "system", content: "S1" }, { role: "system", content: "S2" }, { role: "user", content: "U" }], temperature: 0.4 } as never,
      OPTS,
    );
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      system: [{ type: "text", text: "S1\n\nS2", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "U" }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(() => toAnthropicBody({ messages: [{ role: "user", content: "U" }, { role: "assistant", content: "{" }] }, OPTS)).toThrow(/son mesaj/);
  });

  it("çit sökülür yalnız bütün cevabı sarıyorsa", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toEqual({ text: '{"a":1}', fenced: true });
    expect(stripFence('{"a":"```"}')).toEqual({ text: '{"a":"```"}', fenced: false });
  });

  it("cevap çağrısı Claude'a gider, OpenAI biçiminde döner; başka OpenAI ucu sayılır ve 400", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      seen.push(String(url));
      expect(JSON.parse(String(init.body)).model).toBe("claude-haiku-5-5");
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          stop_reason: "end_turn",
          content: [{ type: "thinking", thinking: "" }, { type: "text", text: '```json\n{"reply":"ok"}\n```' }],
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
        }),
        { status: 200 },
      );
    }) as never;
    const undo = installAnthropicReplyShim(OPTS, "k".repeat(30));
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] }) });
    const data = await res.json();
    expect(seen).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(data.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: '{"reply":"ok"}' } });
    expect(data.usage).toMatchObject({ prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900 } });
    const other = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", body: "{}" });
    expect(other.status).toBe(400);
    expect(shimStats.nonReplyCalls).toBeGreaterThanOrEqual(1);
    expect(seen).toHaveLength(1);
    undo();
    expect(haikuCostUsd({ calls: 1, fenced: 0, nonReplyCalls: 0, refusals: 0, schemaRejected: 0, inputTokens: 1e6, cacheRead: 1e6, cacheWrite: 0, outputTokens: 1e6 })).toBeCloseTo(0.61, 6);
  });

  it("kesilen cevap (max_tokens) 'length' olur → üretim kodu yedeğe düşer, kesik cevap gitmez", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"rep' }], usage: {} }), { status: 200 })) as never;
    const undo = installAnthropicReplyShim(OPTS, "k".repeat(30));
    const data = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "U" }] }) })).json();
    expect(data.choices[0].finish_reason).toBe("length");
    undo();
  });

  it("json_schema → output_config.format; Claude şemayı 400 ile reddederse aynı çağrı şemasız bir kez yeniden denenir (sayılır)", async () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
    const body = toAnthropicBody({ messages: [{ role: "user", content: "U" }], response_format: { type: "json_schema", json_schema: { schema } } }, OPTS);
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
    expect(toAnthropicBody({ messages: [{ role: "user", content: "U" }], response_format: { type: "json_object" } }, OPTS).output_config).toEqual({ effort: "low" });
    const sent: unknown[] = [];
    globalThis.fetch = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      sent.push(b.output_config);
      if (b.output_config.format) return new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 });
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: '{"a":"x"}' }], usage: {} }), { status: 200 });
    }) as never;
    const before = shimStats.schemaRejected;
    const undo = installAnthropicReplyShim(OPTS, "k".repeat(30));
    const data = await (
      await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "U" }], response_format: { type: "json_schema", json_schema: { schema } } }) })
    ).json();
    undo();
    expect(data.choices[0].message.content).toBe('{"a":"x"}');
    expect(sent).toEqual([{ effort: "low", format: { type: "json_schema", schema } }, { effort: "low" }]);
    expect(shimStats.schemaRejected).toBe(before + 1);
  });

  it("ortamdan kol: yalnız sağlayıcı + gerçek koşu + anahtar varken; OpenAI anahtarı yoksa yer tutucu", () => {
    expect(claudeArmFromEnv({ RUN_REAL_EVAL: "1", ANTHROPIC_API_KEY: "k".repeat(30) })).toBeNull();
    expect(claudeArmFromEnv({ EVAL_REPLY_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k".repeat(30) })).toBeNull();
    const env: Record<string, string | undefined> = { EVAL_REPLY_PROVIDER: "anthropic", RUN_REAL_EVAL: "1", ANTHROPIC_API_KEY: "k".repeat(30), EVAL_CLAUDE_THINKING: "disabled", EVAL_CLAUDE_EFFORT: "low" };
    const arm = claudeArmFromEnv(env);
    expect(arm?.label).toBe("claude-haiku-5-5-nothink-low");
    expect(env.OPENAI_API_KEY?.startsWith("shim-")).toBe(true);
  });
});
