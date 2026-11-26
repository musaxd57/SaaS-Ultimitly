// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-17 H2 — "Daire Ayarları" formu açıldığı sürümü (`expectedUpdatedAt`) gönderir; 409'da yazılan kaybolmaz.
// Sürüm (`Property.updatedAt`) satırın TAMAMININ sürümüdür: aynı sayfadaki başka kartlar (malzeme profili, QR sohbet anahtarı…) da onu
// ilerletir. Sayfa yenilenip formun alanları AYNI kalmışsa (değişen formun göndermediği bir sütun) form yeni sürümü benimser — kendi
// sayfasındaki başka bir kaydetme sahte çatışma üretmez. Formun alanlarından biri değişmişse eski sürüm kalır: kayıt 409 alır.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { PropertyForm, type PropertyFormData } from "@/components/properties/property-form";
import { __resetToastsForTest } from "@/lib/toast";

const OPENED = "2026-03-04T05:06:07.891Z";
const property: PropertyFormData = {
  id: "p1",
  name: "Lale 5",
  address: "",
  city: "",
  country: "Türkiye",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  cleaningBufferMinutes: 120,
  notes: "",
  guestDisplayName: "",
  updatedAt: OPENED,
};

type Reply = { status: number; body: unknown };
let replies: Reply[];
const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const sentBody = (i: number) => JSON.parse(String((fetchMock().mock.calls[i]![1] as RequestInit).body));

beforeEach(() => {
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = replies.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
  __resetToastsForTest();
});

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Değişiklikleri Kaydet" }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
const renderForm = (p: PropertyFormData = property) => render(<PropertyForm mode="edit" property={p} />);

describe("mülk formu — sürüm ön şartı (H2)", () => {
  it("🚨 kayıt formun açıldığı sürümü gönderir; sürüm alanı form alanı gibi ayrıca gönderilmez", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "Yeni adres 5" } });
    await save();
    expect(fetchMock().mock.calls[0]![0]).toBe("/api/properties/p1");
    const body = sentBody(0);
    expect(body).toMatchObject({ address: "Yeni adres 5", checkOutTime: "11:00", expectedUpdatedAt: OPENED });
    expect(body).not.toHaveProperty("updatedAt");
  });

  it("🚨 409 → sunucunun metni görünür, yazılan kaybolmaz, sayfa yenilenmez", async () => {
    replies = [{ status: 409, body: { error: "arada değişti", fields: { _: "arada değişti" } } }];
    renderForm();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "Yeni adres 5" } });
    await save();
    expect(screen.getByText("arada değişti")).toBeTruthy();
    expect((screen.getByLabelText("Adres") as HTMLInputElement).value).toBe("Yeni adres 5");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("art arda iki kayıt: ikincisi ilk yanıtın sürümünü gönderir (kendi kaydına sahte çatışma yok)", async () => {
    const MINE = "2026-03-04T05:07:00.001Z";
    replies = [{ status: 200, body: { ...property, address: "A1", updatedAt: MINE } }, { status: 200, body: {} }];
    renderForm();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "A1" } });
    await save();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "A2" } });
    await save();
    expect(sentBody(1).expectedUpdatedAt).toBe(MINE);
  });

  it("🚨 sayfa yenilendi, formun alanları AYNI (malzeme profili / QR anahtarı kaydedildi) → yeni sürüm benimsenir", async () => {
    const view = renderForm();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "Yazıyorum" } });
    const OTHER_CARD = "2026-03-04T05:10:00.000Z";
    view.rerender(<PropertyForm mode="edit" property={{ ...property, updatedAt: OTHER_CARD }} />);
    // Yazılan taslak yenilemede kaybolmaz.
    expect((screen.getByLabelText("Adres") as HTMLInputElement).value).toBe("Yazıyorum");
    await save();
    expect(sentBody(0).expectedUpdatedAt).toBe(OTHER_CARD);
  });

  it("🚨 sayfa yenilendi, formun bir alanı DEĞİŞMİŞ (başkası çıkışı 12:00 yaptı) → eski sürüm kalır (kayıt 409 alacak)", async () => {
    const view = renderForm();
    view.rerender(<PropertyForm mode="edit" property={{ ...property, checkOutTime: "12:00", updatedAt: "2026-03-04T05:10:00.000Z" }} />);
    await save();
    expect(sentBody(0).expectedUpdatedAt).toBe(OPENED);
  });

  it("kendi kaydından sonra gelen yenileme (alanlar kaydedilen değerler) ardından başka kartın kaydı da benimsenir", async () => {
    const MINE = "2026-03-04T05:07:00.001Z";
    const LATER = "2026-03-04T05:20:00.000Z";
    replies = [{ status: 200, body: { ...property, address: "A1", updatedAt: MINE } }, { status: 200, body: {} }];
    const view = renderForm();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "A1" } });
    await save();
    view.rerender(<PropertyForm mode="edit" property={{ ...property, address: "A1", updatedAt: MINE }} />);
    view.rerender(<PropertyForm mode="edit" property={{ ...property, address: "A1", updatedAt: LATER }} />);
    await save();
    expect(sentBody(1).expectedUpdatedAt).toBe(LATER);
  });

  it("sunucu yanıtında boş alan null, sayfada \"\" — ikisi aynı sayılır (kendi kaydından sonra başka kartın kaydı benimsenir)", async () => {
    const MINE = "2026-03-04T05:07:00.001Z";
    const LATER = "2026-03-04T05:20:00.000Z";
    const serverRow = { ...property, address: null, city: null, notes: null, guestDisplayName: null, updatedAt: MINE };
    replies = [{ status: 200, body: serverRow }, { status: 200, body: {} }];
    const view = renderForm();
    await save();
    // Kendi kaydının yenilemesi atlanıp doğrudan başka kartın yenilemesi gelse de (alanlar aynı) yeni sürüm benimsenir.
    view.rerender(<PropertyForm mode="edit" property={{ ...property, updatedAt: LATER }} />);
    await save();
    expect(sentBody(1).expectedUpdatedAt).toBe(LATER);
  });

  it("KONTROL: yeni daire (POST) ön şart göndermez", async () => {
    replies = [{ status: 201, body: { id: "p2" } }];
    render(<PropertyForm mode="create" />);
    fireEvent.change(screen.getByLabelText("Daire adı"), { target: { value: "Lale 6" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daire Ekle" }));
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(fetchMock().mock.calls[0]![0]).toBe("/api/properties");
    expect(sentBody(0)).not.toHaveProperty("expectedUpdatedAt");
  });
});
