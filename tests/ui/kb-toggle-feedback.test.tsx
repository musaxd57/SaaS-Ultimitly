// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// KB aktif/pasif geçişi GÖRÜNÜR geri bildirim verir (kurucu, canlı V1 doğrulaması 09-08:
// "pasifleştire tıklayınca belli etmiyor"). Başarıda ortak toast yüzeyi (bottom-right,
// AUTO_DISMISS) "pasifleştirildi/aktifleştirildi" der; HATADA başarı toast'ı YOK, liste
// hatası gösterilir (yanlış "oldu" iddiası yapılmaz).
// ---------------------------------------------------------------------------

import { __resetToastsForTest } from "@/lib/toast";
import { Toaster } from "@/components/toaster";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbManager, type KbItem } from "@/components/knowledge/kb-manager";

const PROPS = [{ id: "p1", name: "Daire 1" }];
function item(isActive: boolean): KbItem {
  return {
    id: "k1",
    propertyId: "p1",
    propertyName: "Daire 1",
    category: "general",
    title: "Otopark",
    content: "Bina altı otopark ücretsiz.",
    language: "tr",
    isActive,
  };
}

function stubFetch(ok: boolean) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 409,
    json: async () => (ok ? { item: item(false) } : { error: "Plan sınırı" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KbManager — aktif/pasif geçişi geri bildirimi", () => {
  beforeEach(() => {
    cleanup();
    __resetToastsForTest();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("pasifleştirme başarılıysa 'pasifleştirildi' toast'ı görünür ve PATCH isActive:false gider", async () => {
    const fetchMock = stubFetch(true);
    render(
      <>
        <Toaster />
        <KbManager properties={PROPS} items={[item(true)]} />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pasifleştir" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kb/k1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ isActive: false });
    expect(screen.getByRole("status").textContent).toMatch(/pasifleştirildi/i);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("aktifleştirme başarılıysa 'aktifleştirildi' toast'ı görünür", async () => {
    stubFetch(true);
    render(
      <>
        <Toaster />
        <KbManager properties={PROPS} items={[item(false)]} />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aktifleştir" }));
    });
    expect(screen.getByRole("status").textContent).toMatch(/aktifleştirildi/i);
  });

  it("rota hata dönerse BAŞARI toast'ı YOK; hata listede görünür", async () => {
    stubFetch(false);
    render(
      <>
        <Toaster />
        <KbManager properties={PROPS} items={[item(false)]} />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aktifleştir" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).toContain("Plan sınırı");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
