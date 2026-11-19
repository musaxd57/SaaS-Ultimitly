// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-17 H1 — şablon düzenleme formu açıldığı sürümü (`expectedUpdatedAt`) gönderir; sunucu "arada değişti" (409) derse form AÇIK
// kalır, yazılan kaybolmaz. Yeni şablon / varsayılandan uyarlama (POST) ön şart taşımaz.
// Kurucu 11-19 akşam madde 1: liste yalnız kısa önizleme taşır → "Düzenle" TAM metni ve sürümü `GET /api/templates/[id]`den alır; sürüm,
// formun doldurulduğu metinle AYNI okumadan gelir (her açılış taze okuma — kaydettikten sonra yeniden açılan şablon en son sürümü gönderir).
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));

import { TemplateManager } from "@/components/templates/template-manager";

const OPENED = "2026-03-04T05:06:07.891Z";
const row = {
  id: "tpl1",
  title: "Karşılama",
  preview: "Hoş geldiniz!",
  category: "general",
  language: "tr",
  isActive: true,
  propertyName: null,
  propertyId: null,
};
const detail = (over: Record<string, unknown> = {}) => ({
  id: "tpl1",
  title: "Karşılama",
  body: "Hoş geldiniz! Bu TAM metindir, önizlemede yoktu.",
  category: "general",
  language: "tr",
  isActive: true,
  isDefault: false,
  propertyId: null,
  updatedAt: OPENED,
  ...over,
});

type Reply = { status: number; body: unknown };
let replies: Reply[];
const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const callUrl = (i: number) => String(fetchMock().mock.calls[i]![0]);
const callInit = (i: number) => fetchMock().mock.calls[i]![1] as RequestInit | undefined;
const sentBody = (i: number) => JSON.parse(String(callInit(i)!.body));

beforeEach(() => {
  replies = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
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
  toastError.mockReset();
});

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
const renderManager = () => render(<TemplateManager properties={[]} customTemplates={[row]} defaultTemplates={[]} />);

describe("şablon düzenleme — tam metin ayrı okumadan, sürüm ön şartı (H1)", () => {
  it("🚨 'Düzenle' TAM metni GET [id]'den alır; PATCH o okumanın sürümünü gönderir", async () => {
    replies = [{ status: 200, body: detail() }];
    renderManager();
    await click("Düzenle");
    expect(callUrl(0)).toBe("/api/templates/tpl1");
    expect(callInit(0)?.method ?? "GET").toBe("GET");
    expect((screen.getByLabelText("Şablon metni") as HTMLTextAreaElement).value).toBe("Hoş geldiniz! Bu TAM metindir, önizlemede yoktu.");
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Karşılama mesajı" } });
    await click("Kaydet");
    expect(callUrl(1)).toBe("/api/templates/tpl1");
    expect(callInit(1)?.method).toBe("PATCH");
    expect(sentBody(1)).toMatchObject({
      title: "Karşılama mesajı",
      body: "Hoş geldiniz! Bu TAM metindir, önizlemede yoktu.",
      expectedUpdatedAt: OPENED,
    });
  });

  it("🚨 409 → sunucunun metni görünür, form açık kalır ve yazılan kaybolmaz; liste yenilenmez", async () => {
    replies = [{ status: 200, body: detail() }, { status: 409, body: { error: "arada değişti", fields: { _: "arada değişti" } } }];
    renderManager();
    await click("Düzenle");
    fireEvent.change(screen.getByLabelText("Şablon metni"), { target: { value: "Benim yeni metnim" } });
    await click("Kaydet");
    expect(screen.getByText("arada değişti")).toBeTruthy();
    expect((screen.getByLabelText("Şablon metni") as HTMLTextAreaElement).value).toBe("Benim yeni metnim");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("kaydettikten sonra (liste henüz yenilenmeden) yeniden açılan şablon TAZE okumanın sürümünü gönderir", async () => {
    const NEWER = "2026-03-04T05:07:00.001Z";
    replies = [
      { status: 200, body: detail() },
      { status: 200, body: { ...detail(), updatedAt: NEWER } },
      { status: 200, body: detail({ title: "Başkasının başlığı", updatedAt: NEWER }) },
      { status: 200, body: {} },
    ];
    renderManager();
    await click("Düzenle");
    await click("Kaydet");
    await click("Düzenle");
    expect(callUrl(2)).toBe("/api/templates/tpl1");
    expect((screen.getByLabelText("Başlık") as HTMLInputElement).value).toBe("Başkasının başlığı");
    await click("Kaydet");
    expect(sentBody(3).expectedUpdatedAt).toBe(NEWER);
  });

  it("tam metin okunamazsa form AÇILMAZ, sebep duyurulur; şablon silinmişse (404) liste yenilenir", async () => {
    replies = [{ status: 404, body: { error: "Bu kayıt bulunamadı." } }];
    renderManager();
    await click("Düzenle");
    expect(screen.queryByLabelText("Şablon metni")).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Bu kayıt bulunamadı.");
    expect(refresh).toHaveBeenCalled();
  });

  it("ağ hatasında form açılmaz, bağlantı metni duyurulur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    renderManager();
    await click("Düzenle");
    expect(screen.queryByLabelText("Şablon metni")).toBeNull();
    expect(toastError).toHaveBeenCalledWith("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
  });

  it("KONTROL: yeni şablon (POST) ön şart göndermez ve tam metin okuması yapmaz", async () => {
    replies = [{ status: 201, body: { id: "tpl2" } }];
    renderManager();
    await click("Yeni Şablon");
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Yeni" } });
    fireEvent.change(screen.getByLabelText("Şablon metni"), { target: { value: "Yeni metin" } });
    await click("Oluştur");
    expect(fetchMock().mock.calls).toHaveLength(1);
    expect(callUrl(0)).toBe("/api/templates");
    expect(sentBody(0)).not.toHaveProperty("expectedUpdatedAt");
  });

  it("ekleme sınırı iletisi formda görünür, form açık kalır (sunucunun 400 alan iletisi)", async () => {
    const msg = "Özel şablon sınırına ulaştınız (500 şablon). Yeni şablon eklemek için kullanmadığınız bir şablonu silin.";
    replies = [{ status: 400, body: { error: "Doğrulama hatası", fields: { _: msg } } }];
    renderManager();
    await click("Yeni Şablon");
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Yeni" } });
    fireEvent.change(screen.getByLabelText("Şablon metni"), { target: { value: "Yeni metin" } });
    await click("Oluştur");
    expect(screen.getByText(msg)).toBeTruthy();
    expect((screen.getByLabelText("Şablon metni") as HTMLTextAreaElement).value).toBe("Yeni metin");
    expect(refresh).not.toHaveBeenCalled();
  });
});
