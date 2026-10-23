import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// MODEL SAĞLAYICISININ KALICI ARIZASI (09-23 ölçümü): kredisi biten hesap her çağrıda
// `429 insufficient_quota` döner. Eski yol her çağrıda `reportError` çağırıyordu (Sentry
// kısıtsız, e-posta 10 dk'da bir) ve kaynak 2 dakikalık oto-yanıt DÖNGÜSÜ → alarm seli.
// Sözleşme: kalıcı sınıflar (quota/auth/model) GEÇİŞ TABANLI alarma gider; geçici arızalar
// (düz 429, 5xx, ağ) eski yolda kalır; misafir HER durumda deterministik fallback alır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({
  alertOnTransition: vi.fn(async () => "alerted"),
  clearAlertState: vi.fn(async () => {}),
}));

import { reportError } from "@/lib/report-error";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { suggestReply } from "@/lib/ai";
import {
  classifyModelProviderFailure,
  ModelProviderPersistentError,
  MODEL_PROVIDER_ALERT_KEY,
  MODEL_PROVIDER_ALERT_CONTEXT,
  __resetModelProviderHealthForTests,
} from "@/lib/ai/provider-health";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReport = vi.mocked(reportError);
const mockAlert = vi.mocked(alertOnTransition);
const mockClear = vi.mocked(clearAlertState);

const input: SuggestReplyInput = {
  guestMessage: "Otopark var mı?",
  property: { name: "Lale Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "", city: "İstanbul" },
  reservation: { guestName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
};

// Bu oturumda ÖLÇÜLEN gövdenin birebir biçimi (anahtar/hesap bilgisi yok).
const QUOTA_BODY = JSON.stringify({
  error: {
    message: "You have no credits remaining. Add credits to continue using the API.",
    type: "insufficient_quota",
    param: null,
    code: "credit_balance_exhausted",
  },
});

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              intent: "parking",
              confidence: 0.9,
              reply: "Binanın önünde ücretsiz park yeri var.",
              priority: "standard",
              riskLevel: "none",
              detectedLanguage: "tr",
            }),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

describe("classifyModelProviderFailure — saf sınıflandırma", () => {
  it.each([
    [429, QUOTA_BODY, "quota"],
    [429, '{"error":{"type":"insufficient_quota"}}', "quota"],
    [429, '{"error":{"code":"billing_hard_limit_reached"}}', "quota"],
    [401, '{"error":{"code":"invalid_api_key"}}', "auth"],
    [403, '{"error":{"code":"unsupported_country_region_territory"}}', "auth"],
    [404, '{"error":{"code":"model_not_found"}}', "model"],
    [400, '{"error":{"code":"model_not_found"}}', "model"],
    [404, "not found", "model"],
  ] as const)("%i %s → %s", (status, body, cls) => {
    expect(classifyModelProviderFailure(status, body)).toBe(cls);
  });

  it.each([
    [429, '{"error":{"type":"requests","code":"rate_limit_exceeded"}}'],
    [429, "rate limited"],
    [500, "server error"],
    [502, ""],
    [503, '{"error":{"type":"server_error"}}'],
    [400, '{"error":{"code":"context_length_exceeded"}}'],
  ] as const)("GEÇİCİ: %i %s → null (eski yol)", (status, body) => {
    expect(classifyModelProviderFailure(status, body)).toBeNull();
  });

  it("alarm sınıfı mesaj METNİ taşımaz, yalnız ad + kod + durum", async () => {
    const { errorClassOf } = await vi.importActual<typeof import("@/lib/alert-state")>("@/lib/alert-state");
    const err = new ModelProviderPersistentError("quota", 429, QUOTA_BODY);
    expect(errorClassOf(err)).toBe("ModelProviderPersistentError:quota:429");
  });
});

describe("suggestReply — kalıcı sağlayıcı arızası geçiş tabanlı alarma gider", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.clearAllMocks();
    __resetModelProviderHealthForTests(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 kredi bitti (429 insufficient_quota): alarm GEÇİŞ yoluna gider, çağrı başına reportError YOK; misafir fallback alır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(QUOTA_BODY, { status: 429 })));
    for (let i = 0; i < 5; i++) {
      const r = await suggestReply(input);
      expect(r.source).toBe("fallback");
      expect(r.reply.length).toBeGreaterThan(0);
    }
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledTimes(5); // bastırma kararı alert-state'te (entegrasyon testi)
    const [key, context, err] = mockAlert.mock.calls[0];
    expect(key).toBe(MODEL_PROVIDER_ALERT_KEY);
    expect(context).toBe(MODEL_PROVIDER_ALERT_CONTEXT);
    expect(err).toBeInstanceOf(ModelProviderPersistentError);
    expect((err as ModelProviderPersistentError).code).toBe("quota");
  });

  it.each([
    [401, '{"error":{"code":"invalid_api_key"}}', "auth"],
    [404, '{"error":{"code":"model_not_found"}}', "model"],
  ] as const)("%i → %s sınıfı geçiş yoluna gider", async (status, body, cls) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
    await suggestReply(input);
    expect(mockReport).not.toHaveBeenCalled();
    expect((mockAlert.mock.calls[0][2] as ModelProviderPersistentError).code).toBe(cls);
  });

  it("GEÇİCİ arıza (düz 429 hız sınırı / 503) eski yolda kalır: reportError, geçiş alarmı YOK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 })));
    await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream", { status: 503 })));
    await suggestReply(input);
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockReport.mock.calls.map((c) => c[0])).toEqual(["openai-reply 429", "openai-reply 503"]);
  });

  it("toparlanma: arızadan sonraki İLK başarı durumu TEK kez temizler; sonraki başarılar SORGU atmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(QUOTA_BODY, { status: 429 })));
    await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    const r1 = await suggestReply(input);
    await suggestReply(input);
    await suggestReply(input);
    expect(r1.source).toBe("openai");
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledWith(MODEL_PROVIDER_ALERT_KEY);
  });

  it("süreç başında durum BİLİNMEZ: ilk başarı bir kez temizler (önceki çalıştırmanın açık alarmı kapansın)", async () => {
    __resetModelProviderHealthForTests(true);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    await suggestReply(input);
    await suggestReply(input);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it("sağlıklı yol (hiç arıza yok, durum bilinen-kapalı): başarı hiçbir alarm/temizlik çağrısı yapmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    await suggestReply(input);
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });
});
