// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KURALI FORMU — kanıt modeli (09-24). Host rızası "temizlikçi çıkıştan önce hazır dediyse" kutusu:
// varsayılan KAPALI, mevcut kuraldan okunur, kayıtta gövdeye girer; personel (yönetici olmayan) değiştiremez.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/properties/p1" }));

import { EarlyCheckinRuleForm } from "@/components/properties/early-checkin-rule-form";

const RULE = { mode: "auto", earliest: "09:00", fee: null, note: null };

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

describe("EarlyCheckinRuleForm — 'çıkıştan önce hazır' rızası", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  it("varsayılan KAPALI; işaretlenip kaydedilince gövdede `readyBeforeCheckout: true`", async () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={RULE} autoActive />);
    const box = screen.getByLabelText(/Daire hazır/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[0])).toMatchObject({ readyBeforeCheckout: false });
    fireEvent.click(box);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[1])).toMatchObject({ mode: "auto", earliest: "09:00", readyBeforeCheckout: true });
  });

  it("mevcut kuraldaki rıza okunur; yönetici olmayan için kutu kilitli ve kaydet düğmesi yok", () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage={false} initial={{ ...RULE, readyBeforeCheckout: true }} autoActive />);
    const box = screen.getByLabelText(/Daire hazır/) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Kaydet/ })).toBeNull();
  });

  it("en erken saat 'otomatik onay' eşiği olarak adlandırılır ve daha erken isteğin REDDEDİLMEDİĞİ söylenir", () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={RULE} autoActive />);
    expect(screen.getByLabelText("Otomatik onay için en erken saat")).toBeTruthy();
    expect(screen.getByText("Bu saatten önceki istekler reddedilmez, size gelir. Misafire bu saat söylenmez.")).toBeTruthy();
  });
});
