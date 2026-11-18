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

  // Pilot (kurucu 11-18 akşam, H-3): son karar payı kural alanı + "ücret yazılıyken onay kendiliğinden gitmez" açıklaması.
  it("son karar payı: yalnız 'otomatik' kipte sorulur; varsayılan 'Sınır yok' → gövdede null; seçilince dakika olarak gider", async () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={RULE} autoActive />);
    const select = screen.getByLabelText("Otomatik onay en geç ne zaman verilsin?") as HTMLSelectElement;
    expect(select.value).toBe("");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[0]).decisionLeadMinutes).toBeNull();
    fireEvent.change(select, { target: { value: "30" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[1]).decisionLeadMinutes).toBe(30);
    cleanup();
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={{ ...RULE, mode: "draft" }} autoActive />);
    expect(screen.queryByLabelText("Otomatik onay en geç ne zaman verilsin?")).toBeNull();
  });

  it("🚨 kayıtlı pay okunur; listede olmayan değer (45) de seçenek olur ve kayıtta SİLİNMEZ", async () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={{ ...RULE, decisionLeadMinutes: 45 }} autoActive />);
    const select = screen.getByLabelText("Otomatik onay en geç ne zaman verilsin?") as HTMLSelectElement;
    expect(select.value).toBe("45");
    expect([...select.options].map((o) => o.value)).toEqual(["", "15", "30", "45", "60"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[0]).decisionLeadMinutes).toBe(45);
  });

  it("ücret açıklaması yalnız pilot anahtarı açıkken, otomatik kipte ve ücret yazılıyken görünür", () => {
    const withFee = { ...RULE, fee: { amount: 30, currency: "EUR" } };
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={withFee} autoActive freeOnlyAuto />);
    expect(screen.getByTestId("eci-fee-no-auto").textContent).toBe("Ücret yazılıyken onay kendiliğinden gönderilmez; hazır cevap size gelir, siz gönderirsiniz.");
    cleanup();
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={withFee} autoActive />);
    expect(screen.queryByTestId("eci-fee-no-auto")).toBeNull(); // anahtar kapalı
    cleanup();
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={RULE} autoActive freeOnlyAuto />);
    expect(screen.queryByTestId("eci-fee-no-auto")).toBeNull(); // ücret yok
    cleanup();
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={{ ...withFee, mode: "draft" }} autoActive freeOnlyAuto />);
    expect(screen.queryByTestId("eci-fee-no-auto")).toBeNull(); // taslak kipinde onay zaten kendiliğinden gitmez
  });

  it("en erken saat 'otomatik onay' eşiği olarak adlandırılır ve daha erken isteğin REDDEDİLMEDİĞİ söylenir", () => {
    render(<EarlyCheckinRuleForm propertyId="p1" canManage initial={RULE} autoActive />);
    expect(screen.getByLabelText("Otomatik onay için en erken saat")).toBeTruthy();
    expect(screen.getByText("Bu saatten önceki istekler reddedilmez, size gelir. Misafire bu saat söylenmez.")).toBeTruthy();
  });
});
