// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { AlertEmailVerifyForm } from "@/components/auth/alert-email-verify-form";
import { AlertEmailForm } from "@/components/settings/alert-email-form";

// ---------------------------------------------------------------------------
// Uyarı adresi doğrulaması — istemci (kurucu kararı 09-30).
//  · Onay sayfası belirteci parçadan okur, adres çubuğunu temizler ve OTOMATİK GÖNDERMEZ (e-posta tarayıcıları bağlantıyı açar);
//    onay yalnız "Adresi onayla" tıklamasıyla.
//  · Ayarlar formu: ekip dışı adreste "doğrulama bağlantısı gönderildi" der, kayıtlı değer DEĞİŞMİŞ gibi davranmaz.
// ---------------------------------------------------------------------------

describe("onay sayfası", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("🚨 bağlantıyı açmak onay DEĞİL: istek yalnız tıklamayla gider; parça adres çubuğundan silinir", async () => {
    window.history.replaceState(null, "", "/uyari-adresi-dogrula#t=abc.def");
    render(<AlertEmailVerifyForm />);
    const btn = await screen.findByRole("button", { name: /Adresi onayla/i });
    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    fireEvent.click(btn);
    expect(await screen.findByText(/Adres onaylandı/i)).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/alert-email/verify");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ token: "abc.def" });
  });

  it("belirteç yoksa açıklama gösterir, düğme yok, istek yok", async () => {
    window.history.replaceState(null, "", "/uyari-adresi-dogrula");
    render(<AlertEmailVerifyForm />);
    expect(await screen.findByText(/onay anahtarı yok/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sunucu reddederse sunucunun metnini gösterir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Bu bağlantı geçersiz ya da süresi dolmuş." }) }));
    window.history.replaceState(null, "", "/uyari-adresi-dogrula#t=abc.def");
    render(<AlertEmailVerifyForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Adresi onayla/i }));
    expect(await screen.findByText(/geçersiz ya da süresi dolmuş/i)).toBeTruthy();
  });
});

describe("Ayarlar — uyarı adresi formu", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ekip dışı adres: 'doğrulama bağlantısı gönderildi' — 'Kaydedildi' DEMEZ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alertEmailPending: true }) }));
    render(<AlertEmailForm initial="" />);
    fireEvent.change(screen.getByLabelText(/Uyarı e-posta adresi/i), { target: { value: "Ops@Example.net" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/i }));
    expect(await screen.findByText(/Doğrulama bağlantısı ops@example.net adresine gönderildi/i)).toBeTruthy();
    expect(screen.queryByText(/Kaydedildi/i)).toBeNull();
  });

  it("KONTROL — ekip üyesinin adresi bugünkü gibi 'Kaydedildi'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alertEmail: "owner@example.com" }) }));
    render(<AlertEmailForm initial="" />);
    fireEvent.change(screen.getByLabelText(/Uyarı e-posta adresi/i), { target: { value: "owner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/i }));
    expect(await screen.findByText(/Kaydedildi/i)).toBeTruthy();
    expect(screen.queryByText(/Doğrulama bağlantısı/i)).toBeNull();
  });
});
