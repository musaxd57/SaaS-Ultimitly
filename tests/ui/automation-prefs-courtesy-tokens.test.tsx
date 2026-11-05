// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";

// Tur 7 (kurucu onayı 11-05): ev sahibi desteklenmeyen alanı YAZARKEN görür; kayıt engellenir (sunucu da aynı kuralla reddeder).
const PROPS = { disclosure: true, holdHours: 12, closingReply: true, closingText: "", lateCheckoutOffer: "", taskFromMessage: false, supplyRequest: false };

describe("Ayarlar — nezaket metninde desteklenmeyen alan", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })));
  afterEach(() => cleanup());

  it("🚨 [ADRES] yazılınca uyarı görünür ve Kaydet kapalı; düzeltilince açılır", () => {
    render(<AutomationPrefsForm {...PROPS} />);
    const box = screen.getByLabelText(/Nezaket yanıtı metni/i);
    fireEvent.change(box, { target: { value: "Rica ederiz! Adres: [ADRES]" } });
    expect(screen.getByText("[ADRES] desteklenmiyor. Kullanılabilir alanlar: {isim}, {daire}.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Kaydet/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Rica ederiz {isim}!" } });
    expect(screen.queryByText(/desteklenmiyor/)).toBeNull();
    expect((screen.getByRole("button", { name: /Kaydet/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
