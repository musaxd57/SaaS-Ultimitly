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
