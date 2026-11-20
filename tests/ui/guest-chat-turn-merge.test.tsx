// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { GuestChat } from "@/components/guest-chat/guest-chat";

// ---------------------------------------------------------------------------
// QR SOHBETİ — TEK CEVAP KİPİ, EKRAN (kurucu 11-20 öğlen F4-b; sunucu anahtarı `GUEST_CHAT_TURN_MERGE_ENABLED`, ekran `turnMerge`).
// Kip açıkken misafir cevabı beklemeden art arda yazabilir: her mesaj ayrı istektir, sunucu hepsini tek cevapta toplar. Yerel balonlar
// sunucu listesinden ayrı tutulur — bir isteğin cevabı gelip liste yenilenince öteki mesajın balonu kaybolmaz, kaydı listede görünen
// mesaj iki kez çizilmez. Kip kapalıyken ekran bugünkü gibi: gönderim sürerken ikinci mesaj gönderilmez.
// ---------------------------------------------------------------------------

type Msg = { id: string; role: "guest" | "ai"; text: string; clientId?: string };
type PostBody = { message: string; requestId?: string };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** Sahte sunucu: her gönderim mesajı HEMEN kaydeder (istek kimliğiyle); yanıtı test elle çözer. */
function setup() {
  const server = { messages: [] as Msg[] };
  const posts: { body: PostBody; resolve: (reply: Record<string, unknown>, status?: number) => void }[] = [];
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, messages: [...server.messages] }) });
    }
    const body = JSON.parse(String(init!.body)) as PostBody;
    if (!server.messages.some((m) => m.clientId === body.requestId)) {
      server.messages.push({ id: `g${server.messages.length}`, role: "guest", text: body.message, clientId: body.requestId });
    }
    return new Promise((resolve) => {
      posts.push({
        body,
        resolve: (reply, status = 200) => resolve({ ok: status < 400, status, json: async () => reply }),
      });
    });
  });
  vi.stubGlobal("fetch", fn);
  return { posts, server };
}

const box = () => screen.getByPlaceholderText(/Sorunuzu yazın/) as HTMLTextAreaElement;
function typeAndSend(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
}
const bubbles = (text: string) => screen.queryAllByText(text).length;

describe("QR ekranı — tek cevap kipi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("KONTROL (kip kapalı): gönderim sürerken ikinci mesaj gönderilmez", async () => {
    const { posts } = setup();
    render(<GuestChat token="tok" />);
    await advance(0);
    typeAndSend("Wi-Fi şifresi ne?");
    await advance(0);
    fireEvent.change(box(), { target: { value: "Otopark var mı?" } });
    expect((screen.getByRole("button", { name: "Gönder" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(box().closest("form")!);
    await advance(0);
    expect(posts).toHaveLength(1);
  });

  it("🚨 cevap beklenirken ikinci mesaj gönderilir; iki balon da görünür, ayrı istek kimlikleriyle gider", async () => {
    const { posts } = setup();
    render(<GuestChat token="tok" turnMerge />);
    await advance(0);
    typeAndSend("Wi-Fi şifresi ne?");
    await advance(0);
    typeAndSend("Otopark var mı?");
    await advance(0);
    expect(posts.map((p) => p.body.message)).toEqual(["Wi-Fi şifresi ne?", "Otopark var mı?"]);
    expect(posts[0]!.body.requestId).toBeTruthy();
    expect(posts[0]!.body.requestId).not.toBe(posts[1]!.body.requestId);
    expect(bubbles("Wi-Fi şifresi ne?")).toBe(1);
    expect(bubbles("Otopark var mı?")).toBe(1);
    expect(screen.getByText(/yazıyor/i)).toBeTruthy();
  });

  it("ilk istek 'birleşti' dönünce liste yenilenir: hiçbir balon kaybolmaz, hiçbiri iki kez çizilmez; tek cevap gelince 'yazıyor' kalkar", async () => {
    const { posts, server } = setup();
    render(<GuestChat token="tok" turnMerge />);
    await advance(0);
    typeAndSend("Wi-Fi şifresi ne?");
    await advance(0);
    typeAndSend("Otopark var mı?");
    await advance(0);
    posts[0]!.resolve({ ok: true, merged: true });
    await advance(0);
    expect(bubbles("Wi-Fi şifresi ne?")).toBe(1);
    expect(bubbles("Otopark var mı?")).toBe(1);
    expect(screen.getByText(/yazıyor/i)).toBeTruthy(); // ikinci istek sürüyor
    server.messages.push({ id: "a1", role: "ai", text: "Şifre deniz2024; otoparkımız binanın altında." });
    posts[1]!.resolve({ ok: true, escalated: false, reply: "Şifre deniz2024; otoparkımız binanın altında." });
    await advance(0);
    expect(bubbles("Şifre deniz2024; otoparkımız binanın altında.")).toBe(1);
    expect(bubbles("Wi-Fi şifresi ne?")).toBe(1);
    expect(bubbles("Otopark var mı?")).toBe(1);
    expect(screen.queryByText(/yazıyor/i)).toBeNull();
  });

  it("gönderim sürerken arka plan sorgusu çalışır (önceki mesajın cevabı beklenirken görünür)", async () => {
    const { posts, server } = setup();
    render(<GuestChat token="tok" turnMerge />);
    await advance(0);
    typeAndSend("Wi-Fi şifresi ne?");
    await advance(0);
    server.messages.push({ id: "h1", role: "ai", text: "Ev sahibinden not." });
    await advance(5_100);
    expect(bubbles("Ev sahibinden not.")).toBe(1);
    expect(bubbles("Wi-Fi şifresi ne?")).toBe(1);
    posts[0]!.resolve({ ok: true });
    await advance(0);
  });

  it("başarısız mesajın metni geri gelir ve yeniden gönderimi AYNI istek kimliğini taşır (araya başka mesaj girse de)", async () => {
    const { posts } = setup();
    render(<GuestChat token="tok" turnMerge />);
    await advance(0);
    typeAndSend("Wi-Fi şifresi ne?");
    await advance(0);
    typeAndSend("Otopark var mı?");
    await advance(0);
    posts[0]!.resolve({ error: "x" }, 500);
    await advance(0);
    expect(box().value).toBe("Wi-Fi şifresi ne?");
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await advance(0);
    expect(posts).toHaveLength(3);
    expect(posts[2]!.body).toEqual(posts[0]!.body);
  });
});
