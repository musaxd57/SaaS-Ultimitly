// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TestEmailButton } from "@/components/settings/test-email-button";

// Kullanıcı isteği (07-16): test maili BİR KEZ başarıyla gönderilince buton +
// açıklama kalıcı olarak kalksın (localStorage bayrağı); başarısız denemede
// kalsın ki tekrar denenebilsin.
// Codex (07-20): başarı bildirimi geçici toast (role=status, 8 sn sonra oto-temizlik,
// kapatma düğmesi); HATA bildirimi role=alert ve oto-kapanmaz.

describe("TestEmailButton (UI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers(); // fake-timer testleri userEvent tabanlı testlere sızmasın
  });

  it("başarılı gönderimde buton kaybolur, onay satırı kalır, bayrak yazılır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, to: "a@b.com" }), { status: 200 })),
    );
    render(<TestEmailButton />);
    await userEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Test e-postası gönder/ })).toBeNull();
    });
    expect(screen.getByText(/Test e-postası gönderildi/)).toBeTruthy();
    expect(localStorage.getItem("lixus-test-email-sent")).toBe("1");
  });

  it("BAŞARISIZ gönderimde buton KALIR (tekrar denenebilir) ve bayrak yazılmaz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "SMTP yok" }), { status: 500 })),
    );
    render(<TestEmailButton />);
    await userEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    await waitFor(() => expect(screen.getByText(/SMTP yok/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Test e-postası gönder/ })).toBeTruthy();
    expect(localStorage.getItem("lixus-test-email-sent")).toBeNull();
  });

  it("daha önce gönderilmişse (bayrak var) blok hiç render edilmez", async () => {
    localStorage.setItem("lixus-test-email-sent", "1");
    render(<TestEmailButton />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Test e-postası gönder/ })).toBeNull();
    });
    expect(screen.queryByText(/doğrulamak için bir test maili/)).toBeNull();
  });

  it("uyarı adresi DEĞİŞİNCE buton geri gelir ve eski adrese ait bayat onay satırı silinir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, to: "eski@adres.com" }), { status: 200 })),
    );
    render(<TestEmailButton />);
    await userEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    await waitFor(() => expect(screen.getByText(/eski@adres.com/)).toBeTruthy());
    // AlertEmailForm'un başarılı kaydında yaydığı event:
    window.dispatchEvent(new Event("lixus-alert-email-saved"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Test e-postası gönder/ })).toBeTruthy();
    });
    expect(screen.queryByText(/eski@adres.com/)).toBeNull(); // yanıltıcı satır gitti
  });

  it("BAŞARI toast'ı role=status + 8 sn sonra kendiliğinden kaybolur", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, to: "a@b.com" }), { status: 200 })),
    );
    render(<TestEmailButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    });
    // Erişilebilir canlı-bölge olarak sunulur ve mesajı taşır.
    expect(screen.getByRole("status").textContent).toMatch(/Test e-postası gönderildi/);
    // 8 sn geçince toast kendiliğinden temizlenir (sayfa değişmeden).
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByText(/Test e-postası gönderildi/)).toBeNull();
  });

  it("HATA bildirimi role=alert + otomatik KAPANMAZ (8 sn sonra bile durur)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "SMTP yok" }), { status: 500 })),
    );
    render(<TestEmailButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/SMTP yok/);
    await act(async () => {
      vi.advanceTimersByTime(30_000); // uzun süre geçse de hata bildirimi kalır
    });
    expect(screen.getByText(/SMTP yok/)).toBeTruthy();
  });

  it("kapatma düğmesi bildirimi elle kapatır", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "SMTP yok" }), { status: 500 })),
    );
    render(<TestEmailButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    });
    expect(screen.getByText(/SMTP yok/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Bildirimi kapat/ }));
    });
    expect(screen.queryByText(/SMTP yok/)).toBeNull();
  });

  it("BAŞARI toast'ı 8. sn'den ÖNCE temizlenmez (süre tam 8 sn)", async () => {
    // Dürüst kapsam (07-20 test-denetimi): başarıdan sonra buton gizlendiği için
    // UI'da ikinci gönderim — dolayısıyla gözlemlenebilir bir "restart" — mümkün
    // değil (timer yeniden-kurulumu useEffect [result] ile kod düzeyinde var ama
    // arayüzden sürülemez). Bu test yalnız GERÇEKTEN doğrulanabilir olanı pinler:
    // toast 5. sn'de HÂLÂ durur, 8. sn'de kaybolur — yani zamanlayıcı erken ateşlemez.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, to: "a@b.com" }), { status: 200 })),
    );
    render(<TestEmailButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    });
    // 5 sn: henüz temizlenmedi.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status").textContent).toMatch(/gönderildi/);
    // +3 sn (toplam 8): temizlenir.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/gönderildi/)).toBeNull();
  });
});
