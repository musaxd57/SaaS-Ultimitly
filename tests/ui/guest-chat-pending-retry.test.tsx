// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { GuestChat, guestChatPendingDelay, GUEST_CHAT_PENDING_GIVE_UP_MS } from "@/components/guest-chat/guest-chat";

// ---------------------------------------------------------------------------
// QR SOHBETİ — SÜREN İSTEK ("pending") VE OKUMA KONUMU (Codex 11-17 E1 + H6).
//
// E1: sunucu "aynı kimlikli istek başka bir bağlantıda hâlâ işleniyor" dediğinde ekran eskiden bunu "kaydedildi" sayıyordu: metni ve
// istek kimliğini siliyor, geçmişi yeniden yüklüyordu (mesaj henüz kaydedilmediği için balon kayboluyordu). İlk iş kayıttan önce düşerse
// misafirin mesajı hiçbir yerde kalmıyordu. Şimdi: balon yerinde kalır, AYNI kimlik + AYNI metin aralıklı yeniden gönderilir; süre biterse
// metin geri gelir ve kimlik korunur.
// H6: misafir geçmişi okurken (liste sonu ekranda değilken) arka plan sorgusu ekranı aşağı çekmez.
// ---------------------------------------------------------------------------

type Msg = { id: string; role: "guest" | "ai"; text: string };
type PostBody = { message: string; requestId?: string };

/** Zamanlayıcıları ilerlet + bekleyen söz zincirlerini boşalt (sahte saatle `waitFor` kullanılmaz). */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function setup(postReplies: Array<Record<string, unknown>>, opts: { initial?: Msg[]; postDelayMs?: number } = {}) {
  const server = { messages: [...(opts.initial ?? [])] as Msg[] };
  const posts: PostBody[] = [];
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, messages: [...server.messages] }) });
    }
    const body = JSON.parse(String(init!.body)) as PostBody;
    posts.push(body);
    // Sıra bittiyse son cevap yinelenir.
    const reply = postReplies[Math.min(posts.length - 1, postReplies.length - 1)]!;
    if (!reply.pending) {
      // Kaydedildi (bu istekte ya da önceki denemede): sunucu listesi mesajı + cevabı taşır.
      if (!server.messages.some((m) => m.text === body.message)) {
        server.messages.push({ id: `g${server.messages.length}`, role: "guest", text: body.message });
        server.messages.push({ id: `a${server.messages.length}`, role: "ai", text: "Çöp salı günü." });
      }
    }
    const response = { ok: true, status: 200, json: async () => reply };
    // İsteğe bağlı gecikme: cevabı (sahte) zamanlayıcı getirir — "gönderim sürerken" anını kurmak için.
    return opts.postDelayMs
      ? new Promise<typeof response>((resolve) => setTimeout(() => resolve(response), opts.postDelayMs))
      : Promise.resolve(response);
  });
  vi.stubGlobal("fetch", fn);
  return { posts, server };
}

const box = () => screen.getByPlaceholderText(/Sorunuzu yazın/) as HTMLTextAreaElement;
function typeAndSend(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
}

