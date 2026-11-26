// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// MESAJ YAZARKEN ŞABLON SEÇİCİ — sunucu sayfalı liste (kurucu 11-19 akşam madde 1): ilk açılışta en çok 30 kalem, kalemde yalnız kısa
// önizleme; TAM metin seçilince `GET /api/templates/[id]` ile alınır ve tek ikame kaynağından (`applyTemplateBody`) geçer. Arama sunucuda
// (işletmenin bütün şablonlarında), "Daha fazla göster" aynı aramanın sonraki sayfasını ekler.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Merhaba", createdAtLabel: "10:00", senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: { guestName: "Ayşe" },
  canReply: true,
} as unknown as Props;

const item = (id: string, title: string, preview: string) => ({ id, title, preview, category: "general", language: "tr", isDefault: false });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let routes: Record<string, () => Response | Promise<Response>>;
const calls = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  routes = {
    "/api/templates?propertyId=prop-1": () =>
      json({ items: [item("t1", "Karşılama", "Merhaba {{guestName}}, hoş…")], total: 31, page: 1, pageSize: 30, hasMore: true }),
    "/api/templates?propertyId=prop-1&page=2": () =>
      json({ items: [item("t1", "Karşılama", "kopya"), item("t2", "Çıkış", "Çıkış saatimiz…")], total: 31, page: 2, pageSize: 30, hasMore: false }),
    "/api/templates?propertyId=prop-1&q=otopark": () =>
      json({ items: [item("t9", "Otopark", "Otopark arka sokakta…")], total: 1, page: 1, pageSize: 30, hasMore: false }),
    "/api/templates?propertyId=prop-1&q=yok": () => json({ items: [], total: 0, page: 1, pageSize: 30, hasMore: false }),
    "/api/templates/t1": () => json({ id: "t1", body: "Merhaba {{guestName}}, hoş geldiniz. TAM-METIN-SONU" }),
    "/api/templates/t2": () => json({ error: "Bu kayıt bulunamadı." }, 404),
    "/api/templates/t9": () => json({ id: "t9", body: "Otopark arka sokaktadır, kod 4321." }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = routes[String(url)];
      return r ? r() : json({ error: "beklenmeyen" }, 500);
    }),
  );
});
afterEach(() => vi.useRealTimers());

const composer = () => screen.getByLabelText("Misafire cevabınız") as HTMLTextAreaElement;
async function open() {
  render(<ConversationThread {...baseProps} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Şablonlar/ }));
  });
  return screen.findByRole("dialog");
}

