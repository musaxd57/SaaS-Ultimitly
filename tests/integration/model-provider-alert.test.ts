import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KREDİSİ BİTEN MODEL HESABI — gerçek `alert-state` (PostgreSQL) ile uçtan uca.
// 09-23'te bu oturumun anahtarı her çağrıya `429 insufficient_quota` döndü. Railway
// yeniden açıldığında aynı durum oto-yanıt döngüsünde her 2 dakikada onlarca çağrı
// demektir; kurucunun gelen kutusu yine dolmamalı: kalıcı arıza = TEK alarm, toparlanınca
// durum kapanır, yeni arıza yeniden bildirilir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));

import { reportError } from "@/lib/report-error";
import { suggestReply } from "@/lib/ai";
import { __resetModelProviderHealthForTests, MODEL_PROVIDER_ALERT_KEY } from "@/lib/ai/provider-health";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReport = vi.mocked(reportError);

const input: SuggestReplyInput = {
  guestMessage: "Otopark var mı?",
  property: { name: "Lale Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "", city: "İstanbul" },
  reservation: { guestName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
};

const QUOTA = () =>
  new Response('{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}', { status: 429 });
const OK = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ intent: "parking", confidence: 0.9, reply: "Park yeri var.", riskLevel: "none" }),
          },
        },
      ],
    }),
    { status: 200 },
  );

async function stateRow() {
  return prisma.systemLock.findUnique({ where: { name: `alert-state:${MODEL_PROVIDER_ALERT_KEY}` } });
}

/** Başarı yolu temizliği `void` ile koşar; satırın gitmesini kısa süre bekle. */
async function waitForRowGone() {
  for (let i = 0; i < 50 && (await stateRow()); i++) await new Promise((r) => setTimeout(r, 20));
}

describe("model sağlayıcısı kalıcı arızası — gerçek alert-state", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    __resetModelProviderHealthForTests(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 30 çağrı boyunca kredi bitik: TEK alarm; durum satırı sınıfı taşır, metni değil", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    for (let i = 0; i < 30; i++) expect((await suggestReply(input)).source).toBe("fallback");
    // `noteModelProviderPersistentFailure` `void` ile çağrılır; son yazmanın bitmesini bekle.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe("openai-reply kalıcı arıza");
    const row = await stateRow();
    expect(row?.holder).toBe("ModelProviderPersistentError:quota:429");
  });

  it("toparlanma durumu kapatır; sonraki arıza YENİDEN alarm üretir (kurucu düzeldiğini ve bozulduğunu görür)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    await suggestReply(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(await stateRow()).not.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => OK()));
    expect((await suggestReply(input)).source).toBe("openai");
    await waitForRowGone();
    expect(await stateRow()).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    await suggestReply(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it("SINIF değişimi yeni durumdur: kota → anahtar reddi ikinci alarmı üretir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    await suggestReply(input);
    await new Promise((r) => setTimeout(r, 50));
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 })));
    await suggestReply(input);
    await suggestReply(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockReport).toHaveBeenCalledTimes(2);
    expect((await stateRow())?.holder).toBe("ModelProviderPersistentError:auth:401");
  });
});

// ---------------------------------------------------------------------------
// GÖMME (EMBEDDING) KANALI — 09-23. Anlamsal arama anahtarı açıkken HER misafir mesajı bir gömme
// çağrısıdır; kalıcı arıza AYNI geçiş kuralına tabi, ama AYRI durum anahtarıyla (bir kanalın
// başarısı ötekinin alarmını silmez).
// ---------------------------------------------------------------------------

import { embedTexts, clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";

const EMBED_OK = () =>
  new Response(
    JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)) }] }),
    { status: 200 },
  );

async function embeddingRow() {
  return prisma.systemLock.findUnique({ where: { name: "alert-state:model-provider:embedding" } });
}

describe("gömme kanalı kalıcı arızası — gerçek alert-state", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    clearEmbeddingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    __resetModelProviderHealthForTests(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 30 gömme çağrısı boyunca kredi bitik: TEK alarm, kendi konusuyla; hata gövdesi alarma GİRMEZ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    for (let i = 0; i < 30; i++) expect(await embedTexts([`soru ${i}`])).toBeNull();
    // Durum yazımı misafir yolunu BEKLETMEZ (`void`); yazımların bitmesini bekle.
    await new Promise((r) => setTimeout(r, 100));
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe("openai-embedding kalıcı arıza");
    expect(String((mockReport.mock.calls[0][1] as Error).message)).not.toContain("credit_balance_exhausted");
    expect((await embeddingRow())?.holder).toBe("ModelProviderPersistentError:quota:429");
    expect(await stateRow()).toBeNull(); // sohbet kanalının durumu AYRI
  });

  it("kanallar birbirinin alarmını SİLMEZ: gömme başarısı sohbet alarmını, sohbet başarısı gömme alarmını kapatmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    await suggestReply(input);
    await embedTexts(["a"]);
    await new Promise((r) => setTimeout(r, 100));
    expect(await stateRow()).not.toBeNull();
    expect(await embeddingRow()).not.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => EMBED_OK()));
    expect(await embedTexts(["b"])).not.toBeNull();
    for (let i = 0; i < 50 && (await embeddingRow()); i++) await new Promise((r) => setTimeout(r, 20));
    expect(await embeddingRow()).toBeNull();
    expect(await stateRow()).not.toBeNull(); // sohbet alarmı açık kalır

    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    await embedTexts(["c"]);
    for (let i = 0; i < 50 && !(await embeddingRow()); i++) await new Promise((r) => setTimeout(r, 20));
    vi.stubGlobal("fetch", vi.fn(async () => OK()));
    expect((await suggestReply(input)).source).toBe("openai");
    await waitForRowGone();
    expect(await stateRow()).toBeNull();
    expect(await embeddingRow()).not.toBeNull(); // gömme alarmı açık kalır
  });

  it("geçici hata (503) eski yolda kalır: durum satırı YAZILMAZ; sessiz modda (sıcak yol/ısınma) alarm da YOK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await embedTexts(["x"])).toBeNull();
    expect(await embeddingRow()).toBeNull();
    expect(mockReport.mock.calls.map((c) => c[0])).toContain("openai-embeddings 503");
    mockReport.mockClear();
    expect(await embedTexts(["y"], { quiet: true })).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("🚨 KALICI arıza sessiz modda da TEK alarm verir (sessizlik yalnız geçici arızalar içindir)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => QUOTA()));
    for (let i = 0; i < 5; i++) expect(await embedTexts([`q${i}`], { quiet: true })).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe("openai-embedding kalıcı arıza");
  });
});