describe("QR sohbeti — süren istek aynı kimlikle yeniden sorulur (E1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("🚨 'pending' cevabında balon ve kimlik KORUNUR; 3 sn, sonra 6 sn arayla AYNI kimlik + AYNI metin yeniden gönderilir; kaydedilince ekran yenilenir", async () => {
    const { posts } = setup([{ pending: true }, { pending: true }, { deduped: true }]);
    render(<GuestChat token="t" />);
    await advance(0);

    typeAndSend("Çöp ne zaman?");
    await advance(0);
    expect(posts).toHaveLength(1);
    expect(screen.getByText("Çöp ne zaman?")).toBeTruthy(); // ⬅️ ESKİDE geçmiş yeniden yüklenir, kaydedilmemiş mesajın balonu silinirdi
    expect(box().value).toBe(""); // geri alma yok — gönderim sürüyor
    expect(screen.queryByRole("alert")).toBeNull();

    await advance(2_999);
    expect(posts).toHaveLength(1); // 3 saniye dolmadan yeniden sorulmaz
    await advance(1);
    expect(posts).toHaveLength(2);
    await advance(5_999);
    expect(posts).toHaveLength(2);
    await advance(1);
    expect(posts).toHaveLength(3);
    // Üç istek de AYNI işlem: aynı kimlik, aynı metin (sunucu asla çift kaydetmez).
    expect(new Set(posts.map((p) => p.requestId)).size).toBe(1);
    expect(posts.every((p) => p.message === "Çöp ne zaman?")).toBe(true);
    // Kaydedildi → geçmiş yenilendi, cevap ekranda.
    expect(screen.getByText("Çöp salı günü.")).toBeTruthy();

    // Kaydedilen işlemin kimliği silindi: sonraki mesaj YENİ kimlik taşır.
    typeAndSend("ikinci soru");
    await advance(0);
    expect(posts).toHaveLength(4);
    expect(posts[3]!.requestId).not.toBe(posts[0]!.requestId);
  });

  it("🚨 sunucu hep 'pending' derse: çalışan kilidin ömrü (120 sn) aşılana dek sorulur, sonra metin geri gelir + var olan hata metni; kimlik KORUNUR", async () => {
    const { posts } = setup([{ pending: true }]);
    render(<GuestChat token="t" />);
    await advance(0);
    typeAndSend("Çöp ne zaman?");
    await advance(0);

    await advance(120_000);
    expect(screen.queryByRole("alert")).toBeNull(); // kilit ömrü dolmadan vazgeçilmez
    expect(box().value).toBe("");

    await advance(GUEST_CHAT_PENDING_GIVE_UP_MS); // bol pay
    expect(posts).toHaveLength(14); // 0 · 3 · 9 · 21 · … · 141. saniye
    expect(screen.getByRole("alert").textContent).toMatch(/yanıt veremiyorum/);
    expect(box().value).toBe("Çöp ne zaman?"); // metin kaybolmadı
    expect(screen.queryByText("Çöp ne zaman?", { selector: "p, div" })).toBeNull(); // gönderilmiş gibi duran balon kalmadı

    // Misafir elle yeniden gönderir: AYNI kimlik (ilk iş bu arada kaydedildiyse sunucu "tekrar" der — çift mesaj olmaz).
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await advance(0);
    expect(posts).toHaveLength(15);
    expect(posts[14]!.requestId).toBe(posts[0]!.requestId);
  });

  it("ekran kapanırsa (sayfa değişti) süren yeniden sorma döngüsü DURUR", async () => {
    const { posts } = setup([{ pending: true }]);
    const view = render(<GuestChat token="t" />);
    await advance(0);
    typeAndSend("Çöp ne zaman?");
    await advance(0);
    expect(posts).toHaveLength(1);
    view.unmount();
    await advance(60_000);
    expect(posts).toHaveLength(1);
  });

  it("KONTROL: 'pending' olmayan olağan gönderim tek istek atar (bugünkü davranış)", async () => {
    const { posts } = setup([{ escalated: false, reply: "Çöp salı günü." }]);
    render(<GuestChat token="t" />);
    await advance(0);
    typeAndSend("Çöp ne zaman?");
    await advance(0);
    expect(posts).toHaveLength(1);
    expect(screen.getByText("Çöp salı günü.")).toBeTruthy();
    await advance(30_000);
    expect(posts).toHaveLength(1);
  });

  it("bekleme aralıkları: 3 sn, 6 sn, sonra hep 12 sn; toplam bekleme sunucudaki çalışan kilidin ömrünü (120 sn) aşar", () => {
    expect([0, 1, 2, 3, 50].map(guestChatPendingDelay)).toEqual([3_000, 6_000, 12_000, 12_000, 12_000]);
    expect(guestChatPendingDelay(-1)).toBe(3_000);
    // Çökmüş bir işin kilidi 120 sn sonra süpürülür: vazgeçmeden ÖNCE en az bir istek o andan sonra atılmalı.
    expect(GUEST_CHAT_PENDING_GIVE_UP_MS).toBeGreaterThan(120_000);
  });
});

describe("QR sohbeti — okuma konumu korunur (H6)", () => {
  let notify: (visible: boolean) => void = () => {};
  const scroll = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
    class FakeObserver {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        notify = (visible) => cb([{ isIntersecting: visible }]);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("🚨 misafir geçmişi okurken (liste sonu ekranda DEĞİL) arka plan sorgusu ekranı aşağı çekmez; sona dönünce yeni mesaj yine sona kaydırır", async () => {
    const { server } = setup([{ escalated: false, reply: "x" }], { initial: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }] });
    render(<GuestChat token="t" />);
    await advance(0);
    expect(scroll).toHaveBeenCalled(); // ilk açılış: sona iner

    notify(false); // misafir yukarı kaydırdı
    scroll.mockClear();
    server.messages.push({ id: "a2", role: "ai", text: "Yeni cevap." });
    await advance(5_000); // arka plan sorgusu yeni mesajı getirdi
    expect(screen.getByText("Yeni cevap.")).toBeTruthy();
    expect(scroll).not.toHaveBeenCalled(); // ⬅️ ESKİDE her sorgu sonunda koşulsuz aşağı kaydırıyordu

    notify(true); // misafir sona döndü
    server.messages.push({ id: "a3", role: "ai", text: "Bir cevap daha." });
    await advance(5_000);
    expect(scroll).toHaveBeenCalled();
  });

  it("misafir yukarıdayken KENDİ mesajını gönderirse ekran sona iner", async () => {
    setup([{ escalated: false, reply: "Çöp salı günü." }], { initial: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }] });
    render(<GuestChat token="t" />);
    await advance(0);
    notify(false);
    scroll.mockClear();
    typeAndSend("Çöp ne zaman?");
    await advance(0);
    expect(scroll).toHaveBeenCalled();
  });

  it("gönderim SÜRERKEN gelen cevap da sona kaydırır — gözlemci o an 'son görünmüyor' dese bile (kayma henüz bitmemiş olabilir)", async () => {
    setup([{ escalated: false, reply: "Çöp salı günü." }], { initial: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }], postDelayMs: 1_000 });
    render(<GuestChat token="t" />);
    await advance(0);
    typeAndSend("Çöp ne zaman?");
    await advance(0);
    notify(false); // yumuşak kayma sürüyor: liste sonu henüz ekranda değil
    scroll.mockClear();
    await advance(1_000); // cevap geldi, geçmiş yenilendi — gönderim bayrağı hâlâ açık
    expect(screen.getByText("Çöp salı günü.")).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
  });
});
