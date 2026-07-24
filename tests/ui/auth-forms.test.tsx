// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// Müşterinin gördüğü İLK ekranlar (giriş + kayıt). Buradaki kusurlar sessizdir:
// kullanıcı sıkışır ve geri dönmez. Pinlenen davranışlar:
//  • hata bir DURUM'dur → kullanıcı düzeltmeye başlayınca kalkar (zamanlayıcı YOK);
//  • "doğrulama bağlantısı gönderildi" durumu e-posta değişince SIFIRLANIR — yoksa
//    yanlış adrese gönderdikten sonra sayfa yenilemeden ikinci deneme imkânsızdı;
//  • uçuştaki yeniden-gönderim çift tıkla ikinci isteği ATEŞLEMEZ (dakikalık kota);
//  • kayıt başarı ekranı ÇIKMAZ değildir (giriş sayfasına yol verir).

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("LoginForm — doğrulama e-postası kurtarma yolu", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/login?verify=expired");
  });

  it("süresi dolmuş bağlantı → yeniden gönder; e-posta DÜZELTİLİNCE buton geri gelir (çıkmaz yok)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts?: RequestInit) => {
        calls.push(JSON.parse(String(opts?.body)).email);
        return new Response("{}", { status: 200 });
      }),
    );
    render(<LoginForm />);
    // Süresi dolmuş link uyarısı + yeniden gönder yolu görünür.
    await screen.findByText(/Doğrulama bağlantısı geçersiz/);
    typeInto(/E-posta/, "yanlis@ornek.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /tekrar gönder/ }));
    });
    await screen.findByText(/gönderildi/);
    expect(calls).toEqual(["yanlis@ornek.com"]);

    // Adres yanlış yazılmıştı: düzeltince "gönderildi" durumu sıfırlanmalı ve
    // buton geri gelmeli (eskiden metin kalıcıydı → sayfa yenilemeden çıkış yoktu).
    typeInto(/E-posta/, "dogru@ornek.com");
    const again = await screen.findByRole("button", { name: /tekrar gönder/ });
    await act(async () => {
      fireEvent.click(again);
    });
    await waitFor(() => expect(calls).toEqual(["yanlis@ornek.com", "dogru@ornek.com"]));
  });

  it("çift tıklama İKİNCİ isteği ateşlemez (dakikalık yeniden-gönderim kotası yanmaz)", async () => {
    let resolve!: (r: Response) => void;
    const inflight = new Promise<Response>((r) => (resolve = r));
    const fetchMock = vi.fn(() => inflight);
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginForm />);
    typeInto(/E-posta/, "a@b.com");
    const btn = await screen.findByRole("button", { name: /tekrar gönder/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    // İstek uçarken buton pasif ve ikinci tık isteğe dönüşmüyor.
    const busy = screen.getByRole("button", { name: /Gönderiliyor/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true); // jest-dom yok — düz DOM özelliği
    await act(async () => {
      fireEvent.click(busy);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(new Response("{}", { status: 200 }));
    });
  });

  it("YARIŞ: istek uçarken adres değişirse, ESKİ isteğin geç cevabı yeni adrese 'gönderildi' demez", async () => {
    // Alan gönderim sırasında kilitli DEĞİL (yazım hatası düzeltilebilmeli), bu
    // yüzden cevap gönderildiği adrese bağlanır: adres değiştiyse sonuç bayattır.
    let resolve!: (r: Response) => void;
    const inflight = new Promise<Response>((r) => (resolve = r));
    const sentTo: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts?: RequestInit) => {
        sentTo.push(JSON.parse(String(opts?.body)).email);
        return inflight;
      }),
    );
    render(<LoginForm />);
    typeInto(/E-posta/, "eski@ornek.com");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /tekrar gönder/ }));
    });
    // Cevap gelmeden kullanıcı adresi düzeltiyor…
    typeInto(/E-posta/, "yeni@ornek.com");
    // …ve ESKİ isteğin cevabı şimdi geliyor.
    await act(async () => {
      resolve(new Response("{}", { status: 200 }));
    });
    expect(sentTo).toEqual(["eski@ornek.com"]); // mail yalnız eski adrese gitti
    expect(screen.queryByText(/gönderildi/)).toBeNull(); // yeni adres için YALAN onay yok
    // Yeni adres için istek hâlâ mümkün (buton kilitli kalmadı).
    const btn = (await screen.findByRole("button", { name: /tekrar gönder/ })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("hata bir DURUM'dur: şifre düzeltilmeye başlanınca kaybolur (zaman aşımıyla değil)", async () => {
    window.history.replaceState({}, "", "/login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Giriş başarısız oldu" }), { status: 401 })),
    );
    render(<LoginForm />);
    typeInto(/E-posta/, "a@b.com");
    typeInto(/Şifre/, "yanlis");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
    });
    await screen.findByText("Giriş başarısız oldu");
    typeInto(/Şifre/, "yanlis2");
    expect(screen.queryByText("Giriş başarısız oldu")).toBeNull();
  });
});

describe("RegisterForm — başarı ekranı çıkmaz değildir", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("'zaten kayıtlı' hatası E-POSTA DÜZELTİLİNCE kalkar — yeni adresin altında asılı kalmaz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Doğrulama hatası",
              fields: { email: "Bu e-posta adresi zaten kayıtlı" },
            }),
            { status: 400 },
          ),
      ),
    );
    render(<RegisterForm />);
    typeInto(/İşletme adı/, "Nuve");
    typeInto(/Adınız/, "Musa");
    typeInto(/E-posta/, "kayitli@ornek.com");
    typeInto(/Şifre/, "sifre12345");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    });
    await screen.findByText("Bu e-posta adresi zaten kayıtlı");
    expect(screen.getByText("Doğrulama hatası")).toBeTruthy();

    // Kullanıcı adresi değiştiriyor: hem alan hatası hem üstteki özet gitmeli.
    typeInto(/E-posta/, "yepyeni@ornek.com");
    expect(screen.queryByText("Bu e-posta adresi zaten kayıtlı")).toBeNull();
    expect(screen.queryByText("Doğrulama hatası")).toBeNull();
  });

  it("kayıt sonrası doğrulama ekranı giriş sayfasına yol verir (mail gelmezse kurtarma oradadır)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, verifyEmail: true }), { status: 201 })),
    );
    render(<RegisterForm />);
    typeInto(/İşletme adı/, "Nuve");
    typeInto(/Adınız/, "Musa");
    typeInto(/E-posta/, "yeni@ornek.com");
    typeInto(/Şifre/, "sifre12345");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    });
    await screen.findByText(/son bir adım kaldı/);
    const link = screen.getByRole("link", { name: /giriş sayfasından/ });
    expect(link.getAttribute("href")).toBe("/login");
  });
});
