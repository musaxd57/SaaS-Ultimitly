import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
const create = vi.fn(async () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { aiGeneration: { create: (...a: unknown[]) => create(...(a as [])) } } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

import { aiGenerationRow, aiGenerationTraceEnabled, recordAiGeneration, AI_GENERATION_TEXT_CAP, type AiGenerationInput } from "@/lib/ai/generation-trace";

// ---------------------------------------------------------------------------
// Üretim izi satır kurucusu (saf). Kapalı kümeler, sayaç sözleşmesi, metin kuralları; DB yok.
// ---------------------------------------------------------------------------

const base = (over: Partial<AiGenerationInput> = {}): AiGenerationInput => ({
  organizationId: "org-1",
  conversationId: "conv-1",
  surface: "channel_auto",
  model: "gpt-x",
  promptVersion: "abc123def456",
  decision: "auto_sent",
  draftText: "Wi-Fi şifresi mutfakta.",
  sentText: "Wi-Fi şifresi mutfakta.\n\n(otomatik yanıt)",
  ...over,
});

describe("aiGenerationRow", () => {
  it("KONTROL: geçerli girdi → satır", () => {
    const r = aiGenerationRow(base({ llm: { pt: 100, ct: 20, rt: 5, m: "gpt-x-2026" }, latencyMs: 812, gateReason: "gate_passed" }));
    expect(r).toMatchObject({
      organizationId: "org-1",
      conversationId: "conv-1",
      model: "gpt-x-2026", // sağlayıcının bildirdiği sunulan model kazanır
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      latencyMs: 812,
      gateReason: "gate_passed",
      sentText: "Wi-Fi şifresi mutfakta.\n\n(otomatik yanıt)",
    });
  });

  it.each([
    ["bilinmeyen yüzey", { surface: "email" as never }],
    ["bilinmeyen karar", { decision: "maybe" as never }],
    ["konuşma yok", { conversationId: "" }],
    ["model yok", { model: " " }],
    ["istem sürümü yok", { promptVersion: "" }],
  ])("🚨 %s → satır YAZILMAZ (sahte etiket yerine eksik iz)", (_n, over) => {
    expect(aiGenerationRow(base(over))).toBeNull();
  });

  it.each(["human_review", "no_reply"] as const)("🚨 gönderilmeyen kararda (%s) gönderilen metin yazılmaz; taslak kalır", (decision) => {
    const r = aiGenerationRow(base({ decision }));
    expect(r?.sentText).toBeNull();
    expect(r?.draftText).toBe("Wi-Fi şifresi mutfakta.");
  });

  it("sayaç sözleşmesi: negatif / kesirli / NaN → null (kırpma yok)", () => {
    const r = aiGenerationRow(base({ latencyMs: -1, llm: { pt: 1.5, ct: Number.NaN, rt: -3 } }));
    expect([r?.latencyMs, r?.promptTokens, r?.completionTokens, r?.reasoningTokens]).toEqual([null, null, null, null]);
  });

  it("kanıt: yalnız ayrıştırılabilir JSON nesnesi", () => {
    expect(aiGenerationRow(base({ kbEvidenceJson: '{"k":[1]}' }))?.kbEvidenceJson).toBe('{"k":[1]}');
    for (const bad of ["serbest metin Ayşe", "[1,2]", "{yarım", "x".repeat(9_000)]) {
      expect(aiGenerationRow(base({ kbEvidenceJson: bad }))?.kbEvidenceJson).toBeNull();
    }
  });

  it("metin: NUL silinir, boş → null, tavanda kesilir", () => {
    expect(aiGenerationRow(base({ draftText: "a\u0000b" }))?.draftText).toBe("ab");
    expect(aiGenerationRow(base({ draftText: "   " }))?.draftText).toBeNull();
    expect(aiGenerationRow(base({ draftText: "x".repeat(AI_GENERATION_TEXT_CAP + 50) }))?.draftText).toHaveLength(AI_GENERATION_TEXT_CAP);
  });
});

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' açar (varsayılan KAPALI)", () => {
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "");
    expect(aiGenerationTraceEnabled()).toBe(false);
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "true");
    expect(aiGenerationTraceEnabled()).toBe(false);
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
    expect(aiGenerationTraceEnabled()).toBe(true);
  });
});

describe("recordAiGeneration — yazıcının KENDİ anahtar kontrolü (gelecek çağıranlar için güvence)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    create.mockClear();
  });
  it("🚨 anahtar kapalı → DB'ye dokunmaz (çağıran kontrolü unutsa da)", async () => {
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "");
    await recordAiGeneration(base());
    expect(create).not.toHaveBeenCalled();
  });
  it("KONTROL: anahtar açık → tek satır yazar", async () => {
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
    await recordAiGeneration(base());
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("🚨 DB arızası fırlatmaz", async () => {
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(recordAiGeneration(base())).resolves.toBeUndefined();
  });
});
