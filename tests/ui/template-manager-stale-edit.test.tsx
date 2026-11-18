// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-17 H1 — şablon düzenleme formu açıldığı sürümü (`expectedUpdatedAt`) gönderir; sunucu "arada değişti" (409) derse form AÇIK
// kalır, yazılan kaybolmaz. Kaydettikten sonra sayfa yenilenmeden aynı şablon yeniden açılırsa yanıttaki yeni sürüm gider (kendi
// kaydına sahte çatışma yok). Yeni şablon / varsayılandan uyarlama (POST) ön şart taşımaz.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { TemplateManager } from "@/components/templates/template-manager";

const OPENED = "2026-03-04T05:06:07.891Z";
const row = {
  id: "tpl1",
  title: "Karşılama",
  body: "Hoş geldiniz!",
  category: "general",
  language: "tr",
  isActive: true,
  propertyName: null,
  propertyId: null,
  updatedAt: OPENED,
};

type Reply = { status: number; body: unknown };
let replies: Reply[];
const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const sentBody = (i: number) => JSON.parse(String((fetchMock().mock.calls[i]![1] as RequestInit).body));

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
});

async function submit(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
const renderManager = () => render(<TemplateManager properties={[]} customTemplates={[row]} defaultTemplates={[]} />);

describe("şablon düzenleme — sürüm ön şartı (H1)", () => {
  it("🚨 düzenleme PATCH'i formun açıldığı sürümü gönderir", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Karşılama mesajı" } });
    await submit("Kaydet");
    expect(fetchMock().mock.calls[0]![0]).toBe("/api/templates/tpl1");
    expect(sentBody(0)).toMatchObject({ title: "Karşılama mesajı", body: "Hoş geldiniz!", expectedUpdatedAt: OPENED });
  });

  it("🚨 409 → sunucunun metni görünür, form açık kalır ve yazılan kaybolmaz; liste yenilenmez", async () => {
    replies = [{ status: 409, body: { error: "arada değişti", fields: { _: "arada değişti" } } }];
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    fireEvent.change(screen.getByLabelText("Şablon metni"), { target: { value: "Benim yeni metnim" } });
    await submit("Kaydet");
    expect(screen.getByText("arada değişti")).toBeTruthy();
    expect((screen.getByLabelText("Şablon metni") as HTMLTextAreaElement).value).toBe("Benim yeni metnim");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("kaydettikten sonra (sayfa henüz yenilenmeden) yeniden açılan aynı şablon yanıttaki YENİ sürümü gönderir", async () => {
    const NEWER = "2026-03-04T05:07:00.001Z";
    replies = [{ status: 200, body: { ...row, title: "Karşılama 2", updatedAt: NEWER } }, { status: 200, body: {} }];
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Karşılama 2" } });
    await submit("Kaydet");
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    await submit("Kaydet");
    expect(sentBody(1).expectedUpdatedAt).toBe(NEWER);
  });

  it("sayfa daha yeni sürümle yenilenmişse (başka biri kaydetti, liste tazelendi) yenisi gider — eski yanıt sürümü onu ezmez", async () => {
    const MINE = "2026-03-04T05:07:00.001Z";
    const LATER = "2026-03-04T06:00:00.000Z";
    replies = [{ status: 200, body: { ...row, updatedAt: MINE } }, { status: 200, body: {} }];
    const view = renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    await submit("Kaydet");
    view.rerender(<TemplateManager properties={[]} customTemplates={[{ ...row, title: "Başkasının başlığı", updatedAt: LATER }]} defaultTemplates={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    expect((screen.getByLabelText("Başlık") as HTMLInputElement).value).toBe("Başkasının başlığı");
    await submit("Kaydet");
    expect(sentBody(1).expectedUpdatedAt).toBe(LATER);
  });

  it("KONTROL: yeni şablon (POST) ön şart göndermez", async () => {
    replies = [{ status: 201, body: { id: "tpl2" } }];
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Yeni Şablon" }));
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Yeni" } });
    fireEvent.change(screen.getByLabelText("Şablon metni"), { target: { value: "Yeni metin" } });
    await submit("Oluştur");
    expect(fetchMock().mock.calls[0]![0]).toBe("/api/templates");
    expect(sentBody(0)).not.toHaveProperty("expectedUpdatedAt");
  });
});
