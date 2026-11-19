// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// UA-1 (kurucu 11-19): karşılaştırma sayfasında "Bu kaydı kaldır" → AYNI satırda kısa onay ("Bu kayıt silinsin mi?" + Sil / Vazgeç; İK-3
// biçimi). İstek yalnız onaydaki "Sil" ile gider; sayfanın anahtarı silinen satırsa kalan satırın anahtarına geçilir; 409'da sunucunun
// cümlesi gösterilir.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));

import { RemoveManualCopyButton } from "@/components/reservations/remove-manual-copy-button";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.refresh.mockClear();
  router.replace.mockClear();
  toastError.mockClear();
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
  it("ilk basış istek atmaz, onay açar; Vazgeç kapatır", async () => {
    const fetchFn = stubFetch(200);
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Bu kaydı kaldır");
    expect(screen.getByText("Bu kayıt silinsin mi?")).toBeTruthy();
    expect(screen.getByText("Sil")).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
    await click("Vazgeç");
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
    expect(screen.getByText("Bu kaydı kaldır")).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("🚨 onaydaki Sil → DELETE yeni uca; anahtar başka satırsa sayfa yenilenir", async () => {
    const fetchFn = stubFetch(200, { ok: true });
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Bu kaydı kaldır");
    await click("Sil");
    expect(fetchFn).toHaveBeenCalledWith("/api/reservations/r2/manual-copy", { method: "DELETE" });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("🚨 silinen satır sayfanın anahtarıysa kalan satırın anahtarına geçilir (yenileme 404 olurdu)", async () => {
    stubFetch(200, { ok: true });
    render(<RemoveManualCopyButton reservationId="r1" pageKey="r1" fallbackKey="r9" />);
    await click("Bu kaydı kaldır");
    await click("Sil");
    expect(router.replace).toHaveBeenCalledWith("/reservations/compare/r9");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("404 (başka sekmede silinmiş) hata değil", async () => {
    stubFetch(404);
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Bu kaydı kaldır");
    await click("Sil");
    expect(toastError).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("409: sunucunun cümlesi gösterilir, sayfa yenilenir, onay kapanır", async () => {
    stubFetch(409, { error: "Bu kayıt kaynağından geliyor; silinirse geri gelir." });
    render(<RemoveManualCopyButton reservationId="r2" pageKey="r1" fallbackKey="r1" />);
    await click("Bu kaydı kaldır");
    await click("Sil");
    expect(toastError).toHaveBeenCalledWith("Bu kayıt kaynağından geliyor; silinirse geri gelir.");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByText("Bu kayıt silinsin mi?")).toBeNull();
  });
});
