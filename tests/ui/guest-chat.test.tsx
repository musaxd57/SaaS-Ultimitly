// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { GuestChat } from "@/components/guest-chat/guest-chat";

type Msg = { id: string; role: "guest" | "ai" | "host" | "resume"; text: string; time?: string };

// A tiny stateful fake server: GET returns the thread; POST appends the guest
// message + an AI reply (mirrors recordGuestChat), then the client re-fetches.
function setupFetch(initial: Msg[]) {
  const server = { messages: [...initial], open: true };
  const fn = vi.fn((_url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ open: server.open, messages: server.messages }) });
    }
    const body = JSON.parse(String(opts!.body)) as { message: string };
    server.messages.push({ id: `g${server.messages.length}`, role: "guest", text: body.message });
    server.messages.push({ id: `a${server.messages.length}`, role: "ai", text: "Çöp salı günü." });
    return Promise.resolve({ ok: true, json: async () => ({ escalated: false, reply: "Çöp salı günü." }) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Sorunuzu yazın/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
}

describe("GuestChat (UI, two-way)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends a message and shows the AI reply from the re-fetched history", async () => {
    const fn = setupFetch([]);
    render(<GuestChat token="tok123" />);

    typeAndSend("Çöp ne zaman?");

    await screen.findByText("Çöp ne zaman?"); // guest bubble
    await screen.findByText("Çöp salı günü."); // AI reply (after re-fetch)
    const postCall = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall?.[0]).toBe("/api/chat/tok123");
    const parsed = JSON.parse(String((postCall![1] as RequestInit).body)) as { message: string; requestId?: string };
    expect(parsed.message).toBe("Çöp ne zaman?");
    // Idempotency id rides along on every send (server contract: [A-Za-z0-9-]{8,64}).
    expect(parsed.requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("requestId: a failed retry of the SAME text reuses one id; the next message after success gets a fresh one", async () => {
    const bodies: { message: string; requestId?: string }[] = [];
    let failNext = true;
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ open: true, messages: [] }) });
      bodies.push(JSON.parse(String(opts!.body)));
      if (failNext) return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => ({ escalated: false, reply: "tamam" }) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" />);

    typeAndSend("merhaba");
    await screen.findByText(/yanıt veremiyorum/); // failure → rollback restored the text
    failNext = false;
    fireEvent.click(screen.getByRole("button", { name: "Gönder" })); // retry same text
    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[0].requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(bodies[1].requestId).toBe(bodies[0].requestId); // retry carries the SAME id → server dedupes

    typeAndSend("ikinci soru");
    await waitFor(() => expect(bodies.length).toBe(3));
    expect(bodies[2].requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(bodies[2].requestId).not.toBe(bodies[0].requestId); // fresh message → fresh id
  });

  it("ev sahibinin elle cevabı 'İşletme ekibi' etiketi + kişi avatarıyla görünür; 'görüşmeye katıldı' çizgisi YOK (kurucu 11-11)", async () => {
    setupFetch([
      { id: "g1", role: "guest", text: "Klima bozuk" },
      { id: "h1", role: "host", text: "Hemen ilgileniyorum, kusura bakmayın.", time: "07:29" },
    ]);
    const { container } = render(<GuestChat token="t" />);

    await screen.findByText("Hemen ilgileniyorum, kusura bakmayın.");
    await screen.findByText("İşletme ekibi"); // ekip etiketi — emoji öneki yok, kişisel ad yok
    expect(screen.getByText("07:29")).toBeTruthy(); // Airbnb'deki gibi etiketin yanında saat
    expect(container.querySelectorAll('[data-avatar="host"]')).toHaveLength(1);
    expect(container.querySelector('[data-avatar="ai"]')).toBeNull(); // insan mesajı marka işaretini taşımaz
    // ⬅️ ESKİDE araya "İşletme ekibi görüşmeye katıldı" çizgisi giriyordu: tek cevap yazmak konuşmayı devralmak değildir.
    expect(screen.queryByText(/görüşmeye katıldı/)).toBeNull();
    expect(container.textContent).not.toMatch(/👥|🤖/);
  });

  it("shows the 'AI re-enabled' separator (no bubble) after the host resumes the AI", async () => {
    setupFetch([
      { id: "g1", role: "guest", text: "Klima bozuk" },
      { id: "h1", role: "host", text: "Ben ilgileniyorum." },
      { id: "r1", role: "resume", text: "Lixus AI yeniden etkinleştirildi" },
      { id: "a1", role: "ai", text: "Çöp salı günü." },
    ]);
    const { container } = render(<GuestChat token="t" />);

    await screen.findByText("Çöp salı günü."); // AI answers again after resume
    expect(screen.queryByText(/görüşmeye katıldı/)).toBeNull();
    // The resume marker renders ONLY as a separator, never as a chat bubble → its
    // text appears exactly once.
    expect(screen.getAllByText("Lixus AI yeniden etkinleştirildi")).toHaveLength(1);
    expect(container.querySelectorAll('[data-avatar="host"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-avatar="ai"]')).toHaveLength(1);
    // 🚨 İşaretin KENDİSİ de role bağlı (yalnız etiket değil): marka işareti (32'lik çizim alanı) yapay zekâda, insanda YOK.
    const BRAND_VIEWBOX = "0 0 32 32";
    expect(container.querySelector('[data-avatar="ai"] svg')?.getAttribute("viewBox")).toBe(BRAND_VIEWBOX);
    const hostIcon = container.querySelector('[data-avatar="host"] svg');
    expect(hostIcon).not.toBeNull();
    expect(hostIcon?.getAttribute("viewBox")).not.toBe(BRAND_VIEWBOX);
  });

  it("saat yalnız sunucu verdiyse çizilir: misafirin kendi mesajında üstte, saati olmayan satırda hiç", async () => {
    setupFetch([
      { id: "g1", role: "guest", text: "Çöp ne zaman?", time: "21:05" },
      { id: "a1", role: "ai", text: "Çöp salı günü.", time: "21:06" },
      { id: "a2", role: "ai", text: "Başka sorunuz olursa yazın." },
    ]);
    render(<GuestChat token="t" />);
    await screen.findByText("Başka sorunuz olursa yazın.");
    expect(screen.getByText("21:05")).toBeTruthy();
    expect(screen.getByText("21:06")).toBeTruthy();
    expect(screen.getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(2); // saatsiz satıra saat uydurulmaz
  });

  it("labels the bot reply as 'Lixus AI'", async () => {
    setupFetch([{ id: "a1", role: "ai", text: "Çöp salı günü." }]);
    render(<GuestChat token="t" />);
    await screen.findByText("Çöp salı günü.");
    await screen.findByText("Lixus AI"); // gönderen etiketi (emoji öneki yok); başlık "Lixus AI Misafir Asistanı" ayrı metin
  });

  it("shows the branded assistant title (never an internal property name)", async () => {
    setupFetch([]);
    render(<GuestChat token="t" />);
    // The header shows the fixed brand. The only place name it can show is the host's separate "misafire görünen ad" (U4,
    // `placeName`) — never the private Property.name (the page passes `guestDisplayName`, see the integration test).
    await screen.findByText("Lixus AI Misafir Asistanı");
    // The AI-disclosure notice appears ONCE under the title (not per message).
    await screen.findByText(/Gerektiğinde işletme ekibi görüşmeye katılabilir/);
  });

  it("U4: misafire görünen ad verildiyse başlık '<ad> · Misafir Asistanı' (TR) / '<ad> · Guest Assistant' (EN)", async () => {
    setupFetch([]);
    render(<GuestChat token="t" placeName="Deniz Manzaralı Daire" />);
    await screen.findByText("Deniz Manzaralı Daire · Misafir Asistanı");
    expect(screen.queryByText("Lixus AI Misafir Asistanı")).toBeNull();
    cleanup();
    setupFetch([]);
    render(<GuestChat token="t" locale="en" placeName="Sea View Flat" />);
    await screen.findByText("Sea View Flat · Guest Assistant");
  });

  it("U4: kod ekranında da aynı başlık; ad boşsa yalnız marka", async () => {
    const fn = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) }));
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" placeName="Deniz Manzaralı Daire" />);
    await screen.findByPlaceholderText("Sohbet kodu");
    expect(screen.getByText("Deniz Manzaralı Daire · Misafir Asistanı")).toBeTruthy();
    cleanup();
    setupFetch([]);
    render(<GuestChat token="t" placeName={null} />);
    await screen.findByText("Lixus AI Misafir Asistanı");
  });

  it("shows a friendly error when the POST fails", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ open: true, messages: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" />);

    typeAndSend("merhaba");

    await screen.findByText(/yanıt veremiyorum/);
  });

  it("PIN gate: shows the PIN entry when the server requires it, then unlocks", async () => {
    // GET reports pinRequired until an unlock POST succeeds; then GET returns the thread.
    let unlocked = false;
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        return unlocked
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, messages: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }] }) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) });
      }
      // POST unlock
      const body = JSON.parse(String(opts!.body)) as { pin?: string };
      if (body.pin === "123456") {
        unlocked = true;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ unlocked: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pinRequired: true, pinError: true }) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok" />);

    // PIN entry visible.
    const input = await screen.findByPlaceholderText("Sohbet kodu");
    // Wrong PIN → generic error.
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Sohbeti aç/ }));
    await screen.findByText(/Kod hatalı/);
    // Correct PIN → unlocks and the chat thread loads.
    fireEvent.change(screen.getByPlaceholderText("Sohbet kodu"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Sohbeti aç/ }));
    await screen.findByText("Hoş geldiniz.");
    const postPin = fn.mock.calls.find((c) => {
      const b = (c[1] as RequestInit | undefined)?.body;
      return b && JSON.parse(String(b)).pin === "123456";
    });
    expect(postPin).toBeTruthy();
  });

  it("PIN gate: too many attempts shows a rate-limit message", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) });
      return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" />);
    fireEvent.change(await screen.findByPlaceholderText("Sohbet kodu"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: /Sohbeti aç/ }));
    await screen.findByText(/Çok fazla deneme/);
  });

  // ── U2 (kurucu 10-22): İngilizce tarayıcıda ekranın kendisi İngilizce; `lang` ekran okuyucu için. ──
  it("locale=en: başlık, açıklama, yazma kutusu, Gönder, ayraç ve gönderen etiketleri İngilizce; kök `lang=en`", async () => {
    setupFetch([{ id: "h1", role: "host", text: "Hi, this is your host." }]);
    const { container } = render(<GuestChat token="t" locale="en" />);
    await screen.findByText("Lixus AI Guest Assistant");
    expect(screen.getByText(/Our team can join the conversation/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Type your question…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    await screen.findByText("Host team");
    expect(screen.queryByText(/joined the conversation/)).toBeNull();
    expect(container.querySelector('[lang="en"]')).not.toBeNull();
    expect(screen.queryByText(/Sorunuzu yazın|Gönder|İşletme ekibi/)).toBeNull();
  });

  it("locale=en: sunucunun Türkçe sebep metni yerine İngilizce genel hata (Türkçe cümle yabancı misafire bir şey söylemez)", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ open: true, messages: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({ error: "Çok fazla istek. Lütfen biraz bekleyin." }) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" locale="en" />);
    fireEvent.change(await screen.findByPlaceholderText("Type your question…"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("I can't reply right now. Please try again shortly.");
    expect(screen.queryByText(/Çok fazla istek/)).toBeNull();
  });

  it("locale=en PIN ekranı: 'Chat code', kapı kodu olmadığı yazılı (U3)", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pinRequired: true, pinError: true }) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" locale="en" />);
    const input = await screen.findByPlaceholderText("Chat code");
    expect(screen.getByText(/This is not the door code/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("Wrong code. Please check the chat code we gave you.");
  });

  // FB tur 2 (11-20): yanlış kod hatası ekran okuyucuya SESSİZDİ — duyurulmuyor, kutuya bağlı değildi. Metin aynı; yalnız bağ + duyuru.
  it("yanlış sohbet kodu: hata DUYURULUR (role=alert) ve kutuya bağlanır (aria-invalid + aria-describedby); hata yokken bağ da yok", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pinRequired: true, pinError: true }) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" />);
    const input = await screen.findByPlaceholderText("Sohbet kodu");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Sohbeti aç" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Kod hatalı. Size verdiğimiz sohbet kodunu kontrol edin.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Bağlanan düğüm GERÇEKTEN hata metnini taşır (kimlik eşleşmesi yetmez).
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBe(alert);
  });

  it("sohbet akışı ekran okuyucuya duyurulan bir günlüktür (role=log, kibar kip): yeni cevap bu bölgenin içine düşer", async () => {
    setupFetch([{ id: "a1", role: "ai", text: "Çöp salı günü." }]);
    render(<GuestChat token="t" />);
    const reply = await screen.findByText("Çöp salı günü.");
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.contains(reply)).toBe(true);
    // Yazma kutusu günlüğün DIŞINDA (yazarken her tuş duyurulmaz).
    expect(log.contains(screen.getByPlaceholderText(/Sorunuzu yazın/))).toBe(false);
  });

  it("varsayılan (Türkçe) PIN ekranında da kapı kodu olmadığı yazılı (U3)", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true, pinRequired: true, messages: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" />);
    await screen.findByPlaceholderText("Sohbet kodu");
    expect(screen.getByText(/Bu kod kapı kodu değildir/)).toBeTruthy();
  });
});
