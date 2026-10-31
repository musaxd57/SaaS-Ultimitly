// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// AUTH FORMLARI — hata durumunda aria-invalid + DOĞRU aria-describedby.
//
// "Doğru" burada kritik kelime: describedby, hatanın GERÇEKTEN ait olduğu alanı
// göstermeli. Sunucu `fields.code` / `fields.newPassword` ayrımını zaten
// yapıyordu ama istemci hepsini TEK genel bandda topluyordu — bilgi vardı,
// çöpe atılıyordu. Ekran okuyucu kullanıcısı "kod mu yanlış, şifre mi kısa"
// ayrımını yapamıyordu.
//
// ATFEDİLEMEYEN hatada alan İŞARETLENMEZ: "E-posta veya şifre hatalı"da hangi
// alanın yanlış olduğu BİLİNMEZ. İkisine birden aria-invalid koymak yanlış
// bilgidir (doğru yazılmış e-postayı geçersiz ilan eder). Doğrusu: form-bazlı
// duyuru + ikisine de aria-describedby (alana dönen kullanıcı hatayı tekrar
// duyar), aria-invalid YOK.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { RegisterForm } from "@/components/auth/register-form";
import { LoginForm } from "@/components/auth/login-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

function reset() {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

/** Alanın describedby'sinin işaret ettiği düğümlerin metinleri. */
function describedTexts(el: HTMLElement): string[] {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "");
}

function submitForm(el: HTMLElement) {
  return act(async () => {
    fireEvent.submit(el.closest("form")!);
  });
}

// ===========================================================================
// KAYIT — alan bazlı hata (zaten Field kullanıyor; sözleşme pinlenir)
// ===========================================================================
describe("Kayıt formu", () => {
  beforeEach(reset);

  async function submitWith(response: unknown, status: number) {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(response, status)));
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("İşletme adı"), { target: { value: "Lale" } });
    fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Musa" } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await submitForm(screen.getByRole("button", { name: "Hesap Oluştur" }));
  }

  it("e-posta hatası SADECE e-posta alanını işaretler", async () => {
    await submitWith({ fields: { email: "Bu e-posta zaten kayıtlı." } }, 400);

    const email = screen.getByLabelText("E-posta");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(email)).toContain("Bu e-posta zaten kayıtlı.");
    // Komşu alanlar TEMİZ kalır — yoksa kullanıcı doğru yazdığı adı da düzeltmeye çalışır.
    expect(screen.getByLabelText("Adınız").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText("Şifre").getAttribute("aria-invalid")).toBeNull();
  });

  it("şifre hatası şifre alanını işaretler ve KURALI da bağlı tutar", async () => {
    await submitWith({ fields: { password: "Çok kısa." } }, 400);

    const pw = screen.getByLabelText("Şifre");
    await waitFor(() => expect(pw.getAttribute("aria-invalid")).toBe("true"));
    const texts = describedTexts(pw);
    expect(texts).toContain("Çok kısa.");
    expect(texts).toContain("En az 8 karakter."); // kural kaybolmaz
  });
});

// ===========================================================================
// GİRİŞ
// ===========================================================================
describe("Giriş formu", () => {
  beforeEach(reset);

  it("2FA kodu hatalıysa KOD alanı işaretlenir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ twoFactorRequired: true, error: "Doğrulama kodu hatalı" }, 401),
      ),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "sifre1234" } });
    await submitForm(screen.getByLabelText("E-posta"));

    const code = await screen.findByLabelText(/Doğrulama kodu|Kurtarma kodu/);
    await waitFor(() => expect(code.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(code)).toContain("Doğrulama kodu hatalı");
  });

  it("'önce e-posta girin' uyarısı E-POSTA alanına aittir", async () => {
    // Bu dal yalnız "doğrulanmamış hesap" yanıtından SONRA görünür: önce oraya in.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ needsVerification: true, error: "Hesabınız doğrulanmamış." }, 403),
      ),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "sifre1234" } });
    await submitForm(screen.getByLabelText("E-posta"));

    const resend = await screen.findByRole("button", { name: /tekrar gönder/i });
    // Adresi boşalt → tekrar-gönder artık hangi adrese göndereceğini bilmiyor.
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(resend);
    });

    const email = screen.getByLabelText("E-posta");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(email)).toContain("Önce e-posta adresinizi girin.");
  });

  it("ATFEDİLEMEYEN kimlik hatası: alan geçersiz İŞARETLENMEZ ama ikisine de bağlanır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "E-posta veya şifre hatalı" }, 401)),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "yanlis" } });
    await submitForm(screen.getByLabelText("E-posta"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("E-posta veya şifre hatalı");

    const email = screen.getByLabelText("E-posta");
    const password = screen.getByLabelText("Şifre");
    // Alana dönen kullanıcı hatayı TEKRAR duyar…
    expect(describedTexts(email).join(" ")).toContain("E-posta veya şifre hatalı");
    expect(describedTexts(password).join(" ")).toContain("E-posta veya şifre hatalı");
    // …ama hangisinin yanlış olduğu BİLİNMEDİĞİ için geçersiz İLAN EDİLMEZ.
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(password.getAttribute("aria-invalid")).toBeNull();
  });
});

