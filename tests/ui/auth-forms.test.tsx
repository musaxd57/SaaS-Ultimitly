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
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Kayıt başarı ekranındaki yeniden-gönder bekleme süresi (register-form ile aynı). */
const RESEND_COOLDOWN_SEC = 60;

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

describe("ForgotPasswordForm — yanlış yazılan e-posta düzeltilebilir", () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("kod ekranından e-postaya DÖNÜLEBİLİR ve ikinci istek YENİ adrese gider", async () => {
    // Uç nokta enumeration-safe: adres kayıtlı olsun olmasın kod ekranına geçer.
    // Dolayısıyla harf hatası yapan kullanıcı, gelmeyecek bir kodu bekleyerek
    // kilitleniyordu — sayfayı yenilemeden geri dönüş yolu yoktu.
    const sentTo: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts?: RequestInit) => {
        sentTo.push(JSON.parse(String(opts?.body)).email);
        return new Response("{}", { status: 200 });
      }),
    );
    render(<ForgotPasswordForm />);
    typeInto(/E-posta/, "musa@gmial.com"); // yazım hatası
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });

    // Kod ekranındayız ve hangi adrese gittiği GÖRÜNÜYOR (hatayı fark etmenin tek yolu).
    await screen.findByLabelText(/Doğrulama kodu/);
    expect(screen.getByText("musa@gmial.com")).toBeTruthy();

    // Geri dön: alan eski değerle DOLU gelmeli (yeniden yazdırmak kabalık olurdu).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /E-posta adresini değiştir/ }));
    });
    const field = (await screen.findByLabelText(/E-posta/)) as HTMLInputElement;
    expect(field.value).toBe("musa@gmial.com");

    // Düzelt ve tekrar gönder → ikinci istek DOĞRU adrese gider.
    typeInto(/E-posta/, "musa@gmail.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });
    await waitFor(() => expect(sentTo).toEqual(["musa@gmial.com", "musa@gmail.com"]));
  });

  it("geri dönüş eski kodu ve hatayı temizler (bayat durum taşınmaz)", async () => {
    let reply = new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => reply));
    render(<ForgotPasswordForm />);
    typeInto(/E-posta/, "a@b.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });
    typeInto(/Doğrulama kodu/, "12345678");
    typeInto(/Yeni şifre/, "yenisifre123"); // jsdom zorunlu alanı boşken formu göndermez
    // Yanlış kod → hata görünür.
    reply = new Response(JSON.stringify({ error: "Kod geçersiz" }), { status: 400 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şifreyi sıfırla" }));
    });
    await screen.findByText("Kod geçersiz");

    reply = new Response("{}", { status: 200 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /E-posta adresini değiştir/ }));
    });
    expect(screen.queryByText("Kod geçersiz")).toBeNull();
    // Yeni kod istenince eski kod alanı boş başlamalı.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });
    const codeField = (await screen.findByLabelText(/Doğrulama kodu/)) as HTMLInputElement;
    expect(codeField.value).toBe("");
  });
});

describe("RegisterForm — başarı ekranı çıkmaz değildir", () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers(); // önceki test sahte zamanlayıcıyla düşerse buraya sızmasın
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

  it("başarı ekranında 'yeniden gönder' DOĞRUDAN durur: sayaç dolunca kayıt adresine yeni bağlantı gider", async () => {
    // Codex: kurtarma yolunun giriş sayfasında, üstelik BAŞARISIZ bir giriş
    // denemesinin arkasında saklı olması gizli bir akıştı. Buton artık burada.
    // shouldAdvanceTime: sahte zamanlayıcı açıkken testing-library'nin bekleyicileri
    // (findBy*/waitFor) gerçek zamana ihtiyaç duyar — bu bayrak olmadan test kilitlenir.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(opts?.body)) });
        return new Response(JSON.stringify({ ok: true, verifyEmail: true }), { status: 201 });
      }),
    );
    try {
      render(<RegisterForm />);
      typeInto(/İşletme adı/, "Nuve");
      typeInto(/Adınız/, "Musa");
      typeInto(/E-posta/, "yeni@ornek.com");
      typeInto(/Şifre/, "sifre12345");
      fireEvent.click(screen.getByRole("checkbox"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
      });
      const btn = (await screen.findByRole("button", { name: /yeniden gönder/i })) as HTMLButtonElement;
      // Mail az önce gitti → sayaç dolana kadar kilitli (kota korunur).
      expect(btn.disabled).toBe(true);
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(calls).toHaveLength(1); // kilitliyken tık isteğe dönüşmez

      // Sayaç bitince buton açılır ve KAYIT adresine yeniden gönderir. Geri sayım
      // zincirleme setTimeout ile ilerlediği için her saniye kendi act turunu ister
      // (tek seferde 61 sn atlamak yalnız İLK adımı işletir).
      for (let i = 0; i < RESEND_COOLDOWN_SEC + 1; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      const ready = (await screen.findByRole("button", { name: /yeniden gönder/i })) as HTMLButtonElement;
      expect(ready.disabled).toBe(false);
      await act(async () => {
        fireEvent.click(ready);
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({
        url: "/api/auth/resend-verification",
        body: { email: "yeni@ornek.com" },
      });
      await screen.findByText("Yeni bağlantı gönderildi.");
    } finally {
      vi.useRealTimers();
    }
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
