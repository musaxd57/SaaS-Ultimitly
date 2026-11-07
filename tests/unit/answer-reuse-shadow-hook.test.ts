import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Migration 85 gölge kancası — anahtar KAPALIYKEN gömme sağlayıcısına (ücretli ağ çağrısı) hiç çıkılmaz ve veritabanına dokunulmaz.
// Mimari pin (`embeddings-provider.test.ts`) bu modülü izinli çağıran sayar; izin bu davranışa bağlıdır.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
const { embedTexts } = vi.hoisted(() => ({ embedTexts: vi.fn(async () => null) }));
vi.mock("@/lib/ai/embeddings/provider", () => ({ embedTexts, cosineOfUnit: () => 1 }));

const { observeVerifiedParts } = vi.hoisted(() => ({ observeVerifiedParts: vi.fn(async () => ({ observed: 0 })) }));
vi.mock("@/lib/answer-reuse/store", async (orig) => ({ ...(await orig<typeof import("@/lib/answer-reuse/store")>()), observeVerifiedParts }));

import { observeAnswerReuseAfterSend } from "@/lib/answer-reuse/shadow-hook";

const db = new Proxy({}, { get: () => { throw new Error("veritabanına dokunuldu"); } }) as never;
const input = {
  organizationId: "o",
  propertyId: "p",
  conversationId: "c",
  verifiedParts: [{ ref: "R1", text: "Çıkış saati 11:00.", evidence: "Check-out saati: 11:00", source: "property" }],
  answeredRefs: ["R1"],
  replyItems: { answerable: [{ ref: "R1", kind: "checkout_time" as const, hint: "çıkış saati" }], held: [], parts: true as const },
  kbForModel: [],
  kbVisible: [],
  property: { checkInTime: "15:00", checkOutTime: "11:00" },
  sentText: "Çıkış saati 11:00.",
  language: "tr",
  guestNames: [],
  now: new Date("2026-10-23T10:00:00Z"),
};

describe("gölge kancası — anahtar kapalı", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 anahtar kapalıyken null döner: gömme çağrısı YOK, veritabanına dokunulmaz", async () => {
    expect(await observeAnswerReuseAfterSend(db, input)).toBeNull();
    vi.stubEnv("AI_ANSWER_REUSE_SHADOW_ENABLED", "true");
    expect(await observeAnswerReuseAfterSend(db, input)).toBeNull();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("anahtar açık ama parça kipi yoksa da çıkılmaz", async () => {
    vi.stubEnv("AI_ANSWER_REUSE_SHADOW_ENABLED", "1");
    expect(await observeAnswerReuseAfterSend(db, { ...input, replyItems: { ...input.replyItems, parts: undefined } as never })).toBeNull();
    expect(embedTexts).not.toHaveBeenCalled();
  });
});

describe("gölge kancası — kayda giden alıntı (Opus 10-23 öğle B9)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    observeVerifiedParts.mockClear();
  });

  it("🚨 çevrilmiş başlığı atılmış alıntı (`quote`) kaydedilir — ham alıntı yeniden doğrulamada hep düşerdi", async () => {
    vi.stubEnv("AI_ANSWER_REUSE_SHADOW_ENABLED", "1");
    const row = { id: "kb1", category: "wifi", title: "İnternet", content: "Wi-Fi adı Lale-5G, şifre Lale2025.", updatedAt: new Date("2026-10-01") };
    await observeAnswerReuseAfterSend(db, {
      ...input,
      verifiedParts: [{ ref: "R1", text: "Wi-Fi: Lale-5G, Lale2025.", evidence: "Интернет: Wi-Fi adı Lale-5G, şifre Lale2025.", quote: "Wi-Fi adı Lale-5G, şifre Lale2025.", source: "kb:1" }],
      replyItems: { answerable: [{ ref: "R1", kind: "wifi" as const, hint: "wifi şifresi" }], held: [], parts: true as const },
      kbForModel: [row],
      kbVisible: [row],
      sentText: "Wi-Fi: Lale-5G, Lale2025.",
      language: "ru",
    });
    expect(observeVerifiedParts).toHaveBeenCalledTimes(1);
    const parts = (observeVerifiedParts.mock.calls[0] as unknown as [unknown, { parts: { evidence: string; sourceRef: string }[] }])[1].parts;
    expect(parts).toEqual([expect.objectContaining({ evidence: "Wi-Fi adı Lale-5G, şifre Lale2025.", sourceRef: "kb:kb1" })]);
  });
});
