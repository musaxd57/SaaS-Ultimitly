// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { GuestChat } from "@/components/guest-chat/guest-chat";

// ---------------------------------------------------------------------------
// 🚨 MİSAFİR SOHBETİ POLL DAVRANIŞI (dış denetim 09-18, bulgu 4).
//
// Üç ölçülmüş kusur, üçü de SESSİZ:
//  ① Görünürlük kapısı YOKTU — misafir telefonu cebine koyduğunda arka plan
//    sekmesi 5 saniyede bir istek atmaya devam ediyordu. Ürünün KENDİ standardı
//    (`inbox/auto-refresh.tsx`) bu işi doğru yapıyor, bu yüzeye uygulanmamıştı.
//  ② Terminal durumda DURMUYORDU — interval yalnız unmount'ta temizleniyordu,
//    yani konaklama bittikten GÜNLER sonra bile poll sürüyordu.
//  ③ 429 SESSİZCE YUTULUYORDU — GET kotası IP başına 60/dk, her sohbet 12/dk
//    yakıyor; aynı IP'de beş cihaz tavanı doldurunca altıncısının sohbeti
//    hiçbir açıklama olmadan donuyordu.
// ---------------------------------------------------------------------------

type Reply = { ok: boolean; status?: number; body?: unknown };

function setupFetch(reply: () => Reply) {
  const fn = vi.fn((_url: string, opts?: RequestInit) => {
    if ((opts?.method ?? "GET") !== "GET") return Promise.resolve({ ok: true, json: async () => ({}) });
    const r = reply();
    return Promise.resolve({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const getCalls = (fn: ReturnType<typeof setupFetch>) =>
  fn.mock.calls.filter(([, o]) => (o as RequestInit | undefined)?.method !== "POST").length;

/**
 * 🚨 SAHTE ZAMANLAYICI RENDER'DAN ÖNCE KURULMALI. İlk yazımda `render()`ten
 * SONRA kuruluyordu ve `setInterval` GERÇEK zamanlayıcıyla oluşmuştu — bu
 * yüzden `advanceTimersByTime` hiçbir turu tetiklemiyor, test de "poll etmiyor"
 * diye YEŞİL kalıyordu. Testin kendi kusuruydu; ölçülüp düzeltildi.
 */
async function flush(ms = 0) {
  await act(async () => {
    if (ms) vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("GuestChat — poll kapıları", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVisibility("visible");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
    setVisibility("visible");
  });

  it("🚨 SEKME ARKA PLANDAYKEN POLL ETMEZ", async () => {
    const fn = setupFetch(() => ({ ok: true, body: { open: true, messages: [] } }));
    render(<GuestChat token="tok-vis" />);
    await flush();

    const beforeVisible = getCalls(fn);
    await flush(15_000);
    expect(getCalls(fn), "görünürken poll SÜRMELİ (anti-vakumluk)").toBeGreaterThan(beforeVisible);

    const beforeHidden = getCalls(fn);
    setVisibility("hidden");
    await flush(30_000);
    expect(getCalls(fn), "arka plan sekmesi sunucuya yük bindirmeye devam ediyor").toBe(beforeHidden);

    // Sekmeye dönünce bir sonraki turu BEKLEMEDEN yakalar.
    setVisibility("visible");
    await flush();
    expect(getCalls(fn)).toBeGreaterThan(beforeHidden);
  });

  it("🚨 KONAKLAMA KAPANINCA POLL DURUR (interval yalnız unmount'ta temizleniyordu)", async () => {
    const fn = setupFetch(() => ({ ok: true, body: { open: false, messages: [] } }));
    render(<GuestChat token="tok-closed" />);
    await flush();
    await flush();

    const afterClose = getCalls(fn);
    await flush(60_000);
    expect(getCalls(fn), "kapanmış konaklamada sonsuza kadar poll ediliyor").toBe(afterClose);
  });

  it("🚨 KALICI 429 EKRANDA SÖYLENİR (sessizce donmaz)", async () => {
    setupFetch(() => ({ ok: false, status: 429, body: {} }));
    render(<GuestChat token="tok-429" />);
    await flush();
    for (let i = 0; i < 4; i += 1) await flush(5_000);
    expect(screen.getByText(/Yeni mesajlar şu an alınamıyor/)).toBeTruthy();
  });

  it("tek seferlik titreme UYARI BASMAZ (karşı yön)", async () => {
    let n = 0;
    setupFetch(() => {
      n += 1;
      return n === 2 ? { ok: false, status: 500, body: {} } : { ok: true, body: { open: true, messages: [] } };
    });
    render(<GuestChat token="tok-blip" />);
    await flush();
    for (let i = 0; i < 4; i += 1) await flush(5_000);
    expect(screen.queryByText(/Yeni mesajlar şu an alınamıyor/)).toBeNull();
  });
});
