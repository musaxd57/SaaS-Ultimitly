// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// "ŞABLONLARINIZDAN" KARTI — BOŞ SONUÇ EKRANI İŞGAL ETMEZ (kurucu 09-11).
//
// 🚨 ÖLÇÜLEN KUSUR (kurucunun canlı ekran görüntüsü): host "Tara"ya basıyor,
// sonuç YOK, ve kart TAM BOY kalıyor — başlık + açıklama paragrafı + iki
// satırlık "bulunamadı" metni. Bilgi Tabanı sayfasının üst yarısını hiçbir şey
// sunmayan bir kutu kaplıyordu. Kurucu: "tara dedikten sonra otomatik kapansın,
// sonrasında kapatılabilsin".
//
// SÖZLEŞME (bu dosya PİNLER):
//  1. Sonuç 0 ise kart TEK SATIRA iner — başlık ve açıklama paragrafı GİDER.
//  2. O satırda hem "Yeniden tara" hem KAPAT bulunur.
//  3. Kapatınca bileşen HİÇBİR ŞEY çizmez.
//  4. Sonuç VARSA kart tam hâlinde kalır (aşırı uygulama kontrolü) — öneri
//     satırı ve "Bilgi tabanına ekle" düğmesi görünür.
//
// ⚠️ Kapatma OTURUMLUKTUR (kalıcı tercih ayrı bir karar — AI öneri panelinin
// aynı kararı, CLAUDE.md). Bu dosya kalıcılık İDDİA ETMEZ.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/knowledge" }));

import { KbTemplateSuggestions } from "@/components/knowledge/kb-template-suggestions";

const ROW = {
  sourceTemplateId: "t1",
  propertyId: "p1",
  propertyName: "Lale 1",
  category: "wifi",
  title: "Wi-Fi bilgisi",
  content: "Ağ adı Lale-Misafir, şifre girişte kapının yanındaki kartta yazıyor.",
  language: "tr",
  fromOrgWide: false,
};

function mockScan(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ fromTemplates: rows }) }) as unknown as Response),
  );
}

beforeEach(() => {
  router.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Şablonlarınızdan kartı — boş sonuç", () => {
  it("🚨 sonuç YOKSA kart tek satıra iner (başlık ve açıklama paragrafı GİDER)", async () => {
    mockScan([]);
    render(<KbTemplateSuggestions />);
    // Tarama öncesi: tam kart.
    expect(screen.getByText("Şablonlarınızdan")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Tara$/ }));

    await waitFor(() => expect(screen.queryByText("Şablonlarınızdan")).toBeNull());
    // Açıklama paragrafı da gitmeli — host zaten "Tara"ya bastı ve cevabı aldı.
    expect(screen.queryByText(/asistan onları göremez/)).toBeNull();
    expect(screen.getByText(/eklenebilecek yeni metin yok/i)).toBeTruthy();
  });

  it("tek satırda hem yeniden tarama hem KAPATMA var", async () => {
    mockScan([]);
    render(<KbTemplateSuggestions />);
    await userEvent.click(screen.getByRole("button", { name: /^Tara$/ }));
    await waitFor(() => expect(screen.getByText(/eklenebilecek yeni metin yok/i)).toBeTruthy());

    expect(screen.getByRole("button", { name: /Yeniden tara/ })).toBeTruthy();
    const close = screen.getByRole("button", { name: /Bu kartı kapat/ });
    await userEvent.click(close);
    // Kapatınca HİÇBİR ŞEY kalmaz — "biraz daha küçüldü" yetmez.
    await waitFor(() => expect(screen.queryByText(/eklenebilecek yeni metin yok/i)).toBeNull());
    expect(screen.queryByRole("button", { name: /Yeniden tara/ })).toBeNull();
  });

  it("AŞIRI UYGULAMA KONTROLÜ — sonuç VARSA kart tam hâlinde kalır", async () => {
    mockScan([ROW]);
    render(<KbTemplateSuggestions />);
    await userEvent.click(screen.getByRole("button", { name: /^Tara$/ }));

    await waitFor(() => expect(screen.getByText(ROW.content)).toBeTruthy());
    // Başlık ve açıklama YERİNDE: boş-durum yolu buraya sızmamalı.
    expect(screen.getByText("Şablonlarınızdan")).toBeTruthy();
    expect(screen.getByText(/asistan onları göremez/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bilgi tabanına ekle/ })).toBeTruthy();

    // 🚨 DOLU KARTTA DA KAPATMA ÇALIŞIR — mutasyon M3b bunu YAKALAYAMIYORDU:
    // düğmenin VARLIĞINI iddia etmek yetmez, `onClick` silinse test yine yeşil
    // kalırdı. Tıklama sonrası kart TAMAMEN gitmeli.
    await userEvent.click(screen.getByRole("button", { name: /Bu kartı kapat/ }));
    await waitFor(() => expect(screen.queryByText("Şablonlarınızdan")).toBeNull());
    expect(screen.queryByText(ROW.content)).toBeNull();
  });
});
