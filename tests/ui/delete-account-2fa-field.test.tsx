// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U11 (kurucu 10-22): 2FA açıksa silme kartı doğrulama kodu alanı gösterir ve kodu gönderir; sunucunun "kod hatalı" cevabı ekranda
// görünür. 2FA kapalıysa alan yok, istek eskisi gibi yalnız şifre.
// ---------------------------------------------------------------------------

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { DeleteAccountCard } from "@/components/settings/delete-account-card";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openCard() {
  fireEvent.click(screen.getByRole("button", { name: /Hesabımı kalıcı olarak sil/ }));
  fireEvent.change(screen.getByLabelText("Şifreniz"), { target: { value: "sifre" } });
}

describe("U11 — silme kartında 2FA kodu", () => {
  it("2FA açık: kod girilmeden düğme kapalı; kodla gönderilir", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<DeleteAccountCard twoFactorEnabled />);
    openCard();
    const confirm = screen.getByRole("button", { name: /Evet, kalıcı olarak sil/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Doğrulama kodu"), { target: { value: "123 456" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: "sifre", code: "123 456" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("sunucu 'kod hatalı' derse ekranda görünür", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ fields: { code: "Kod hatalı veya süresi geçmiş." } }), { status: 400 }),
    );
    render(<DeleteAccountCard twoFactorEnabled />);
    openCard();
    fireEvent.change(screen.getByLabelText("Doğrulama kodu"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Evet, kalıcı olarak sil/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Kod hatalı/);
    expect(push).not.toHaveBeenCalled();
  });

  it("2FA kapalı: kod alanı yok, istek yalnız şifre", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<DeleteAccountCard />);
    openCard();
    expect(screen.queryByLabelText("Doğrulama kodu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Evet, kalıcı olarak sil/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: "sifre" });
  });
});
