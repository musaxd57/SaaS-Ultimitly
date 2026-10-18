// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN PANELİ (gece-4 S5-13: 693 satırlık bileşenin hiç ekran testi yoktu; yalnız API / servis katmanı sınanıyordu).
// Sözleşme: işaretli taslakta "Kontrol ettim" olmadan, aynı konuda bilgi tabanı kalemi varken seçim yapılmadan Onayla KAPALI; "yerine koy"
// görülen sürümle (updatedAt) gider; sunucunun 409 needsConfirm / needsResolution cevabı kartı kilitlemez, yeni uyarı / eşleşmeyle açar;
// başka 409 / 404 listeyi yeniler (ölü kart kalmaz); iş sürerken durum yoklanır, üç okuma hatasında durur ve söyler.
// ---------------------------------------------------------------------------

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { HistoryLearnPanel, FLAG_TEXT } from "@/components/properties/history-learn-panel";

const P = "p1";
const baseDraft = {
  id: "d1",
  category: "wifi",
  title: "Wi-Fi",
  content: "Ağ: Lale-5G",
  supportConversations: 3,
  newestMonth: "2026-09",
  oldestMonth: "2026-07",
  conflict: false,
  conflictNote: null,
  flags: [] as string[],
};
const match = { id: "kb1", title: "Eski Wi-Fi", preview: "Ağ: Lale", kind: "differs" as const, updatedAt: "2026-10-01T10:00:00.000Z" };

type Reply = { status: number; body?: unknown } | "net";
interface Plan {
  learn: unknown[];
  patch?: Reply[];
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function mockFetch(plan: Plan) {
  const learn = [...plan.learn];
  const patch = [...(plan.patch ?? [])];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/properties/${P}/instructions`) return json(200, { instructions: [], presets: [] });
    if (url === `/api/properties/${P}/history-learn` && (!init || !init.method || init.method === "GET")) {
      const next = learn.length > 1 ? learn.shift() : learn[0];
      if (next === "fail") return json(500, {});
      return json(200, next);
    }
    if (url.startsWith("/api/history-learn/drafts/") && init?.method === "PATCH") {
      const r = patch.shift() ?? { status: 200, body: { ok: true } };
      if (r === "net") throw new TypeError("Failed to fetch");
      return json(r.status, r.body ?? {});
    }
    return json(404, {});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const learnGets = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([u, i]) => u === `/api/properties/${P}/history-learn` && (!i || !(i as RequestInit).method)).length;
const patchBodies = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
const listWith = (drafts: unknown[], runs: unknown[] = []) => ({ runs, drafts, comparisons: [] });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Geçmişten öğren paneli — taslak kartı", () => {
  it("🚨 işaretli + aynı konuda kayıt: Onayla 'Kontrol ettim' VE seçim olmadan kapalı; 'yerine koy' görülen sürümle gider", async () => {
    const fn = mockFetch({ learn: [listWith([{ ...baseDraft, flags: ["payment"], kbMatches: [match] }])] });
    const user = userEvent.setup();
    render(<HistoryLearnPanel propertyId={P} />);
    const approve = await screen.findByRole("button", { name: /Onayla/ });
    expect(screen.getByText(FLAG_TEXT.payment)).toBeTruthy();
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    expect((approve as HTMLButtonElement).disabled).toBe(true); // seçim hâlâ yok
    await user.click(screen.getByRole("radio", { name: /Eski Wi-Fi/ }));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    await user.click(approve);
    await waitFor(() => expect(patchBodies(fn)).toHaveLength(1));
    expect(patchBodies(fn)[0]).toMatchObject({ action: "approve", confirmFlags: true, resolution: "replace", replaceKbItemId: "kb1", replaceKbItemUpdatedAt: match.updatedAt });
  });

  it("🚨 409 needsConfirm: sunucunun bulduğu YENİ uyarı kartta açılır, kutu yeniden işaretlenmeli; liste yenilenmez (kart kalır)", async () => {
    const fn = mockFetch({
      learn: [listWith([baseDraft])],
      patch: [{ status: 409, body: { error: "Kontrol edin.", needsConfirm: true, flags: ["guest_name", "bilinmeyen"] } }],
    });
    const user = userEvent.setup();
    render(<HistoryLearnPanel propertyId={P} />);
    const approve = await screen.findByRole("button", { name: /Onayla/ });
    expect(screen.queryByRole("checkbox")).toBeNull(); // işaretsiz taslak: kutu yok
    const before = learnGets(fn);
    await user.click(approve);
    expect(await screen.findByText(FLAG_TEXT.guest_name)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: /Onayla/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Kontrol edin.");
    expect(learnGets(fn)).toBe(before);
  });

  it("🚨 409 needsResolution: eşleşme listesi sunucudan güncellenir, eski seçim sıfırlanır", async () => {
    const fresh = { ...match, id: "kb2", title: "Yeni eklenen Wi-Fi kaydı", updatedAt: "2026-10-18T03:00:00.000Z" };
    const fn = mockFetch({
      learn: [listWith([{ ...baseDraft, kbMatches: [match] }])],
      patch: [{ status: 409, body: { error: "Bilgi tabanı değişti.", needsResolution: true, matches: [match, fresh] } }],
    });
    const user = userEvent.setup();
    render(<HistoryLearnPanel propertyId={P} />);
    await user.click(await screen.findByRole("radio", { name: /Ayrı kayıt/ }));
    await user.click(screen.getByRole("button", { name: /Onayla/ }));
    expect(await screen.findByText(/Yeni eklenen Wi-Fi kaydı/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Onayla/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(patchBodies(fn)[0]).toMatchObject({ resolution: "separate" });
  });

  it("başka 409 / 404 (taslak başka sekmede işlendi) listeyi yeniler; ağ hatası ortak metni gösterir", async () => {
    const fn = mockFetch({ learn: [listWith([baseDraft])], patch: [{ status: 409, body: { error: "Bu taslak zaten işlendi." } }, "net"] });
    const user = userEvent.setup();
    render(<HistoryLearnPanel propertyId={P} />);
    const before = learnGets(fn);
    await user.click(await screen.findByRole("button", { name: /Onayla/ }));
    await waitFor(() => expect(learnGets(fn)).toBe(before + 1));
    await user.click(screen.getByRole("button", { name: /Reddet/ }));
    expect(await screen.findByText(/İnternet bağlantınızda sorun var/)).toBeTruthy();
  });
});

describe("Geçmişten öğren paneli — durum yoklaması", () => {
  it("iş sürerken 4 sn'de bir yoklar, bitince durur; üst üste 3 okuma hatasında durur ve söyler", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = listWith([], [{ id: "r1", kind: "learn", status: "running", errorCode: null, pairCount: 0, draftCount: 0 }]);
    const done = listWith([], [{ id: "r1", kind: "learn", status: "done", errorCode: null, pairCount: 12, draftCount: 2 }]);
    const fn = mockFetch({ learn: [running, done] });
    render(<HistoryLearnPanel propertyId={P} />);
    expect(await screen.findByText(/Geçmiş mesajlar okunuyor/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(await screen.findByText(/12 soru okundu, 2 taslak çıktı/)).toBeTruthy();
    const settled = learnGets(fn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(learnGets(fn)).toBe(settled); // iş bitti → yoklama yok
    cleanup();

    mockFetch({ learn: ["fail"] });
    render(<HistoryLearnPanel propertyId={P} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(await screen.findByText("Durum okunamadı. Sayfayı yenileyin.")).toBeTruthy();
  });
});
