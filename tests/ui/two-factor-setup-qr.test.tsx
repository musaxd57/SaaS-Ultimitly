// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// QR çizen bileşenin YERİNE değerini görünür kılan bir taklit: QR'a GERÇEKTEN hangi adresin girdiği sınanır (çizilen SVG'den adres okunamaz).
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (p: { value: string; title?: string }) => <svg data-qr-value={p.value} aria-label={p.title} />,
}));

import { TwoFactorCard, isTotpSetupUri } from "@/components/settings/two-factor-card";
import { generateSecret, otpauthUri } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// UX-16 (kurucu 11-13: "kesinlikle evet QR'ı ekle") — iki adımlı giriş kurulumu.
// Sunucu kurulum yanıtında anahtar adresini (otpauth://) zaten döndürüyordu; ekran onu kullanmıyor, kullanıcı 32 karakterlik anahtarı
// elle yazmak zorunda kalıyordu. Artık QR tarayıcıda çizilir (dış servis yok), elle giriş yolu yedek olarak durur.
// Kimlik akışı: ilk gerçek kurulum kurucuyla birlikte denenir.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACCOUNT = "ev.sahibi@example.com";

function stubSetup(body: Record<string, unknown>) {
  const calls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body);
      calls.push(req);
      if (req.action === "setup") return Promise.resolve({ ok: true, json: async () => body });
      if (req.action === "enable") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }),
  );
  return calls;
}

async function startSetup() {
  render(<TwoFactorCard initialEnabled={false} />);
  fireEvent.change(screen.getByLabelText("Hesap şifreniz"), { target: { value: "parola-123" } });
  fireEvent.click(screen.getByRole("button", { name: /İki adımlı girişi \(2FA\) kur/ }));
  await waitFor(() => expect(screen.getByLabelText("Uygulamadaki kod")).toBeTruthy());
}

describe("UX-16 — anahtar adresi biçimi", () => {
  it("doğrulayıcı uygulamaların okuduğu biçim: boşluk %20 (form kodlamasındaki '+' DEĞİL), SHA1 / 6 hane / 30 sn", () => {
    const secret = generateSecret();
    const uri = otpauthUri(secret, ACCOUNT);
    expect(uri.startsWith("otpauth://totp/Lixus%20AI%3Aev.sahibi%40example.com?")).toBe(true);
    expect(uri).not.toContain("+");
    expect(uri).toContain("issuer=Lixus%20AI");
    const q = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
    expect(q.get("secret")).toBe(secret);
    expect(q.get("issuer")).toBe("Lixus AI");
    expect(q.get("algorithm")).toBe("SHA1");
    expect(q.get("digits")).toBe("6");
    expect(q.get("period")).toBe("30");
  });

  it("QR'a yalnız TOTP kurulum adresi girer", () => {
    expect(isTotpSetupUri(otpauthUri(generateSecret(), ACCOUNT))).toBe(true);
    for (const bad of [
      "https://example.com/?secret=ABCDEFGH",
      "otpauth://hotp/Lixus%20AI%3Aa?secret=ABCDEFGH&counter=0",
      "otpauth://totp/Lixus%20AI%3Aa?issuer=Lixus%20AI",
      "otpauth://totp/Lixus%20AI%3Aa?secret=abcdefgh",
      `otpauth://totp/a?secret=${"A".repeat(600)}`,
      "javascript:alert(1)",
      null,
      42,
    ]) {
      expect(isTotpSetupUri(bad), String(bad)).toBe(false);
    }
  });
});

describe("UX-16 — kurulum ekranında QR", () => {
  it("sunucunun döndürdüğü adres QR olarak çizilir; anahtar elle giriş için yine görünür", async () => {
    const secret = generateSecret();
    const uri = otpauthUri(secret, ACCOUNT);
    stubSetup({ secret, otpauthUri: uri, setupId: "s1" });
    await startSetup();
    const qr = document.querySelector("[data-totp-qr] svg");
    expect(qr).not.toBeNull();
    expect(qr!.getAttribute("data-qr-value")).toBe(uri);
    // Koyu temada da okunsun: beyaz zemin.
    expect(document.querySelector("[data-totp-qr]")!.className).toContain("bg-white");
    expect(screen.getByText(/QR kodu tara/)).toBeTruthy();
    expect(screen.getByText(/Kodu okutamıyorsanız/)).toBeTruthy();
    expect(screen.getByText(secret.match(/.{1,4}/g)!.join(" "))).toBeTruthy();
  });

  it("adres yoksa ya da biçimi bozuksa QR çizilmez; eski elle giriş anlatımı kalır", async () => {
    for (const otp of [undefined, "https://example.com/?secret=ABCDEFGH"]) {
      const secret = generateSecret();
      stubSetup({ secret, ...(otp ? { otpauthUri: otp } : {}), setupId: "s1" });
      await startSetup();
      expect(document.querySelector("[data-totp-qr]")).toBeNull();
      expect(screen.getByText(/aşağıdaki/)).toBeTruthy();
      expect(screen.getByText(secret.match(/.{1,4}/g)!.join(" "))).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("doğrulama başarılı olunca QR ve anahtar ekrandan kalkar", async () => {
    const secret = generateSecret();
    stubSetup({ secret, otpauthUri: otpauthUri(secret, ACCOUNT), setupId: "s1" });
    await startSetup();
    fireEvent.change(screen.getByLabelText("Uygulamadaki kod"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Doğrula ve aç/ }));
    await waitFor(() => expect(screen.getByText(/İki adımlı doğrulama açıldı/)).toBeTruthy());
    expect(document.querySelector("[data-totp-qr]")).toBeNull();
    expect(screen.queryByText(secret.match(/.{1,4}/g)!.join(" "))).toBeNull();
  });
});
