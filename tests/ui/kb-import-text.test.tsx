// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// A5 — "Metinden bilgi çıkar" host akışı (09-08). DAVRANIŞSAL.
//
// Ölçülen şey: host metni yapıştırıp "Önizle" dediğinde HİÇBİR ŞEY KAYDEDİLMEZ;
// ne kaydedileceği ekranda görünür; yer tutuculu satır öneriye DÖNÜŞMEZ ama
// atlandığı SÖYLENİR; giriş/çıkış saati bilgi kaydı olarak EKLENMEZ (çift kopya
// yasağı); "Ekle" yalnız SEÇİLENLERİ mevcut `POST /api/kb` yolundan gönderir.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbImportText } from "@/components/knowledge/kb-import-text";
import { __resetToastsForTest } from "@/lib/toast";

const PROPS = [
  { id: "p1", name: "Daire 1" },
  { id: "p2", name: "Daire 2" },
];

const SAMPLE = [
  "Merhaba {isim}, hoş geldiniz!",
  "Çıkış saati 11:00'dir.",
  "Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.",
  "Otopark bina altındadır, ücretsizdir.",
].join("\n");

function openPanel() {
  render(<KbImportText properties={PROPS} />);
  fireEvent.click(screen.getByRole("button", { name: "Aç" }));
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText("Metin"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
}

function stubFetch(ok: boolean) {
  const fetchMock = vi.fn(async () => ({ ok, status: ok ? 201 : 400, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("A5 — metinden bilgi çıkarma akışı", () => {
  beforeEach(() => {
    cleanup();
    __resetToastsForTest();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("panel varsayılan KAPALI (sayfayı boğmaz)", () => {
    render(<KbImportText properties={PROPS} />);
    expect(screen.queryByLabelText("Metin")).toBeNull();
    expect(screen.getByRole("button", { name: "Aç" })).toBeTruthy();
  });

  it("ÖNİZLEME HİÇBİR ŞEY KAYDETMEZ (ağ çağrısı yok)", () => {
    const fetchMock = stubFetch(true);
    openPanel();
    paste(SAMPLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("önizleme neyin ekleneceğini GÖSTERİR (çöp + otopark)", () => {
    openPanel();
    paste(SAMPLE);
    expect(document.body.textContent).toContain("Çöp");
    expect(document.body.textContent).toContain("Otopark");
    expect(document.body.textContent).toContain("binanın yan sokağındaki konteynere");
  });

  it("🚨 YER TUTUCULU satır öneriye dönüşmez ama ATLANDIĞI söylenir", () => {
    openPanel();
    paste(SAMPLE);
    expect(document.body.textContent).toMatch(/1 satır atlandı/);
    // `{isim}` metni öneri gövdesinde DEĞİL, atlananlar listesinde geçer.
    const details = screen.getByText(/1 satır atlandı/).closest("details");
    expect(details?.textContent).toContain("{isim}");
  });

  it("🚨 ÇIKIŞ SAATİ bilgi kaydı olarak EKLENMEZ; ayrı kutuda gösterilir", () => {
    openPanel();
    paste(SAMPLE);
    expect(document.body.textContent).toMatch(/mülk ayarlarında tutulur/);
    expect(document.body.textContent).toContain("Çıkış saati");
    // Onay kutuları yalnız KB kalemleri için — saat için kutu YOK.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2); // çöp + otopark
  });

  it("'Ekle' yalnız SEÇİLİ kalemleri gönderir; seçim kaldırılan gitmez", async () => {
    const fetchMock = stubFetch(true);
    openPanel();
    paste(SAMPLE);
    // Otopark seçimini kaldır.
    fireEvent.click(screen.getByLabelText("Otopark bilgisini ekle"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Seçilenleri ekle/ }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.category).toBe("trash");
    expect(body.propertyId).toBe("p1");
  });

  it("seçilen mülke yazılır (varsayılan ilk mülk değil)", async () => {
    const fetchMock = stubFetch(true);
    openPanel();
    fireEvent.change(screen.getByLabelText("Mülk"), { target: { value: "p2" } });
    paste("Otopark bina altındadır.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Seçilenleri ekle/ }));
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.propertyId).toBe("p2");
  });

  it("mevcut `POST /api/kb` yolundan geçer (kaçış rotası açılmadı)", async () => {
    const fetchMock = stubFetch(true);
    openPanel();
    paste("Otopark bina altındadır.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Seçilenleri ekle/ }));
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/kb");
  });

  it("ROTA HATA dönerse 'eklendi' DENMEZ; hangisi eklenemedi söylenir", async () => {
    stubFetch(false);
    openPanel();
    paste("Otopark bina altındadır.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Seçilenleri ekle/ }));
    });
    expect(document.body.textContent).toMatch(/Eklenemedi: Otopark/);
    expect(screen.queryByRole("status")).toBeNull();
    // Metin TEMİZLENMEZ: host tekrar deneyebilsin.
    expect((screen.getByLabelText("Metin") as HTMLTextAreaElement).value).toContain("Otopark");
  });

  it("çıkarılabilir bilgi yoksa dürüstçe söylenir, boş öneri üretilmez", () => {
    openPanel();
    paste("Balkondaki bitkileri sulamanıza gerek yok.");
    expect(document.body.textContent).toMatch(/kaydedilebilir bir bilgi çıkaramadık/);
    expect(screen.queryByRole("button", { name: /Seçilenleri ekle/ })).toBeNull();
  });
});