// ===========================================================================
// ŞİFREMİ UNUTTUM — sunucunun alan ayrımı KORUNUR
// ===========================================================================
describe("Şifremi unuttum formu", () => {
  beforeEach(reset);

  it("e-posta adımında alan hatası E-POSTA alanına bağlanır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ fields: { email: "Geçerli bir e-posta girin." } }, 400)),
    );
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "bozuk" } });
    await submitForm(screen.getByLabelText("E-posta"));

    const email = screen.getByLabelText("E-posta");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(email)).toContain("Geçerli bir e-posta girin.");
  });

  /**
   * Kod ekranına iner.
   *
   * ⚠️ 08-09'da DEĞİŞTİ: e-posta yazıp "Kod gönder" demek artık kod ekranını
   * AÇMIYOR — token'sız ekranda kod alanı bilerek çizilmiyor (kullanıcının
   * canlıda gördüğü kapalı döngü: e-postadaki kodu oraya yazınca sunucu
   * haklı olarak reddediyordu). Kod alanına ulaşmanın TEK yolu bağlantıdan
   * gelmektir, o yüzden test token'ı FRAGMENT'e koyar.
   * ⚠️ Token 64 HEX olmak zorunda — form `[0-9a-f]{64}` ile eşleştiriyor.
   */
  async function reachConfirmStep(confirmResponse: unknown, status: number) {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(confirmResponse, status));
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState({}, "", `/sifremi-unuttum#t=${"c".repeat(64)}`);
    render(<ForgotPasswordForm />);

    const code = await screen.findByLabelText("Doğrulama kodu");
    fireEvent.change(code, { target: { value: "12345678" } });
    fireEvent.change(screen.getByLabelText("Yeni şifre"), { target: { value: "yenisifre1" } });
    await submitForm(code);
  }

  it("KOD hatası kod alanına bağlanır, şifre alanı TEMİZ kalır", async () => {
    await reachConfirmStep({ fields: { code: "Kod geçersiz veya süresi dolmuş." } }, 400);

    const code = screen.getByLabelText("Doğrulama kodu");
    await waitFor(() => expect(code.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(code)).toContain("Kod geçersiz veya süresi dolmuş.");
    expect(screen.getByLabelText("Yeni şifre").getAttribute("aria-invalid")).toBeNull();
  });

  it("ŞİFRE hatası şifre alanına bağlanır, kod alanı TEMİZ kalır", async () => {
    await reachConfirmStep({ fields: { newPassword: "En az 8 karakter olmalı." } }, 400);

    const pw = screen.getByLabelText("Yeni şifre");
    await waitFor(() => expect(pw.getAttribute("aria-invalid")).toBe("true"));
    expect(describedTexts(pw)).toContain("En az 8 karakter olmalı.");
    expect(screen.getByLabelText("Doğrulama kodu").getAttribute("aria-invalid")).toBeNull();
  });

  it("alana atfedilemeyen hata form-bazlı DUYURU olarak kalır", async () => {
    await reachConfirmStep({ error: "İşlem başarısız oldu." }, 500);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("İşlem başarısız oldu.");
    expect(screen.getByLabelText("Doğrulama kodu").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText("Yeni şifre").getAttribute("aria-invalid")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BAYAT ALAN HATASI — `error` ile `fieldError` ayrıldığında ortaya çıkan risk.
// Eskiden TEK bir `error` state'i vardı ve onu temizleyen her yol hatayı
// gerçekten siliyordu. Alan hataları ayrı bir state'e taşınınca, `error`i
// temizleyen ama `fieldError`i unutan yollar alanı YANLIŞLIKLA "geçersiz"
// damgalı bırakır — üstelik kullanıcı o alanı çoktan boşaltmış olur.
// ---------------------------------------------------------------------------
describe("Giriş formu — bayat alan hatası bırakmaz", () => {
  beforeEach(reset);

  async function reachTwoFactorError() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ twoFactorRequired: true, error: "Doğrulama kodu hatalı" }, 401),
      ),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "sifre1234" } });
    await submitForm(screen.getByLabelText("E-posta"));
    const code = await screen.findByLabelText("Doğrulama kodu");
    await waitFor(() => expect(code.getAttribute("aria-invalid")).toBe("true"));
  }

  it("kurtarma koduna geçince ESKİ kod hatası kalkar", async () => {
    await reachTwoFactorError();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /kurtarma kodu kullan/i }));
    });

    // Alan boşaltıldı ve TÜRÜ değişti; eski hata artık geçerli değil.
    const recovery = screen.getByLabelText("Kurtarma kodu");
    expect(recovery.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("Doğrulama kodu hatalı")).toBeNull();
  });

  it("yeniden gönderimde eski alan hatası taşınmaz", async () => {
    await reachTwoFactorError();

    // İkinci deneme GENEL bir hatayla düşerse, kod alanı eski mesajla
    // damgalı kalmamalı — yoksa ekranda iki farklı hata görünür.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Giriş başarısız oldu" }, 401)),
    );
    await submitForm(screen.getByLabelText("Doğrulama kodu"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Giriş başarısız oldu"),
    );
    expect(screen.getByLabelText("Doğrulama kodu").getAttribute("aria-invalid")).toBeNull();
  });
});
