// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// UA-1 (kurucu 11-19; 11-19 akşam madde 4): karşılaştırma sayfasında "Yanlış kopyayı kaldır" (kurucunun işlem adı — "Rezervasyonu iptal et"
// AYRI işlemdir, bu ekranda yok) → AYNI satırda kısa onay ("Bu kayıt silinsin mi?" + Sil / Vazgeç; İK-3 biçimi). İstek yalnız onaydaki
// "Sil" ile gider; sayfanın anahtarı silinen satırsa kalan satırın anahtarına geçilir. 409'da sunucunun cümlesi gösterilir ve liste
// KENDİLİĞİNDEN güncellenir: satır yerinde olduğu için sayfa o satırın anahtarıyla yeniden çizilir (sayfanın anahtarı öteki yöneticinin
// sildiği kopya olabilir — yenileme 404 olurdu). Son kopya yanıtı hata değil açıklamadır (bilgi bildirimi); "Rezervasyonu aç" sayfada.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: (...a: unknown[]) => toastInfo(...a) },
}));

import { RemoveManualCopyButton } from "@/components/reservations/remove-manual-copy-button";

const LAST = "Bu rezervasyon artık yalnızca bir dairede görünüyor. Son kaydı bu ekrandan kaldırmadık.";
const BOUND = "Bu kayıt kaynağından geliyor; silinirse geri gelir.";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.refresh.mockClear();
  router.replace.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
});

function stubFetch(status: number, body: unknown = {}) {
  const fn = vi.fn(async (..._a: [string, RequestInit?]) => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const click = (text: string) =>
  act(async () => {
    fireEvent.click(screen.getByText(text));
  });

describe("RemoveManualCopyButton", () => {
  it("düğme adı 'Yanlış kopyayı kaldır' (iptal değil); ilk basış istek atmaz, onay açar; Vazgeç kapatır", async () => {
    const fetchFn = stubFetch(200);
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    expect(screen.queryByText(/iptal/i)).toBeNull();
    await click("Yanlış kopyayı kaldır");
    expect(screen.getByText("Bu kayıt silinsin mi?")).toBeTruthy();
    expect(screen.getByText("Sil")).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
    await click("Vazgeç");
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
    expect(screen.getByText("Yanlış kopyayı kaldır")).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("🚨 onaydaki Sil → DELETE yeni uca; anahtar başka satırsa sayfa yenilenir", async () => {
    const fetchFn = stubFetch(200, { ok: true });
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(fetchFn).toHaveBeenCalledWith("/api/reservations/r2/manual-copy", { method: "DELETE" });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("🚨 silinen satır sayfanın anahtarıysa kalan satırın anahtarına geçilir (yenileme 404 olurdu)", async () => {
    stubFetch(200, { ok: true });
    render(<RemoveManualCopyButton reservationId="r1" pageKey="r1" fallbackKey="r9" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(router.replace).toHaveBeenCalledWith("/reservations/compare/r9");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("404 (başka sekmede silinmiş) hata değil", async () => {
    stubFetch(404);
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(toastError).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("🚨 son kopya (409 last_copy): cümle BİLGİ olarak gösterilir (hata değil); sayfa bu satırın anahtarına geçer — öteki yöneticinin sildiği anahtar 404 olurdu", async () => {
    stubFetch(409, { error: LAST, code: "last_copy" });
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(toastInfo).toHaveBeenCalledWith(LAST);
    expect(toastError).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/reservations/compare/r2");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
  });

  it("son kopya, sayfanın anahtarı bu satırsa: yerinde yenilenir", async () => {
    stubFetch(409, { error: LAST, code: "last_copy" });
    render(<RemoveManualCopyButton reservationId="r1" pageKey="r1" fallbackKey="r2" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(toastInfo).toHaveBeenCalledWith(LAST);
    expect(router.refresh).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("409 kaynağa bağlı: sunucunun cümlesi HATA olarak gösterilir, liste bu satırın anahtarıyla yenilenir, onay kapanır", async () => {
    stubFetch(409, { error: BOUND, code: "source_bound" });
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(toastError).toHaveBeenCalledWith(BOUND);
    expect(toastInfo).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/reservations/compare/r2");
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
  });

  it("KONTROL: başka hata (500) listeyi değiştirmez — hata bildirimi, onay kapanır", async () => {
    stubFetch(500, {});
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Yanlış kopyayı kaldır");
    await click("Sil");
    expect(toastError).toHaveBeenCalledWith("Silinemedi. Sayfayı yenileyip tekrar deneyin.");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
  });
});
