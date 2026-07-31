// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LeadForm, normalizeTrPhone } from "@/components/marketing/lead-form";

// ---------------------------------------------------------------------------
// DEMO FORMU — sınırlar ve biçim (kullanıcı kararı, 2026-07-31).
//
// Serbest metin alanının ne `maxLength`'i ne sayacı ne de `resize` kısıtı vardı:
// köşesinden çekilip büyütülebiliyor, sınırsız metin yazılınca kaydırma çubuklu
// bir kutuya dönüşüyordu. Telefon alanı da boştu; müşterilerin tamamı Türkiye'de
// olduğu için ülke kodu artık alanın İÇİNDE sabit duruyor.
//
// Bu dosya iki şeyi pinler: tavan GERÇEKTEN uygulanıyor mu, ve boş telefon
// alanı sahte bir "+90" kaydı üretiyor mu.
// ---------------------------------------------------------------------------

const MESSAGE_MAX = 400;

function fetchMock() {
  const spy = vi.fn(
    async (...args: [unknown, RequestInit?]) =>
      // args okunuyor: gönderilen gövdeyi assert etmek için gerekiyor.
      new Response(JSON.stringify({ ok: true, received: args.length }), { status: 200 }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function fill() {
  fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Musa" } });
  fireEvent.change(screen.getByLabelText("E-posta adresiniz"), {
    target: { value: "musa@example.com" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("demo formu — serbest metin sınırı", () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());

  it("metin alanı SABİT boyutta — köşeden büyütülemez", () => {
    render(<LeadForm />);
    const box = screen.getByLabelText("Mesajınız (opsiyonel)");
    expect(box.className).toContain("resize-none");
  });

  it("karakter tavanı hem maxLength hem de yazarken uygulanıyor", () => {
    render(<LeadForm />);
    const box = screen.getByLabelText("Mesajınız (opsiyonel)") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(MESSAGE_MAX);

    // Yapıştırma yolu: `maxLength` jsdom'da programatik değişimi kesmez, o yüzden
    // bileşenin KENDİSİ de kesmeli — aksi hâlde yapıştırılan 5.000 karakter
    // ekranda durur ve ancak sunucu reddedince öğrenilirdi.
    fireEvent.change(box, { target: { value: "v".repeat(5_000) } });
    expect(box.value.length).toBe(MESSAGE_MAX);
  });

  it("sayaç yalnız sona yaklaşınca görünür (boş formda gürültü yok)", () => {
    render(<LeadForm />);
    const box = screen.getByLabelText("Mesajınız (opsiyonel)");
    expect(screen.queryByText(new RegExp(`/ ${MESSAGE_MAX}`))).toBeNull();

    fireEvent.change(box, { target: { value: "x".repeat(MESSAGE_MAX - 10) } });
    expect(screen.getByText(`${MESSAGE_MAX - 10} / ${MESSAGE_MAX}`)).toBeTruthy();
  });

  it("yer tutucu ne yazılacağını SÖYLÜYOR (eski metin 'ne zaman başlamak' garipti)", () => {
    render(<LeadForm />);
    const box = screen.getByLabelText("Mesajınız (opsiyonel)") as HTMLTextAreaElement;
    expect(box.placeholder).toContain("Kaç daireniz var");
    expect(box.placeholder).toContain("Airbnb");
    expect(box.placeholder).not.toContain("ne zaman başlamak");
  });
});

describe("demo formu — telefon ülke kodu", () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());

  it("+90 alanın içinde SABİT duruyor ve yazılan değere karışmıyor", () => {
    render(<LeadForm />);
    expect(screen.getByText("+90")).toBeTruthy();
    const phone = screen.getByLabelText(
      "Telefon numaranız (ülke kodu +90, opsiyonel)",
    ) as HTMLInputElement;
    expect(phone.value).toBe(""); // önek state'e SIZMAZ
    expect(phone.type).toBe("tel");
  });

  it("telefon BOŞ bırakılırsa sunucuya '+90' gönderilmez (sahte kayıt yok)", async () => {
    const spy = fetchMock();
    render(<LeadForm />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: /demo iste/i }).closest("form")!);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());

    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.phone).toBe("");
  });

  it("telefon yazılırsa ülke koduyla BİRLEŞTİRİLİP gönderilir", async () => {
    const spy = fetchMock();
    render(<LeadForm />);
    fill();
    fireEvent.change(screen.getByLabelText("Telefon numaranız (ülke kodu +90, opsiyonel)"), {
      target: { value: "532 123 45 67" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /demo iste/i }).closest("form")!);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());

    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.phone).toBe("+90 5321234567");
  });
});

// ---------------------------------------------------------------------------
// SABİT ÖNEK TEK BAŞINA YETMİYOR (denetim yakaladı — öneği eklerken açılan hata).
//
// Türk kullanıcı refleksle "0532 ..." yazar; ham metni öneğe eklemek
// "+90 0532 ..." üretiyordu. O numara geçersizdir ve operatör panelindeki
// WhatsApp bağlantısı (wa.me/<rakamlar>) ölü adrese gider → gelen lead HİÇ
// ARANAMAZ. Yapıştırılan +90 / 90 / 0090 önekleri de ikilenirdi.
// ---------------------------------------------------------------------------
describe("telefon normalleştirme", () => {
  it("baştaki 0 kırpılır (en yaygın yazım)", () => {
    expect(normalizeTrPhone("0532 123 45 67")).toBe("+90 5321234567");
  });

  it("yapıştırılan +90 / 90 / 0090 önekleri İKİLENMEZ", () => {
    expect(normalizeTrPhone("+90 532 123 45 67")).toBe("+90 5321234567");
    expect(normalizeTrPhone("90 532 123 45 67")).toBe("+90 5321234567");
    expect(normalizeTrPhone("0090 532 123 45 67")).toBe("+90 5321234567");
  });

  it("boşluk/tire/parantez temizlenir", () => {
    expect(normalizeTrPhone("(0532) 123-45-67")).toBe("+90 5321234567");
  });

  it("rakam yoksa BOŞ döner (sahte '+90' kaydı yok)", () => {
    expect(normalizeTrPhone("")).toBe("");
    expect(normalizeTrPhone("   ")).toBe("");
    expect(normalizeTrPhone("abc")).toBe("");
  });

  it("kısa/eksik numara da geçer — burada doğrulama değil TEMİZLİK yapıyoruz", () => {
    // Amaç adayı reddetmek değil: satış ekibi arayacak. Yanlış numarayı
    // düzeltmek, geçerli numarayı reddetmekten daha değerli.
    expect(normalizeTrPhone("532")).toBe("+90 532");
  });
});
