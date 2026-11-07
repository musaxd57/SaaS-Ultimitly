// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LandingDemo } from "@/components/marketing/landing-demo";
import { LeadForm } from "@/components/marketing/lead-form";

// ---------------------------------------------------------------------------
// Tanıtım sayfası 320 px telefonda yana kaymaz (görsel inceleme 10-22, Chromium'da ölçüldü): satır içi esnek kutudaki metin alanının doğal en
// küçük genişliği ("Dene" düğmesi + telefon öneki yanında) sayfayı 370 / 328 px'e taşırıyordu. Esnek alan `min-w-0` ile daralabilir, düğme
// `shrink-0` ile ezilmez. Telefonda yazı 16 px: iOS 16 px altı alana odaklanınca sayfayı yakınlaştırır (paylaşılan `Input` ile aynı kural).
// jsdom düzen hesaplamaz — burada sınıf sözleşmesi pinlenir, genişlik ölçümü Playwright ile yapıldı (320 → scrollWidth 320).
// ---------------------------------------------------------------------------

afterEach(cleanup);

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe("tanıtım demosu", () => {
  it("mesaj alanı daralabilir, telefonda 16 px; Dene düğmesi ezilmez", () => {
    render(<LandingDemo />);
    const input = screen.getByPlaceholderText("Misafir mesajını yazın…");
    expect(classes(input)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "text-base", "sm:text-sm"]));
    expect(classes(input)).not.toContain("text-sm");
    expect(classes(screen.getByRole("button", { name: "Dene" }))).toContain("shrink-0");
  });
});

describe("iletişim formu", () => {
  it("telefon alanı daralabilir; telefon kutusu ve mesaj alanı telefonda 16 px", () => {
    render(<LeadForm />);
    const phone = screen.getByLabelText(/Telefon numaranız/);
    expect(classes(phone)).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
    // Alanın kendi yazı boyutu yok, kutudan devralır — alana `text-sm` eklenirse telefonda yeniden 14 px olur (Haiku 10-22).
    expect(classes(phone).some((c) => /^text-(xs|sm)$/.test(c))).toBe(false);
    expect(classes(phone.parentElement!)).toEqual(expect.arrayContaining(["text-base", "sm:text-sm"]));
    expect(classes(phone.parentElement!)).not.toContain("text-sm");
    const message = screen.getByLabelText("Mesajınız (opsiyonel)");
    expect(classes(message)).toEqual(expect.arrayContaining(["text-base", "sm:text-sm"]));
    expect(classes(message)).not.toContain("text-sm");
  });
});
