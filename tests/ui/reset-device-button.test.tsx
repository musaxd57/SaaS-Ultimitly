// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U1 (c) (kurucu 10-22): QR sohbet ekranında "Cihaz kilidini sıfırla". Önce onay (sıfırlamadan sonra karekodu ilk okutan cihaz bağlanır);
// "Vazgeç" istek göndermez; onaylanınca mülkün sıfırlama ucuna POST, sonuç duyurulur.
// ---------------------------------------------------------------------------

import { ResetDeviceButton } from "@/components/guest-chats/reset-device-button";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reset: 1 }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResetDeviceButton", () => {
  it("onay ister; Vazgeç istek göndermez ve odağı düğmeye geri verir", async () => {
    render(<ResetDeviceButton propertyId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Cihaz kilidini sıfırla/ }));
    expect(screen.getByRole("group", { name: /onayı/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Cihaz kilidini sıfırla"));
  });

  it("onaylanınca mülkün sıfırlama ucuna POST; 'Sıfırlandı' duyurulur", async () => {
    render(<ResetDeviceButton propertyId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Cihaz kilidini sıfırla/ }));
    fireEvent.click(screen.getByRole("button", { name: /Evet, sıfırla/ }));
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toMatch(/Sıfırlandı/);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/properties/p1/reset-chat");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("sunucu reddederse hata gösterilir, onay ekranı açık kalır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<ResetDeviceButton propertyId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Cihaz kilidini sıfırla/ }));
    fireEvent.click(screen.getByRole("button", { name: /Evet, sıfırla/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Evet, sıfırla/ })).toBeTruthy();
  });
});
