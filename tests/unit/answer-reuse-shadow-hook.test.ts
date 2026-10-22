import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Migration 85 gölge kancası — anahtar KAPALIYKEN gömme sağlayıcısına (ücretli ağ çağrısı) hiç çıkılmaz ve veritabanına dokunulmaz.
// Mimari pin (`embeddings-provider.test.ts`) bu modülü izinli çağıran sayar; izin bu davranışa bağlıdır.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
const { embedTexts } = vi.hoisted(() => ({ embedTexts: vi.fn(async () => null) }));
vi.mock("@/lib/ai/embeddings/provider", () => ({ embedTexts, cosineOfUnit: () => 1 }));

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