describe("şablon seçici — sayfalı liste + seçilince tam metin", () => {
  it("🚨 liste yalnız önizleme gösterir; seçim TAM metni ayrı istekle alır ve değişkenleri doldurur", async () => {
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Merhaba {{guestName}}, hoş…"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Karşılama/ }));
    });
    await waitFor(() => expect(composer().value).toBe("Merhaba Ayşe, hoş geldiniz. TAM-METIN-SONU"));
    expect(calls()).toEqual(["/api/templates?propertyId=prop-1", "/api/templates/t1"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("'Daha fazla göster' aynı aramanın sonraki sayfasını EKLER (kimlikle tekilleştirir); son sayfada düğme kalkar", async () => {
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daha fazla göster" }));
    });
    await waitFor(() => expect(dialog.textContent).toContain("Çıkış"));
    expect(screen.getAllByRole("button", { name: /Karşılama/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Daha fazla göster" })).toBeNull();
    expect(calls()).toContain("/api/templates?propertyId=prop-1&page=2");
  });

  it("🚨 arama SUNUCUYA gider (ilk sayfada olmayan şablon bulunur); sonuç yoksa yalnız 'Şablon bulunamadı.'", async () => {
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(screen.getByLabelText("Şablonlarda ara"), { target: { value: "otopark" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(dialog.textContent).toContain("Otopark arka sokakta…"));
    expect(dialog.textContent).not.toContain("Karşılama");
    expect(calls()).toContain("/api/templates?propertyId=prop-1&q=otopark");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(screen.getByLabelText("Şablonlarda ara"), { target: { value: "yok" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(dialog.textContent).toContain("Şablon bulunamadı."));
    expect(dialog.textContent).not.toContain("Şablonlar sayfasından ekleyebilirsiniz");
  });

  it("aramadan sonra 'Daha fazla göster' AYNI aramanın sonraki sayfasını ister", async () => {
    routes["/api/templates?propertyId=prop-1&q=otopark"] = () =>
      json({ items: [item("t9", "Otopark", "Otopark arka sokakta…")], total: 31, page: 1, pageSize: 30, hasMore: true });
    routes["/api/templates?propertyId=prop-1&q=otopark&page=2"] = () =>
      json({ items: [item("t10", "Otopark 2", "İkinci otopark…")], total: 31, page: 2, pageSize: 30, hasMore: false });
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(screen.getByLabelText("Şablonlarda ara"), { target: { value: "otopark" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(dialog.textContent).toContain("Otopark arka sokakta…"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daha fazla göster" }));
    });
    await waitFor(() => expect(dialog.textContent).toContain("İkinci otopark…"));
    expect(calls()).toContain("/api/templates?propertyId=prop-1&q=otopark&page=2");
  });

  it("yavaş dönen ESKİ arama yenisinin sonucunu ezmez", async () => {
    let releaseSlow: () => void = () => {};
    routes["/api/templates?propertyId=prop-1&q=yavas"] = () =>
      new Promise<Response>((resolve) => {
        releaseSlow = () => resolve(json({ items: [item("t5", "Eski sonuç", "eski…")], total: 1, page: 1, pageSize: 30, hasMore: false }));
      });
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    const search = async (value: string) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.change(screen.getByLabelText("Şablonlarda ara"), { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      vi.useRealTimers();
    };
    await search("yavas");
    await search("otopark");
    await waitFor(() => expect(dialog.textContent).toContain("Otopark arka sokakta…"));
    await act(async () => {
      releaseSlow();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(dialog.textContent).toContain("Otopark arka sokakta…");
    expect(dialog.textContent).not.toContain("Eski sonuç");
  });

  it("tam metin okunamazsa mesaj kutusuna dokunulmaz, panel açık kalır, sebep duyurulur; silinmiş şablon listeden düşer", async () => {
    routes["/api/templates?propertyId=prop-1"] = () =>
      json({ items: [item("t1", "Karşılama", "Merhaba…"), item("t2", "Çıkış", "Çıkış…")], total: 2, page: 1, pageSize: 30, hasMore: false });
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Çıkış"));
    fireEvent.change(composer(), { target: { value: "Benim taslağım" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Çıkış/ }));
    });
    const alert = await screen.findByText("Bu kayıt bulunamadı.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(composer().value).toBe("Benim taslağım");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Çıkış/ })).toBeNull();
  });

  it("ağ hatasında kendi metni duyurulur (sunucu iletisi yoksa)", async () => {
    routes["/api/templates/t1"] = () => {
      throw new TypeError("network");
    };
    await open();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Karşılama/ }));
    });
    expect(await screen.findByText("Şablon yüklenemedi. Lütfen tekrar deneyin.")).toBeTruthy();
    expect(composer().value).toBe("");
  });
});

describe("şablon seçici — geç dönen tam metin, panel kapandıktan sonra yazılanı EZMEZ (Opus 11-20 gece)", () => {
  /** Seçilen şablonun tam metni elle çözülene kadar bekler (yavaş ağ). */
  function deferT1() {
    let resolve!: (r: Response) => void;
    routes["/api/templates/t1"] = () => new Promise<Response>((r) => (resolve = r));
    return async () => {
      await act(async () => {
        resolve(json({ id: "t1", body: "Merhaba {{guestName}}, hoş geldiniz. TAM-METIN-SONU" }));
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
    };
  }

  it("🚨 şablona basılır, istek beklerken panel Esc ile kapatılır ve ev sahibi kendi cevabını yazar → geç gelen şablon kutuya YAZILMAZ", async () => {
    const finish = deferT1();
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Karşılama/ }));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.change(composer(), { target: { value: "Kendi cevabım" } });
    await finish();
    expect(composer().value).toBe("Kendi cevabım");
  });

  it("KONTROL: panel açık kalırsa geç gelen tam metin kutuya yazılır", async () => {
    const finish = deferT1();
    const dialog = await open();
    await waitFor(() => expect(dialog.textContent).toContain("Karşılama"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Karşılama/ }));
    });
    await finish();
    await waitFor(() => expect(composer().value).toBe("Merhaba Ayşe, hoş geldiniz. TAM-METIN-SONU"));
  });
});
