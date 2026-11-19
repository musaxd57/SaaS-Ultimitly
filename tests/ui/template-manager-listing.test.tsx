// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// ŞABLONLAR SAYFASI — sunucu sayfası (kurucu 11-19 akşam madde 1): liste en çok 30 satır taşır; arama ve sayfa adreste (`?q=…&sayfa=N`,
// gelen kutusu kalıbı, ortak `Pager`). Başlıktaki sayı işletmenin TOPLAM özel şablonudur (sayfadaki satır sayısı değil). Satırda yalnız
// kısa önizleme.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { TemplateManager } from "@/components/templates/template-manager";

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${offset + i}`,
    title: `Şablon ${offset + i}`,
    preview: `Önizleme ${offset + i}…`,
    category: "general",
    language: "tr",
    isActive: true,
    propertyName: null,
    propertyId: null,
  }));

afterEach(() => cleanup());

const hrefOf = (name: string) => screen.getAllByRole("link", { name }).map((a) => a.getAttribute("href"));

describe("şablonlar sayfası — sayfalama ve arama", () => {
  it("🚨 başlık TOPLAMI gösterir; çok sayfada özet + Önceki / Sonraki bağlantıları sayfa numarasını taşır", () => {
    render(
      <TemplateManager
        properties={[]}
        customTemplates={rows(30, 30)}
        totalCount={65}
        listing={{ query: "", page: 2, pageSize: 30, matchCount: 65 }}
        defaultTemplates={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Özel Şablonlar (65)" })).toBeTruthy();
    expect(screen.getAllByText("65 şablondan 31–60 arası · Sayfa 2 / 3").length).toBeGreaterThan(0);
    expect(hrefOf("Önceki")[0]).toBe("/templates");
    expect(hrefOf("Sonraki")[0]).toBe("/templates?sayfa=3");
    expect(screen.getByText("Önizleme 30…")).toBeTruthy();
  });

  it("arama sayfalaması aramayı korur; arama kutusu dolu gelir, temizle bağlantısı var", () => {
    render(
      <TemplateManager
        properties={[]}
        customTemplates={rows(30)}
        totalCount={640}
        listing={{ query: "otopark", page: 1, pageSize: 30, matchCount: 45 }}
        defaultTemplates={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Özel Şablonlar (640)" })).toBeTruthy();
    expect((screen.getByLabelText("Şablonlarda ara") as HTMLInputElement).value).toBe("otopark");
    expect(hrefOf("Sonraki")[0]).toBe("/templates?q=otopark&sayfa=2");
    expect(screen.getByRole("link", { name: "Aramayı temizle" }).getAttribute("href")).toBe("/templates");
  });

  it("aramada sonuç yoksa 'şablon yok' DEĞİL, aramayla eşleşen yok der", () => {
    render(
      <TemplateManager
        properties={[]}
        customTemplates={[]}
        totalCount={5}
        listing={{ query: "otopark", page: 1, pageSize: 30, matchCount: 0 }}
        defaultTemplates={[]}
      />,
    );
    expect(screen.getByText("“otopark” ile eşleşen şablon bulunamadı.")).toBeTruthy();
    expect(screen.queryByText(/Henüz özel şablon oluşturulmadı/)).toBeNull();
  });

  it("KONTROL: hiç şablon yoksa bugünkü boş durum; arama kutusu ve sayfalama yok", () => {
    render(<TemplateManager properties={[]} customTemplates={[]} totalCount={0} defaultTemplates={[]} />);
    expect(screen.getByText(/Henüz özel şablon oluşturulmadı/)).toBeTruthy();
    expect(screen.queryByLabelText("Şablonlarda ara")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sonraki" })).toBeNull();
  });

  it("KONTROL: tek sayfalık aramasız listede sayfalama basılmaz", () => {
    render(
      <TemplateManager
        properties={[]}
        customTemplates={rows(4)}
        totalCount={4}
        listing={{ query: "", page: 1, pageSize: 30, matchCount: 4 }}
        defaultTemplates={[]}
      />,
    );
    expect(screen.queryByText(/şablondan/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Sonraki" })).toBeNull();
    expect(screen.getByLabelText("Şablonlarda ara")).toBeTruthy();
  });
});
