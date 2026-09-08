// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// A3 + A4 — "Kurulum ve eksikler" host görünümü (09-08).
//
// Ölçülen şey ÜRÜN DAVRANIŞI: host eksik bir konuya tıklayınca form GERÇEKTEN
// doluyor mu, ve "ekleme çözmez" sınıflarında düğme GÖRÜNMÜYOR mu.
//
// 🚨 İki sınıfta düğme YOK, bilinçli:
//  · `ungrounded`        — kayıt vardı, modele gitti, cevap ona dayanmadı.
//    Yeni kayıt eklemek YANLIŞ cevaptır.
//  · `awaiting_approval` — kayıt yazılmış, onay bekliyor. "Ekle" demek host'a
//    zaten yazdığını yeniden yazdırmak olurdu.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbGapsPanel, type KbGapView } from "@/components/knowledge/kb-gaps-panel";
import { KbManager } from "@/components/knowledge/kb-manager";

const PROPS = [
  { id: "p1", name: "Daire 1" },
  { id: "p2", name: "Daire 2" },
];

function gap(over: Partial<KbGapView> = {}): KbGapView {
  return {
    propertyId: "p1",
    propertyName: "Daire 1",
    kind: "setup",
    category: "wifi",
    questionCount: 0,
    label: "absent",
    reviewCandidate: true,
    ...over,
  };
}

describe("A3/A4 — Kurulum ve eksikler paneli", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("eksik yoksa panel HİÇ çizilmez (boş kutu gösterilmez)", () => {
    const { container } = render(<KbGapsPanel gaps={[]} onFill={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("başlık KESİN TESPİT değil, İNCELEME ADAYI der", () => {
    render(<KbGapsPanel gaps={[gap()]} onFill={() => {}} />);
    expect(screen.getByText(/Kurulum ve eksikler/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/İnceleme adayları — kesin tespit değil/);
  });

  it("SORULAN eksik soru sayısını ve mülkü gösterir", () => {
    render(
      <KbGapsPanel
        gaps={[gap({ kind: "asked", category: "location", questionCount: 7, propertyName: "Daire 2" })]}
        onFill={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("Konum");
    expect(document.body.textContent).toContain("Daire 2");
    expect(document.body.textContent).toContain("7 soru");
    expect(document.body.textContent).toMatch(/son 90 günde 7 kez sordu/);
  });

  it("'ungrounded' satırında EKLEME DÜĞMESİ YOK ve neden açıklanır", () => {
    render(
      <KbGapsPanel
        gaps={[gap({ kind: "asked", category: "location", questionCount: 4, label: "ungrounded", reviewCandidate: false })]}
        onFill={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /Şablonla doldur/ })).toBeNull();
    expect(document.body.textContent).toMatch(/Yeni kayıt eklemek bunu çözmeyebilir/);
  });

  it("'awaiting_approval' satırında da düğme YOK; onay beklediği söylenir", () => {
    render(
      <KbGapsPanel gaps={[gap({ label: "awaiting_approval", reviewCandidate: false })]} onFill={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /Şablonla doldur/ })).toBeNull();
    expect(document.body.textContent).toMatch(/onayınızı bekliyor/);
  });

  it("düğme mülk ve kategoriyi çağırana AYNEN geçirir", () => {
    const onFill = vi.fn();
    render(<KbGapsPanel gaps={[gap({ propertyId: "p2", category: "parking" })]} onFill={onFill} />);
    fireEvent.click(screen.getByRole("button", { name: /Şablonla doldur/ }));
    expect(onFill).toHaveBeenCalledWith("p2", "parking");
  });

  it("uzun listede taşan satır sayısı SÖYLENİR (sessizce kırpılmaz)", () => {
    const many = Array.from({ length: 12 }, (_, i) => gap({ category: `c${i}` }));
    render(<KbGapsPanel gaps={many} onFill={() => {}} />);
    expect(document.body.textContent).toMatch(/\+4 konu daha/);
  });
});

describe("A4 — eksikten forma tek tıkla (KbManager entegrasyonu)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("'Şablonla doldur' formu GERÇEKTEN doldurur: mülk + kategori + şablon metni", () => {
    render(
      <KbManager
        properties={PROPS}
        items={[]}
        gaps={[{ propertyId: "p2", propertyName: "Daire 2", kind: "setup", category: "parking", questionCount: 0, label: "absent", reviewCandidate: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Şablonla doldur/ }));

    // Mülk: eksiğin mülkü seçilir (varsayılan ilk mülk DEĞİL).
    expect((screen.getByLabelText("Mülk") as HTMLSelectElement).value).toBe("p2");
    expect((screen.getByLabelText("Kategori") as HTMLSelectElement).value).toBe("parking");
    expect((screen.getByLabelText("Başlık") as HTMLInputElement).value).toBe("Otopark");
    // Şablon metni yer tutucularıyla gelir — host kendi gerçeğini yazacak.
    expect((screen.getByLabelText("İçerik") as HTMLTextAreaElement).value).toMatch(/\[/);
  });

  it("ŞABLONU OLMAYAN kategoride yalnız mülk+kategori seçilir, içerik UYDURULMAZ", () => {
    render(
      <KbManager
        properties={PROPS}
        items={[]}
        gaps={[{ propertyId: "p1", propertyName: "Daire 1", kind: "asked", category: "location", questionCount: 5, label: "absent", reviewCandidate: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Şablonla doldur/ }));
    expect((screen.getByLabelText("Kategori") as HTMLSelectElement).value).toBe("location");
    // İçerik BOŞ kalır: "Konum" için şablon yok ve uydurma metin yazmak, host'un
    // kendi gerçeği yerine bizim tahminimizi kaydettirme riski demektir.
    expect((screen.getByLabelText("İçerik") as HTMLTextAreaElement).value).toBe("");
  });

  it("tıklama HİÇBİR ŞEY KAYDETMEZ (ağ çağrısı yok)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <KbManager
        properties={PROPS}
        items={[]}
        gaps={[{ propertyId: "p1", propertyName: "Daire 1", kind: "setup", category: "wifi", questionCount: 0, label: "absent", reviewCandidate: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Şablonla doldur/ }));
    // "Host onayından önce aktifleşmesin" şartının UI karşılığı: doldurur, kaydetmez.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("panel eksik yokken KbManager'ı bozmaz (form yerinde)", () => {
    render(<KbManager properties={PROPS} items={[]} />);
    expect(screen.getByLabelText("Başlık")).toBeTruthy();
    expect(screen.queryByText(/Kurulum ve eksikler/)).toBeNull();
  });

  it("panelde her mülk kendi adıyla görünür (mülkler karışmaz)", () => {
    render(
      <KbGapsPanel
        gaps={[
          gap({ propertyId: "p1", propertyName: "Daire 1", category: "wifi" }),
          gap({ propertyId: "p2", propertyName: "Daire 2", category: "wifi" }),
        ]}
        onFill={() => {}}
      />,
    );
    const rows = screen.getAllByText("Wi-Fi").map((el) => el.closest("div.rounded-lg") as HTMLElement);
    expect(within(rows[0]).getByText("Daire 1")).toBeTruthy();
    expect(within(rows[1]).getByText("Daire 2")).toBeTruthy();
  });
});
