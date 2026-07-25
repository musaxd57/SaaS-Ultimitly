// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Ortak bildirim yüzeyi (Codex P3: "dağınık native alert/confirm").
//
// Panel 33 yerde `window.alert()` çağırıyordu. Native alert:
//   • ürünün dışında görünen, markasız bir sistem kutusu,
//   • sayfayı BLOKLAR (arka plandaki iş sürerken kullanıcı hiçbir şey yapamaz),
//   • ve en kötüsü: tarayıcılar arka arkaya alert basan sayfada "bu sayfanın
//     başka pencere açmasını engelle" seçeneği sunar — kabul edilirse sonraki
//     HATALAR SESSİZCE KAYBOLUR. Tur-5'te kapattığımız "sessiz hata" sınıfının
//     aynısı.
//
// Sözleşme:
//   • toast'lar sayfa içinde, canlı bölge olarak duyurulur;
//   • hata toast'ı KENDİLİĞİNDEN kaybolmaz (okunmadan gitmemeli), bilgi/başarı
//     toast'ı kaybolur;
//   • hiç <Toaster/> mount edilmemişse SESSİZ KALMAZ, native alert'e düşer.
// ---------------------------------------------------------------------------

import { toast, __resetToastsForTest } from "@/lib/toast";
import { Toaster } from "@/components/toaster";

describe("toast — ortak bildirim", () => {
  beforeEach(() => {
    cleanup();
    __resetToastsForTest();
    vi.useFakeTimers();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mesajı sayfa İÇİNDE gösterir (sistem kutusu değil)", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    render(<Toaster />);

    act(() => {
      toast.error("Görev silinemedi.");
    });

    // Sahte zamanlayıcı açık → findBy*/waitFor beklemesin, act() zaten flush etti.
    expect(screen.getByText("Görev silinemedi.")).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled(); // sayfayı bloklayan kutu YOK
  });

  it("hata DUYURULUR (role=alert), bilgi ise nazik bir status'tur", async () => {
    render(<Toaster />);
    act(() => {
      toast.error("Bağlantı hatası.");
      toast.success("Kaydedildi.");
    });

    expect(screen.getByRole("alert").textContent).toContain("Bağlantı hatası.");
    expect(screen.getByRole("status").textContent).toContain("Kaydedildi.");
  });

  it("başarı toast'ı kendiliğinden kaybolur; HATA okunmadan kaybolmaz", async () => {
    render(<Toaster />);
    act(() => {
      toast.success("Kaydedildi.");
      toast.error("Kaydedilemedi.");
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.queryByText("Kaydedildi.")).toBeNull();
    expect(screen.getByText("Kaydedilemedi.")).toBeTruthy(); // hâlâ ekranda
  });

  it("kullanıcı hatayı kapatabilir", async () => {
    render(<Toaster />);
    act(() => {
      toast.error("Yüklenemedi.");
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Bildirimi kapat/ }));
    });
    expect(screen.queryByText("Yüklenemedi.")).toBeNull();
  });

  it("FAIL-SAFE: Toaster mount edilmemişse sessiz kalmaz, alert'e düşer", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    // Bilerek <Toaster/> render EDİLMEZ.
    act(() => {
      toast.error("Kritik hata.");
    });
    expect(alertSpy).toHaveBeenCalledWith("Kritik hata.");
  });
});
