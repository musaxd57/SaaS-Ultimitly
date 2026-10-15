// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// BİLGİ TABANI EKLEME EKRANLARI — İSTEK KİMLİĞİ (idempotency denetimi 10-15, P1; sunucu migration 67 ile hazırdı).
//
// Ölçülen boşluk: içe aktarım dışındaki üç ekleme ekranı (form, şablon önerisi, geçmiş cevap önerisi) kimlik göndermiyordu → bağlantı cevap
// anında kopup kullanıcı yeniden basınca İKİ aynı kalem açılıyordu. Sözleşme (bu dosya pinler):
//  1. Her POST bir `requestId` taşır.
//  2. Başarısız denemeden sonra AYNI kalem yeniden gönderilirse AYNI kimlik gider (sunucu ilk kalemi döndürür).
//  3. Başarıdan sonra kimlik unutulur: aynı metin bilerek yeniden eklenirse YENİ kimlik (yeni kalem — bilinçli).
//  4. Farklı kalem farklı kimlik alır (iki öneri aynı kimliği paylaşmaz).
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/knowledge" }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { KbManager } from "@/components/knowledge/kb-manager";
import { KbTemplateSuggestions } from "@/components/knowledge/kb-template-suggestions";
import { KbPastAnswers } from "@/components/knowledge/kb-past-answers";

type Call = [string, RequestInit | undefined];
const posts = () =>
  (vi.mocked(fetch).mock.calls as unknown as Call[])
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init!.body)) as { requestId?: string; content: string; title: string });

/** POST cevapları sırayla: "fail" → 500, "net" → ağ hatası, "conflict" → 409 uyuşmazlık, "ok" → 201. GET (tarama) öneri listesini döndürür. */
function mockFetch(scan: unknown, postPlan: Array<"ok" | "fail" | "net" | "conflict">) {
  const plan = [...postPlan];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { ok: true, status: 200, json: async () => scan } as unknown as Response;
      const step = plan.shift() ?? "ok";
      if (step === "net") throw new TypeError("Failed to fetch");
      if (step === "fail") return { ok: false, status: 500, json: async () => ({ error: "x" }) } as unknown as Response;
      if (step === "conflict") {
        return { ok: false, status: 409, json: async () => ({ error: "Bu bilgi az önce farklı bir içerikle kaydedildi. Sayfayı yenileyip kontrol edin.", code: "idempotency_conflict" }) } as unknown as Response;
      }
      return { ok: true, status: 201, json: async () => ({ id: "kb1" }) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  router.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PROPS = [{ id: "p1", name: "Lale 1" }];

describe("Bilgi tabanı formu (KbManager)", () => {
  const fill = (title: string, content: string) => {
    fireEvent.change(document.getElementById("kb-title") as HTMLInputElement, { target: { value: title } });
    fireEvent.change(document.getElementById("kb-content") as HTMLTextAreaElement, { target: { value: content } });
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: /^Ekle$/ }));

  it("🚨 ağ hatasından sonra aynı metin AYNI kimlikle gider; başarıdan sonra aynı metin YENİ kimlik alır", async () => {
    mockFetch({ fromTemplates: [] }, ["net", "ok", "ok"]);
    render(<KbManager properties={PROPS} items={[]} />);
    fill("Otopark", "Bina önünde ücretsiz otopark var.");
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Ekle$/ }).hasAttribute("disabled")).toBe(false));
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    // Başarı formu boşaltır; aynı metni bilerek yeniden yazıp eklemek yeni kalemdir.
    await waitFor(() => expect((document.getElementById("kb-content") as HTMLTextAreaElement).value).toBe(""));
    fill("Otopark", "Bina önünde ücretsiz otopark var.");
    submit();
    await waitFor(() => expect(posts()).toHaveLength(3));
    const [a, b, c] = posts();
    expect(a.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).toBe(a.requestId);
    expect(c.requestId).not.toBe(a.requestId);
  });

  it("🚨 409 uyuşmazlıktan sonra (kurucu 10-15) mesaj gösterilir ve aynı metinle yeniden 'Ekle' YENİ kimlik gönderir (bilinçli yeni işlem)", async () => {
    mockFetch({ fromTemplates: [] }, ["conflict", "ok"]);
    render(<KbManager properties={PROPS} items={[]} />);
    fill("Otopark", "Bina önünde ücretsiz otopark var.");
    submit();
    await screen.findByText(/farklı bir içerikle kaydedildi/);
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const [a, b] = posts();
    expect(b.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).not.toBe(a.requestId);
  });

  it("metin değişince yeni kimlik (düzeltilmiş kalem ayrı istek)", async () => {
    mockFetch({ fromTemplates: [] }, ["fail", "ok"]);
    render(<KbManager properties={PROPS} items={[]} />);
    fill("Otopark", "Bina önünde ücretsiz otopark var.");
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Ekle$/ }).hasAttribute("disabled")).toBe(false));
    fill("Otopark", "Bina önünde ücretli otopark var.");
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const [a, b] = posts();
    expect(b.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).not.toBe(a.requestId);
  });
});

