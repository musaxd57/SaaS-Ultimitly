import type { ModelAlias } from "./model-aliases";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatOptions = {
  model: ModelAlias;
  messages: ChatMessage[];
  temperature?: number;
};

type ChatResult = {
  content: string;
  model: string;
  durationMs: number;
};

export class LiteLLMClient {
  private readonly apiBase = process.env.LITELLM_API_BASE;
  private readonly apiKey = process.env.LITELLM_API_KEY;

  get isConfigured() {
    return Boolean(this.apiBase && this.apiKey);
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const startedAt = Date.now();

    if (!this.isConfigured) {
      throw new Error("LiteLLM is not configured");
    }

    const response = await fetch(`${this.apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.1,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LiteLLM request failed ${response.status}: ${errorText}`);
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("LiteLLM returned an empty response");
    }

    return {
      content,
      model: payload.model ?? options.model,
      durationMs: Date.now() - startedAt
    };
  }
}

export const litellmClient = new LiteLLMClient();
