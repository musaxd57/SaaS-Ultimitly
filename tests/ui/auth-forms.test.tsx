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
    typeInto("Şifre", "yanlis");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
    });
    await screen.findByText("Giriş başarısız oldu");
    typeInto("Şifre", "yanlis2");
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

    // "Bağlantıyı aç" ekranındayız ve hangi adrese gittiği GÖRÜNÜYOR (hatayı
    // fark etmenin tek yolu). ⚠️ ÇAPA 08-09'da kod alanından bu ekrana TAŞINDI:
    // token yokken kod alanı artık hiç çizilmiyor (↓kapalı döngü testi).
    await screen.findByText(/E-postadaki bağlantıyı açın/i);
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

  it("🚨 kod ekranı teslimatı KESİN dille İDDİA ETMEZ + kod gelmezse çıkış yolu gösterir", async () => {
    // Uç nokta enumeration'a karşı BİLİNMEYEN adrese de generic 200 döner.
    // Ekran "gönderildi" derse, hesabı olmayan (ya da hesabını SİLMİŞ) kullanıcı
    // hiç gelmeyecek bir kodu süresiz bekler: ekranda yazı VAR ama YANLIŞ ve
    // çıkış yolu YOK — kayıt ekranındaki "zaten hesabın var" ile aynı kapalı
    // döngü. Koşullu cümle herkese aynı gösterildiği için hiçbir şey sızdırmaz.
    // ⚠️ Düzeltme METİNDİR, e-posta DEĞİL: `EmailOutbox.userId` zorunlu olduğu
    // için hesapsız kuyruk satırı yazılamaz; bilinmeyen dalda doğrudan
    // sağlayıcıya gitmek ise o dala gecikme ekleyip zamanlama oracle'ı açardı.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    render(<ForgotPasswordForm />);
    typeInto(/E-posta/, "silinmis@example.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });
    await screen.findByText(/E-postadaki bağlantıyı açın/i);

    // Adres HÂLÂ görünür (yazım hatası ancak görülerek fark edilir)...
    expect(screen.getByText("silinmis@example.com")).toBeTruthy();
    // ...ama cümle KOŞULLU: "varsa".
    expect(screen.getByText(/adresine ait bir hesap varsa e-posta gönderdik/i)).toBeTruthy();

    // Ve e-posta gelmezse ne yapılacağı YAZILI + kayıt yolu tıklanabilir.
    // ⚠️ TEK bir satırda. Önce kod alanının ÜSTÜNE ayrı bir kutu koymuştum ve
    // "spam klasörünü kontrol edin" ekranda İKİ KEZ görünüyordu; kutu ayrıca
    // kullanıcıların çoğunun geldiği asıl işi (kodu yazmak) bölüyordu.
    expect(screen.getAllByText(/spam klasörünü kontrol edin/i)).toHaveLength(1);
    expect(screen.getByText(/kayıtlı bir hesabınız olmayabilir/i)).toBeTruthy();
    const kayit = screen.getByRole("link", { name: /yeni hesap oluşturun/i });
    expect(kayit.getAttribute("href")).toBe("/register");
    // ⚠️ ZAMANLAYICIYA BAĞLI DEĞİL: bu satırın koruduğu kişiye kod ASLA
    // gelmeyecek (hesabı yok/silinmiş). Bekleme sayacı hâlâ sayarken bile
    // çıkış yolu görünür olmalı — "beklemenin boşuna olduğunu öğrenmek için
    // bekle" bir tasarım değildir.
    expect(screen.getByRole("button", { name: /E-postayı tekrar gönder/ })).toBeTruthy();
  });

  // ⚠️ ÇAPA TAŞINDI, DEĞİŞMEZ AYNI (08-09). Bu test "bayat durum taşınmaz"ı
  // pinliyordu ve eskiden token'SIZ ekranda koşuyordu — ama o ekranda artık kod
  // ve şifre alanı YOK (↓kapalı döngü). Değişmezin hâlâ geçerli olduğu yer
  // TOKEN'LI yol; test oraya taşındı, silinmedi.
  it("geri dönüş eski kodu ve hatayı temizler (bayat durum taşınmaz)", async () => {
    let reply = new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => reply));
    // Bağlantıdan gelmiş gibi: token FRAGMENT'te.
    // ⚠️ 64 HEX ŞART — form `[0-9a-f]{64}` ile eşleştiriyor; kısa bir sahte
    // token sessizce eşleşmez ve test "kod alanı yok" diye YANLIŞ sebeple düşer.
    window.history.replaceState({}, "", `/sifremi-unuttum#t=${"a".repeat(64)}`);
    render(<ForgotPasswordForm />);

    const codeField = (await screen.findByLabelText(/Doğrulama kodu/)) as HTMLInputElement;
    fireEvent.change(codeField, { target: { value: "12345678" } });
    typeInto(/Yeni şifre/, "yenisifre123"); // jsdom zorunlu alanı boşken formu göndermez
    // Yanlış kod → hata görünür.
    reply = new Response(JSON.stringify({ error: "Kod geçersiz" }), { status: 400 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şifreyi sıfırla" }));
    });
    await screen.findByText("Kod geçersiz");

    reply = new Response("{}", { status: 200 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Baştan başla/ }));
    });
    expect(screen.queryByText("Kod geçersiz")).toBeNull();
    // Odak doğrudan e-posta alanında: geri dönmenin TEK sebebi adresi düzeltmek.
    const emailField = (await screen.findByLabelText(/E-posta/)) as HTMLInputElement;
    expect(document.activeElement).toBe(emailField);
    // Ve bayat durum taşınmadı: token düştüğü için kod/şifre alanları da gitti.
    expect(screen.queryByLabelText(/Doğrulama kodu/)).toBeNull();
    expect(screen.queryByLabelText(/Yeni şifre/)).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🚨 KAPALI DÖNGÜ (kullanıcı canlıda fark etti, 08-09)
  //
  // Adresini yazan kullanıcı kod ekranına düşüyor, e-postadaki 8 haneli kodu
  // oraya yazıyor ve "Bu kod artık kullanılamıyor" alıyordu. Sunucu DOĞRU
  // davranıyordu: bütçe/kimlik challenge SATIRINDA ve satırı yalnız
  // bağlantıdaki token adresleyebiliyor (adres+kod ile aramak m47'nin kapattığı
  // DoS'u geri açardı). Yanlış olan EKRANDI — olmayan bir yolu davet ediyordu.
  // ───────────────────────────────────────────────────────────────────────────
  it("token YOKKEN kod alanı HİÇ çizilmez; ekran bağlantıyı açmayı söyler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.history.replaceState({}, "", "/sifremi-unuttum"); // fragment YOK
    render(<ForgotPasswordForm />);
    typeInto(/E-posta/, "musa@example.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kod gönder" }));
    });

    await screen.findByText(/E-postadaki bağlantıyı açın/i);
    // ASIL İDDİA: yazılacak bir kod alanı YOK → kullanıcı çıkmaza giremez.
    expect(screen.queryByLabelText(/Doğrulama kodu/)).toBeNull();
    expect(screen.queryByLabelText(/Yeni şifre/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Şifreyi sıfırla" })).toBeNull();
    // Ve neden yazamayacağı AÇIKÇA yazılı (sessiz bir eksiklik değil).
    expect(screen.getByText(/kodu bu ekrana\s+yazamazsınız/i)).toBeTruthy();
  });

  it("KONTROL: token VARKEN kod alanı çizilir, odaklanır ve mobil klavye sayısal olur", async () => {
    // Bu kontrol olmadan "kod alanını hiç çizme" mutasyonu da yeşil geçerdi.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.history.replaceState({}, "", `/sifremi-unuttum#t=${"b".repeat(64)}`);
    render(<ForgotPasswordForm />);

    const code = (await screen.findByLabelText(/Doğrulama kodu/)) as HTMLInputElement;
    // Codex istekleri — üçü de zaten yerindeydi, burada PİNLENİYOR:
    expect(document.activeElement).toBe(code); // bağlantıdan gelince odak kodda
    expect(code.getAttribute("inputmode")).toBe("numeric"); // mobilde sayısal klavye
    expect(code.getAttribute("autocomplete")).toBe("one-time-code"); // SMS/mail otomatik doldurma
    expect(code.maxLength).toBe(8);
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
    typeInto("Şifre", "sifre12345");
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
      typeInto("Şifre", "sifre12345");
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
    typeInto("Şifre", "sifre12345");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    });
    await screen.findByText(/son bir adım kaldı/);
    const link = screen.getByRole("link", { name: /giriş sayfasından/ });
    expect(link.getAttribute("href")).toBe("/login");
  });
});
