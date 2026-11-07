// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U15 (kurucu 10-22): site anahtarı verilince kayıt formu Turnstile widget'ını çizer; doğrulama gelene kadar "Hesap Oluştur" kapalıdır,
// belirteç istekle gider, başarısız cevaptan sonra widget sıfırlanır (belirteç tek kullanımlık). Anahtar yoksa widget yok, istek eskisi.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { RegisterForm } from "@/components/auth/register-form";

let widgetOpts: Record<string, unknown> | null = null;
const turnstileApi = {
  render: vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
    widgetOpts = opts;
    return "w1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};
const fetchMock = vi.fn();

beforeEach(() => {
  widgetOpts = null;
  turnstileApi.render.mockClear();
  turnstileApi.reset.mockClear();
  fetchMock.mockReset();
  window.turnstile = turnstileApi;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.unstubAllGlobals();
});

function fill() {
  fireEvent.change(screen.getByLabelText("İşletme adı"), { target: { value: "İşletme" } });
  fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Ad Soyad" } });
  fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "sifre12345" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("U15 — kayıt formunda Turnstile", () => {
  it("site anahtarı varsa widget çizilir; doğrulama gelmeden düğme kapalı; belirteç istekle gider", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ verifyEmail: true }), { status: 201 }));
    render(<RegisterForm turnstileSiteKey="site-key" />);
    await waitFor(() => expect(turnstileApi.render).toHaveBeenCalledTimes(1));
    expect(widgetOpts).toMatchObject({ sitekey: "site-key", action: "register" });
    fill();
    const submit = screen.getByRole("button", { name: /Hesap Oluştur/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    act(() => (widgetOpts!.callback as (t: string) => void)("tok-1"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).turnstileToken).toBe("tok-1");
  });

  it("başarısız cevaptan sonra widget sıfırlanır ve düğme yeni doğrulamaya kadar kapanır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Güvenlik doğrulaması tamamlanamadı.", fields: { captcha: "Doğrulamayı tamamlayın." } }), {
        status: 400,
      }),
    );
    render(<RegisterForm turnstileSiteKey="site-key" />);
    await waitFor(() => expect(turnstileApi.render).toHaveBeenCalled());
    fill();
    act(() => (widgetOpts!.callback as (t: string) => void)("tok-1"));
    fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    await waitFor(() => expect(turnstileApi.reset).toHaveBeenCalledWith("w1"));
    expect(await screen.findByText("Doğrulamayı tamamlayın.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Hesap Oluştur/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("site anahtarı yoksa widget yok, istekte belirteç alanı yok", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ verifyEmail: true }), { status: 201 }));
    render(<RegisterForm />);
    expect(screen.queryByTestId("turnstile-box")).toBeNull();
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Hesap Oluştur/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect("turnstileToken" in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
    expect(turnstileApi.render).not.toHaveBeenCalled();
  });
});
