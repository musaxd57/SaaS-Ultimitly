// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "İç notlar" kartı (dilim D1): ekle → istek (konuşma kimliği + metin + istek kimliği) → liste yenilenir, metin temizlenir; yeniden deneme
// AYNI kimliği taşır, metin değişince yeni kimlik; "Sil" yalnız yetkili satırda; bürünmede ekleme / silme yok. Metinler AYNEN görev metnidir.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));

import { InternalNotesCard, type InternalNoteRow } from "@/components/inbox/internal-notes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.refresh.mockClear();
  toastError.mockClear();
});

const mine: InternalNoteRow = { id: "n1", body: "Telefonla aradı.\nYarın gelecek.", authorName: "Ayşe", createdLabel: "18 Kas 14:05", canDelete: true };
const theirs: InternalNoteRow = { id: "n2", body: "Kapıda söylendi.", authorName: "Mert", createdLabel: "18 Kas 12:00", canDelete: false };

type FetchCall = [string, RequestInit?];
function stubFetch(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  const fn = vi.fn(async (..._a: FetchCall) => {
    const r = responses.shift() ?? { ok: true, status: 201, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const textarea = () => screen.getByLabelText("İç not ekle") as HTMLTextAreaElement;
const typeText = (v: string) => fireEvent.change(textarea(), { target: { value: v } });
const save = () =>
  act(async () => {
    fireEvent.click(screen.getByText("Kaydet"));
  });

describe("InternalNotesCard", () => {
  it("başlık, alt satır, boş durum, yer tutucu — görev metinleri AYNEN", () => {
    render(<InternalNotesCard conversationId="c1" notes={[]} readOnly={false} />);
    expect(screen.getByText("İç notlar")).toBeTruthy();
    expect(screen.getByText("Misafire gitmez.")).toBeTruthy();
    expect(screen.getByText("Henüz not yok.")).toBeTruthy();
    expect(textarea().placeholder).toBe("Telefon görüşmesi, kapıda söylenen, hatırlatma…");
    expect(textarea().maxLength).toBe(1000);
  });

  it("notlar: yazan · zaman · metin (satır sonu korunur); 'Sil' YALNIZ silinebilen satırda", () => {
    render(<InternalNotesCard conversationId="c1" notes={[mine, theirs]} readOnly={false} />);
    const rows = screen.getAllByTestId("internal-note");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Ayşe · 18 Kas 14:05");
    expect(rows[0]!.querySelector("p")!.textContent).toBe("Telefonla aradı.\nYarın gelecek.");
    expect(rows[0]!.textContent).toContain("Sil");
    expect(rows[1]!.textContent).not.toContain("Sil");
    expect(screen.getAllByText("Sil")).toHaveLength(1);
  });

  it("🚨 ekle → POST (konuşma + metin + istek kimliği), liste yenilenir, metin temizlenir; sonraki not YENİ kimlik", async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 201, body: { note: {}, reused: false } },
      { ok: true, status: 201, body: { note: {}, reused: false } },
    ]);
    render(<InternalNotesCard conversationId="c1" notes={[]} readOnly={false} />);
    typeText("Misafir aradı");
    await save();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/internal-notes");
    const sent1 = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { conversationId: string; body: string; requestId: string };
    expect(sent1).toMatchObject({ conversationId: "c1", body: "Misafir aradı" });
    expect(sent1.requestId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(Object.keys(sent1).sort()).toEqual(["body", "conversationId", "requestId"]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("");
    typeText("Misafir aradı");
    await save();
    const sent2 = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)) as { requestId: string };
    expect(sent2.requestId).not.toBe(sent1.requestId);
  });

  it("🚨 başarısız kayıttan sonra AYNI metinle yeniden deneme AYNI kimlik; metin değişince yeni kimlik; hata söylenir, liste yenilenmez", async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 500, body: { error: "Beklenmeyen bir hata oluştu." } },
      { ok: false, status: 500, body: {} },
      { ok: true, status: 201, body: {} },
    ]);
    render(<InternalNotesCard conversationId="c1" notes={[]} readOnly={false} />);
    typeText("Kapıda söylendi");
    await save();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(textarea().value).toBe("Kapıda söylendi");
    await save();
    const id = (i: number) => (JSON.parse(String(fetchMock.mock.calls[i]![1]!.body)) as { requestId: string }).requestId;
    expect(id(1)).toBe(id(0));
    typeText("Kapıda söylendi.");
    await save();
    expect(id(2)).not.toBe(id(1));
  });

  it("doğrulama hatası (400) alan metinleriyle söylenir; ağ hatası 'Bağlantı hatası'", async () => {
    stubFetch([{ ok: false, status: 400, body: { fields: { body: "Çok uzun — en fazla 1000 karakter olabilir." } } }]);
    render(<InternalNotesCard conversationId="c1" notes={[]} readOnly={false} />);
    typeText("x");
    await save();
    expect(toastError).toHaveBeenCalledWith("Çok uzun — en fazla 1000 karakter olabilir.");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await save();
    expect(toastError).toHaveBeenLastCalledWith("Bağlantı hatası. Lütfen tekrar deneyin.");
  });

  it("boş metinle 'Kaydet' pasif, istek gitmez", async () => {
    const fetchMock = stubFetch([]);
    render(<InternalNotesCard conversationId="c1" notes={[]} readOnly={false} />);
    typeText("   ");
    expect((screen.getByText("Kaydet").closest("button") as HTMLButtonElement).disabled).toBe(true);
    await save();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sil → DELETE, liste yenilenir; 404 (zaten silinmiş) hata değil; başka hata söylenir", async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200 },
      { ok: false, status: 404 },
      { ok: false, status: 403 },
    ]);
    render(<InternalNotesCard conversationId="c1" notes={[mine]} readOnly={false} />);
    const click = () =>
      act(async () => {
        fireEvent.click(screen.getByText("Sil"));
      });
    await click();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/internal-notes/n1");
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("DELETE");
    await click();
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(toastError).not.toHaveBeenCalled();
    await click();
    expect(toastError).toHaveBeenCalledWith("Silinemedi. Sayfayı yenileyip tekrar deneyin.");
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("bürünme (salt okunur): notlar görünür; ekleme alanı ve 'Sil' YOK", () => {
    render(<InternalNotesCard conversationId="c1" notes={[mine]} readOnly={true} />);
    expect(screen.getAllByTestId("internal-note")).toHaveLength(1);
    expect(screen.queryByText("Sil")).toBeNull();
    expect(screen.queryByText("Kaydet")).toBeNull();
    expect(screen.queryByLabelText("İç not ekle")).toBeNull();
  });
});
