// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { GuestChat, guestChatPollDelay } from "@/components/guest-chat/guest-chat";

// ---------------------------------------------------------------------------
// 🚨 Codex 11-05 (43fb93e incelemesi P2): YAVAŞ BAĞLANTIDA SOHBET HİÇ GÜNCELLENMİYORDU. 5 saniyede bir YENİ sorgu başlıyordu ve yalnız
// en son başlatılanın sonucu kabul ediliyordu; her cevap 6 saniyede gelince sürekli bir sonraki sorgu başlamış oluyordu → sanal zamanda
// 11 başarılı cevaba rağmen ekranda sıfır güncelleme. Beklenen: aynı anda tek sorgu, tamamlanınca sonraki planlanır, asılı sorgu zaman
// aşımıyla iptal edilir, ardışık başarısızlıkta bekleme artar; eski sonuç koruması (gönderim sonrası yenileme) korunur.
// ---------------------------------------------------------------------------

type Msg = { id: string; role: "guest" | "ai" | "host"; text: string };

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

/** Sanal zamanda ilerle ve bekleyen mikro görevleri boşalt (cevap → JSON → durum → sonraki tur planı zinciri). */
async function advance(ms: number, step = 500) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      vi.advanceTimersByTime(step);
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }
}

/** GET cevabı `delayMs` sonra gelir; iptal sinyaline uyar (gerçek fetch gibi AbortError fırlatır). Uçuştaki eşzamanlı GET sayısını ölçer. */
function slowServer(delayMs: number, body: (n: number) => unknown) {
  const stats = { gets: 0, inflight: 0, maxInflight: 0 };
  const fn = vi.fn((_url: string, opts?: RequestInit) => {
    if ((opts?.method ?? "GET") !== "GET") return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    const n = ++stats.gets;
    stats.inflight += 1;
    stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
    return new Promise((resolve, reject) => {
      const done = () => {
        stats.inflight -= 1;
      };
      const timer = setTimeout(() => {
        done();
        resolve({ ok: true, status: 200, json: async () => body(n) });
      }, delayMs);
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        done();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, stats };
}

describe("GuestChat — yavaş bağlantıda tek uçuşlu sorgu", () => {
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

  it("🚨 her cevap 6 saniyede gelse de ekran güncellenir ve aynı anda tek sorgu uçar", async () => {
    const { stats } = slowServer(6_000, (n) => ({ open: true, messages: [{ id: `a${n}`, role: "ai", text: `Yanıt ${n}` }] satisfies Msg[] }));
    render(<GuestChat token="tok-slow" />);
    await advance(40_000);
    expect(screen.getByText(/Yanıt \d+/)).toBeTruthy();
    expect(stats.maxInflight).toBe(1);
    // 40 sn: her tur 6 sn cevap + 5 sn bekleme → en az 3 tur tamamlanmış olmalı (ilerleme var, takılma yok).
    expect(stats.gets).toBeGreaterThanOrEqual(3);
  });

  it("🚨 asılı kalan sorgu zaman aşımıyla iptal edilir; döngü sürer ve kalıcı asılı kalma ekranda söylenir", async () => {
    // Hiç cevap gelmeyen sunucu (iptal edilene kadar bekler).
    const { stats } = slowServer(10 * 60_000, () => ({ open: true, messages: [] }));
    render(<GuestChat token="tok-hang" />);
    await advance(70_000);
    expect(stats.maxInflight).toBe(1);
    expect(stats.gets).toBeGreaterThanOrEqual(3); // iptal edilip yeniden denendi (eskiden ilk sorgu sonsuza kadar asılıydı da tur başlıyordu)
    expect(screen.getByText(/Yeni mesajlar şu an alınamıyor/)).toBeTruthy();
  });

  it("kalıcı 429'da bekleme artar (aynı ağdaki cihazlar sınırı daha çok zorlamaz); uyarı yine ~15 sn içinde", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) =>
      (opts?.method ?? "GET") === "GET"
        ? Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
    );
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok-429-backoff" />);
    await advance(16_000);
    expect(screen.getByText(/Yeni mesajlar şu an alınamıyor/)).toBeTruthy();
    await advance(104_000);
    // Sabit 5 sn'de 2 dakikada 25 sorgu olurdu; artan beklemeyle çok daha az.
    expect(fn.mock.calls.length).toBeLessThanOrEqual(8);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("gönderim sonrası yenileme, uçuştaki ESKİ sorguyu beklemez: en yeni durum hemen gelir (eski sonuç koruması)", async () => {
    let getN = 0;
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "POST") return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      getN += 1;
      if (getN === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, messages: [] }) });
      if (getN === 2) {
        // Gönderimden ÖNCE başlamış, çok yavaş (eski) sorgu — iptal edilmeli.
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ open: true, messages: [{ id: "g1", role: "guest", text: "Havlu var mı?" }, { id: "a1", role: "ai", text: "Havlular dolapta." }] }),
      });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok-send" />);
    await advance(5_500); // ilk sorgu bitti, ikinci (yavaş) sorgu uçuşta
    expect(getN).toBe(2);
    fireEvent.change(screen.getByPlaceholderText(/Sorunuzu yazın/), { target: { value: "Havlu var mı?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await advance(1_000);
    expect(screen.getByText("Havlular dolapta.")).toBeTruthy();
  });

  it("kilit açılışı yenilemesi uçuştaki eski sorguyu iptal eder; zamanlayıcı da uçuştaki bu yenilemeyi kesmez (tek uçuş)", async () => {
    let getN = 0;
    const abortable = (opts: RequestInit | undefined, ms: number, body: unknown) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => body }), ms);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST") return Promise.resolve({ ok: true, status: 200, json: async () => ({ unlocked: true }) });
      getN += 1;
      if (getN === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true }) });
      // 2: kilit açılmadan önce başlamış yavaş sorgu (cevabı hâlâ "kod gerekli" — uygulanırsa misafir kilit ekranına geri düşer).
      if (getN === 2) return abortable(opts, 30_000, { open: true, pinRequired: true });
      // 3: kilit açılışı yenilemesi (8 sn sürer; bu arada zamanlayıcı turu gelir).
      return abortable(opts, 8_000, { open: true, messages: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }] });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok-pin" />);
    await advance(6_000); // 1. sorgu → kilit ekranı; 5. sn'de 2. (yavaş) sorgu uçuşta
    expect(getN).toBe(2);
    fireEvent.change(screen.getByPlaceholderText("Sohbet kodu"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Sohbeti aç" }));
    await advance(9_000);
    expect(getN).toBe(3); // zamanlayıcı turu uçuştaki yenilemeyi kesip 4. sorgu açmadı
    expect(screen.getByText("Hoş geldiniz.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Sohbet kodu")).toBeNull();
  });

  it("görünürlük olayı turu öne çeker ama İKİNCİ döngü açmaz (uçuştayken de, beklerken de)", async () => {
    const { stats } = slowServer(1_000, () => ({ open: true, messages: [] }));
    render(<GuestChat token="tok-vis-loop" />);
    const fire = () => act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await advance(500);
    await fire(); // sorgu uçuştayken
    await advance(2_500);
    await fire(); // beklerken → hemen tur
    await advance(5_000);
    await fire(); // yine beklerken
    await advance(52_000);
    // Tek döngü: ~6 sn'de bir tur (1 sn cevap + 5 sn bekleme) → 60 sn'de ~11. İki döngü olsaydı ~20.
    expect(stats.gets).toBeLessThanOrEqual(12);
    expect(stats.gets).toBeGreaterThanOrEqual(9);
    expect(stats.maxInflight).toBe(1);
  });

  it("bekleme hesabı: uyarı eşiğine kadar 5 sn, sonra ikiye katlanarak 60 sn tavanı", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(guestChatPollDelay)).toEqual([5_000, 5_000, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});
