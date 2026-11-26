import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getStorageAdapter, STORAGE_REQUEST_TIMEOUT_MS } from "@/lib/storage/adapter";

// ---------------------------------------------------------------------------
// GERÇEK sağlayıcı bağdaştırıcısı (fetch stub'lı; ağ yok) — 15 ajan incelemesi A11 (10-01, ölçüldü):
//  · S1: PUT / DELETE zaman aşımsızdı (cevap vermeyen sağlayıcıda her DELETE 300 sn → genel senkron geçişi saatlerce dururdu);
//  · S3: HER 404 "silindi" sayılıyordu — `NoSuchBucket` (yanlış STORAGE_BUCKET) kuyruktaki bütün silme niyetlerini sahte başarıyla
//        kapatırdı (KVKK). Yalnız `NoSuchKey` başarıdır.
// ---------------------------------------------------------------------------

const ENV = {
  STORAGE_ENDPOINT: "https://storage.example.test",
  STORAGE_BUCKET: "lixus-test-bucket",
  STORAGE_ACCESS_KEY_ID: "AKIATEST",
  STORAGE_SECRET_ACCESS_KEY: "secret-test-key",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const adapter = () => {
  const a = getStorageAdapter();
  if (!a) throw new Error("adapter yapılandırılmadı");
  return a;
};
const xml = (code: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>x</Message></Error>`;

describe("S1 — her sağlayıcı isteği zaman aşımlı", () => {
  it("PUT ve DELETE bir AbortSignal taşır (üst süre sabiti makul)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await adapter().put("org/o/task/t/a.png", new Uint8Array([1, 2, 3]), "image/png");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await adapter().delete("org/o/task/t/a.png");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
    expect(STORAGE_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(STORAGE_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("zaman aşımı (abort) hata olarak yayılır — kuyruk satırı yeniden denenebilir kalır", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(adapter().delete("org/o/task/t/a.png")).rejects.toThrow();
    await expect(adapter().put("org/o/task/t/a.png", new Uint8Array([1]), "image/png")).rejects.toThrow();
  });
});

describe("S3 — 404 yalnız NoSuchKey ise 'silindi'", () => {
  it("204 ve 404 NoSuchKey → başarı", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(adapter().delete("org/o/task/t/a.png")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(xml("NoSuchKey"), { status: 404 }));
    await expect(adapter().delete("org/o/task/t/a.png")).resolves.toBeUndefined();
  });

  it("🚨 404 NoSuchBucket / gövdesiz 404 / 403 → HATA (sahte başarı yok); hata iletisinde gövde YOK", async () => {
    fetchMock.mockResolvedValueOnce(new Response(xml("NoSuchBucket"), { status: 404 }));
    await expect(adapter().delete("org/o/task/t/a.png")).rejects.toThrow(/^storage delete failed: HTTP 404$/);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(adapter().delete("org/o/task/t/a.png")).rejects.toThrow(/HTTP 404/);
    fetchMock.mockResolvedValueOnce(new Response(xml("AccessDenied"), { status: 403 }));
    await expect(adapter().delete("org/o/task/t/a.png")).rejects.toThrow(/HTTP 403/);
  });
});