describe("Diğer dairelere kopyala (KbManager)", () => {
  const ITEM = { id: "k1", propertyId: "p1", propertyName: "Lale 1", category: "wifi", title: "Wi-Fi", content: "Ağ adı Lale.", language: "tr", isActive: true };
  const PROPS3 = [{ id: "p1", name: "Lale 1" }, { id: "p2", name: "Lale 2" }, { id: "p3", name: "Lale 3" }];
  const copyBodies = () =>
    (vi.mocked(fetch).mock.calls as unknown as Call[])
      .filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/copy"))
      .map(([, init]) => JSON.parse(String(init!.body)) as { requestId?: string; targetPropertyIds: string[] });

  it("🚨 bağlantı hatasından sonra (hedefe daire eklense de) AYNI kimlik; başarıdan sonra yeni kimlik", async () => {
    mockFetch({ fromTemplates: [] }, ["net", "ok", "ok"]);
    render(<KbManager properties={PROPS3} items={[ITEM]} />);
    fireEvent.click(screen.getByRole("button", { name: "Diğer dairelere kopyala" }));
    fireEvent.click(screen.getByRole("button", { name: "Lale 2" }));
    fireEvent.click(screen.getByRole("button", { name: /1 daireye kopyala/ }));
    await waitFor(() => expect(copyBodies()).toHaveLength(1));
    await screen.findByText(/İnternet bağlantınızda sorun/);
    fireEvent.click(screen.getByRole("button", { name: "Lale 3" }));
    fireEvent.click(screen.getByRole("button", { name: /2 daireye kopyala/ }));
    await waitFor(() => expect(copyBodies()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(/hangi dairelere kopyalayalım/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Diğer dairelere kopyala" }));
    fireEvent.click(screen.getByRole("button", { name: "Lale 2" }));
    fireEvent.click(screen.getByRole("button", { name: /1 daireye kopyala/ }));
    await waitFor(() => expect(copyBodies()).toHaveLength(3));
    const [x, y, z] = copyBodies();
    expect(x.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(y.requestId).toBe(x.requestId);
    expect(y.targetPropertyIds.sort()).toEqual(["p2", "p3"]);
    expect(z.requestId).not.toBe(x.requestId);
  });
});

const TPL = (id: string, content: string) => ({
  sourceTemplateId: id,
  propertyId: "p1",
  propertyName: "Lale 1",
  category: "wifi",
  title: "Wi-Fi bilgisi",
  content,
  language: "tr",
  fromOrgWide: false,
});

describe("Şablon önerisi (KbTemplateSuggestions)", () => {
  it("🚨 'Eklenemedi' sonrası yeniden basış AYNI kimlik; başka öneri başka kimlik", async () => {
    const rows = [TPL("t1", "Ağ adı Lale-Misafir, şifre kapıdaki kartta."), TPL("t2", "Modem salonda, ışıklar yeşil olmalı.")];
    mockFetch({ fromTemplates: rows }, ["fail", "ok", "ok"]);
    const user = userEvent.setup();
    render(<KbTemplateSuggestions />);
    await user.click(screen.getByRole("button", { name: /Tara/ }));
    const addButtons = await screen.findAllByRole("button", { name: /Bilgi tabanına ekle/ });
    await user.click(addButtons[0]);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.click((await screen.findAllByRole("button", { name: /Bilgi tabanına ekle/ }))[0]);
    await waitFor(() => expect(posts()).toHaveLength(2));
    await user.click((await screen.findAllByRole("button", { name: /Bilgi tabanına ekle/ }))[0]);
    await waitFor(() => expect(posts()).toHaveLength(3));
    const [a, b, c] = posts();
    expect(a.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).toBe(a.requestId);
    expect(b.content).toBe(a.content);
    expect(c.content).not.toBe(a.content);
    expect(c.requestId).not.toBe(a.requestId);
  });
});

describe("Geçmiş cevap önerisi (KbPastAnswers)", () => {
  it("🚨 'Eklenemedi' sonrası yeniden basış AYNI kimlik (başlık kategoriden türetilse de)", async () => {
    const suggestions = [
      { propertyId: "p1", propertyName: "Lale 1", category: "parking", answer: "Otopark bina önünde.", occurrences: 3, exampleQuestion: "Otopark var mı?" },
    ];
    mockFetch({ suggestions, fromTemplates: [] }, ["net", "ok"]);
    const user = userEvent.setup();
    render(<KbPastAnswers />);
    await user.click(screen.getByRole("button", { name: /Tara|Bul|Öner/ }));
    await user.click(await screen.findByRole("button", { name: /Bilgi tabanına ekle/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.click(await screen.findByRole("button", { name: /Bilgi tabanına ekle/ }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    const [a, b] = posts();
    expect(a.title).toBe("Otopark");
    expect(a.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).toBe(a.requestId);
  });
});
