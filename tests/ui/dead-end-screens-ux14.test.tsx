// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { VerifyEmailForm, failedNextStep } from "@/components/auth/verify-email-form";
import { AlertEmailVerifyForm } from "@/components/auth/alert-email-verify-form";
import { showConnectChannel, canManageChannel, CONNECT_CHANNEL_HREF } from "@/components/connect-channel-button";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// UX-14 (kurucu 11-13: "mantıklı yap, akışı düşünerek, görsel olarak analiz ederek") — çıkmaz ekranlara TEK sonraki adım.
// Sayfa düzeyindeki boş durumlar (gerçek veritabanıyla): tests/integration/empty-states-next-step.test.ts.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const session = (over: Partial<SessionPayload> = {}) =>
  ({ userId: "u1", organizationId: "org-1", role: "owner", email: "sahip@example.com", sessionEpoch: 0, ...over }) as SessionPayload;

describe("bağlantı düğmesi kuralı (tek kaynak)", () => {
  it("yalnız: bağlantı yok + hesap sahibi (ya da operatör) + gerçek hesap", () => {
    expect(showConnectChannel(session(), false)).toBe(true);
    expect(showConnectChannel(session(), true)).toBe(false); // zaten bağlı
    expect(showConnectChannel(session({ role: "manager" }), false)).toBe(false); // yönetici kuramaz (Ayarlar "hesap sahibinden isteyin" der)
    expect(showConnectChannel(session({ role: "staff" }), false)).toBe(false);
    expect(showConnectChannel(session({ organizationId: DEMO_ORG_ID }), false)).toBe(false); // örnek hesapta kanal kurulmaz
    expect(CONNECT_CHANNEL_HREF).toBe("/settings?tab=baglantilar");
  });

  it("operatör (2FA'lı süper yönetici) yönetici rolündeyken de kurabilir — Ayarlar'daki kuralla aynı", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "op@example.com");
    const op = session({ role: "manager", email: "op@example.com", mfa: true } as Partial<SessionPayload>);
    expect(canManageChannel(op)).toBe(true);
    expect(showConnectChannel(op, false)).toBe(true);
    // 2FA'sız oturum operatör sayılmaz (isSuperAdmin tek boğaz).
    expect(canManageChannel(session({ role: "manager", email: "op@example.com", mfa: false } as Partial<SessionPayload>))).toBe(false);
  });
});

describe("e-posta doğrulama — kurtarılamaz durumda tek sonraki adım", () => {
  it("anahtar yok / süresi dolmuş → giriş ekranı 'tekrar gönder' kutusu açık gelir", () => {
    expect(failedNextStep("missing")).toMatchObject({ href: "/login?verify=missing", label: "Yeni bağlantı isteyin", apiRoute: false });
    expect(failedNextStep("expired")).toMatchObject({ href: "/login?verify=expired", label: "Yeni bağlantı isteyin", apiRoute: false });
  });

  it("başka hesapla oturum açık → önce çıkış (girişe dönmek panoya atıyordu = döngü)", () => {
    expect(failedNextStep("session_mismatch")).toEqual({ href: "/api/auth/logout", label: "Çıkış yapın", hint: null, apiRoute: true });
  });

  it("bilinmeyen sebep → eski davranış (girişe dön)", () => {
    expect(failedNextStep("tuhaf")).toMatchObject({ href: "/login", label: "Girişe dön" });
  });

  it("anahtarsız açılan sayfa: tek uyarı simgesi + 'Yeni bağlantı isteyin' bağlantısı", async () => {
    window.history.replaceState({}, "", "/verify-email");
    render(<VerifyEmailForm />);
    const link = await screen.findByRole("link", { name: "Yeni bağlantı isteyin" });
    expect(link.getAttribute("href")).toBe("/login?verify=missing");
    const alert = screen.getByRole("alert");
    expect(alert.querySelectorAll("svg")).toHaveLength(1); // eskiden FormError + satır içi simge = iki simge
    expect(screen.queryByRole("link", { name: "Girişe dön" })).toBeNull();
  });

  it("sunucu 'başka hesap' derse: düz bağlantı (tam sayfa) ile çıkış", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reason: "session_mismatch" }), { status: 400 })));
    window.history.replaceState({}, "", "/verify-email#t=anahtar-1");
    render(<VerifyEmailForm />);
    const pw = (await screen.findByLabelText("Şifreniz")) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "sifre12345" } });
    await act(async () => {
      fireEvent.submit(pw.closest("form")!);
    });
    const link = await screen.findByRole("link", { name: "Çıkış yapın" });
    expect(link.getAttribute("href")).toBe("/api/auth/logout");
  });
});

describe("uyarı adresi onayı — hata ve başarı ekranı", () => {
  beforeEach(() => window.history.replaceState({}, "", "/alert-email/verify"));

  it("hata: ne yapılacağını söyleyen cümle + Ayarlar › Genel bağlantısı", async () => {
    render(<AlertEmailVerifyForm />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/Ayarlar › Genel'de adresi yeniden kaydederek/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ayarlara gidin" }).getAttribute("href")).toBe("/settings?tab=genel");
  });

  it("başarı: yapılacak iş kalmadığını söyler, giriş istemez", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.history.replaceState({}, "", "/alert-email/verify#t=onay-1");
    render(<AlertEmailVerifyForm />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText(/Bu sayfayı kapatabilirsiniz\./)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
