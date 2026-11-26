// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { RegisterForm } from "@/components/auth/register-form";
import { REGISTER_CONSENT_REQUIRED } from "@/lib/auth/register-messages";

// ---------------------------------------------------------------------------
// Kurucu 11-13 ("sözleşmelerin onaylandığı mı kabul edildiği mi — kelime seçimleri önemli, ceza yemeyelim"). Kayıt kutusu yalnız
// Kullanım Koşulları'nı (sözleşme) KABUL ettirir. Gizlilik Politikası bir aydınlatma metnidir: KVKK'ya göre aydınlatma onaya / kabule
// bağlanmaz ("okudum ve kabul ediyorum" aydınlatma için uygun değil) → kutunun DIŞINDA bilgi satırı. Araştırma:
// scratchpad/handoff/ODEME-ONAY-HUKUK.md satır 10 (KVKK Tebliğ md.5/1-f).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("Kayıt formu — onay metni", () => {
  it("tek kutu; etiketi yalnız Kullanım Koşulları'nı kabul ettirir, Gizlilik geçmez", () => {
    render(<RegisterForm />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    const label = boxes[0]!.closest("label")!;
    expect(label.textContent).toBe("Kullanım Koşulları'nı okudum ve kabul ediyorum.");
    expect(within(label).getByRole("link", { name: "Kullanım Koşulları" }).getAttribute("href")).toBe("/kosullar");
    expect(label.textContent).not.toMatch(/Gizlilik/);
  });

  it("Gizlilik Politikası kutunun DIŞINDA bilgi satırı olarak durur (kabul fiili yok)", () => {
    const { container } = render(<RegisterForm />);
    const notice = container.querySelector("[data-privacy-notice]")!;
    expect(notice).not.toBeNull();
    expect(notice.closest("label")).toBeNull();
    expect(notice.textContent).toBe("Kişisel verilerinizi nasıl işlediğimizi Gizlilik Politikası'nda anlattık.");
    expect(within(notice as HTMLElement).getByRole("link", { name: "Gizlilik Politikası" }).getAttribute("href")).toBe("/gizlilik");
    expect(notice.textContent).not.toMatch(/kabul|onay/i);
  });

  // FB gezisi 11-20 (axe `link-in-text-block`): cümle içindeki iki bağlantı yalnız renkle ayrılıyordu (altı çizgi yalnız üstüne gelince).
  it("sözleşme ve gizlilik bağlantıları cümle içinde altı çizili durur (yalnız renkle ayrılmaz)", () => {
    render(<RegisterForm />);
    for (const name of ["Kullanım Koşulları", "Gizlilik Politikası"]) {
      const cls = screen.getByRole("link", { name }).className.split(/\s+/);
      expect(cls, name).toContain("underline");
      expect(cls, name).not.toContain("hover:underline");
    }
  });

  it("kutu boşken çıkan uyarı da yalnız koşulları söyler", () => {
    expect(REGISTER_CONSENT_REQUIRED).toBe("Devam etmek için Kullanım Koşulları'nı kabul edin.");
  });
});
