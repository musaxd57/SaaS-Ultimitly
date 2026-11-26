import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// K-1029-A v2 — Opus F10 (10-30): `suggestReply` cevabın TAMAMINI ev sahibine başvurma yüzünden tutarken (`hostContactOnly`) taslağı
// (`hostContactDraft`) başvurma cümleleri ÇIKARILMIŞ metin olarak taşır; `reply` kapı için özgün metindir. Model `fetch` ile taklit edilir.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Wi-Fi şifresi ne?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ Lale-5G, şifre Lale2025." }],
  tone: "warm",
  language: "tr",
  now: new Date("2026-09-25T10:00:00Z"),
};

function modelSays(reply: string) {
  const content = {
    intent: "wifi",
    stayChangeAsked: "none",
    confidence: 0.92,
    reply,
    risk: null,
    priority: "standard",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: ["kb:wifi"],
    missingInfo: [],
    statedCheckoutTime: null,
    replyStance: "none",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 })),
  );
}

describe("suggestReply — tutulan cevabın taslağı (Opus F10)", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 bildirim taşıyan başvurma: tamamı tutulur, taslak silinmiş metin (yasaklı cümle yok)", async () => {
    modelSays("Ağ adı Lale-5G, şifre Lale2025. Bir sorun olursa ev sahibinize yazın; ev sahibiniz mesajınızı görebilir.");
    const r = await suggestReply(input);
    expect(r.hostContactOnly).toBe(true);
    expect(r.hostContactDraft).toBe("Ağ adı Lale-5G, şifre Lale2025.");
    expect(r.hostContactDraft).not.toMatch(/ev sahibinize yazın/);
  });

  it("yalnız selam + başvurma: taslak BOŞ", async () => {
    modelSays("Merhaba Ayşe, herhangi bir sorunda ev sahibinize yazın.");
    const r = await suggestReply(input);
    expect(r.hostContactOnly).toBe(true);
    expect(r.hostContactDraft).toBe("");
  });

  it("KONTROL: kısmi gönderimde (doğru cevap gider) taslak alanı YOK — taslak zaten giden metindir", async () => {
    modelSays("Ağ adı Lale-5G, şifre Lale2025. Herhangi bir sorunda ev sahibinize yazın.");
    const r = await suggestReply(input);
    expect(r.hostContactOnly).toBeUndefined();
    expect("hostContactDraft" in r).toBe(false);
    expect(r.reply).not.toMatch(/ev sahibinize yazın/);
  });
});
