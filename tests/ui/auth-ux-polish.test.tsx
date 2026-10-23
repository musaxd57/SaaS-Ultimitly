// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { RegisterForm } from "@/components/auth/register-form";

// 07-30 UX turu: (1) başarı mesajları KALICI durum gibi ekranda oturmasın —
// useFlash ile ~6 sn sonra kendiliğinden gitsin (hatalar KALIR, kural ayrı);
// (2) kayıt formunda tarayıcı CSPRNG'siyle güçlü şifre önerici.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TwoFactorCard — başarı mesajı kendiliğinden kaybolur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) })),
    );
  });

  it("kapatma onayı gösterilir ve ~6 sn sonra kaybolur; yeni kopya metinleri ekranda", async () => {
    render(<TwoFactorCard initialEnabled={true} />);
    // Kullanıcının istediği yeni kopyalar:
    expect(screen.getByText("İki adımlı doğrulama etkin.")).toBeTruthy();
    expect(screen.getByText(/Durum: Henüz oluşturulmadı/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Mevcut kod", { selector: "#tf-off" }), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /2FA'yı kapat/ }));
    await waitFor(() => expect(screen.getByText("2FA kapatıldı.")).toBeTruthy());

    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(screen.queryByText("2FA kapatıldı.")).toBeNull();
  });
});

describe("RegisterForm — göz ikonlu şifre alanı (uygulama içi üretici BİLİNÇLİ YOK)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("göz düğmesi şifreyi gösterir/gizler; üretici butonu ve açıklaması yok", () => {
    render(<RegisterForm />);
    const input = document.getElementById("password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi göster" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi gizle" }));
    expect(input.type).toBe("password");
    // Kullanıcı kararı: tarayıcının kendi önericisiyle yarışan üretici kaldırıldı.
    expect(screen.queryByRole("button", { name: /Güçlü şifre öner/ })).toBeNull();
    expect(screen.queryByText(/şifre yöneticinize/i)).toBeNull();
    // Tarayıcı önericisini tetikleyen sözleşme yerinde:
    expect(input.autocomplete).toBe("new-password");
  });
});
