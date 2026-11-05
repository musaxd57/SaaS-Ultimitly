// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Opus dilim sonu incelemesi (11-05) — istemci düzeltmeleri:
//  F12 eski Safari'de `crypto.randomUUID` yok → misafirin mesajı gönderilmiş gibi duruyor ama hiç gitmiyordu;
//  F2  gönderimden ÖNCE başlamış yavaş sorgu, gönderim sürerken iyimser balonu siliyordu;
//  F3  ekran kurulumu yeniden koşunca (StrictMode / anahtar değişimi) ilk yükleme bir tam tur (5 sn) gecikiyordu;
//  F9  yazma kutusu boşaltılıp aynı metin saatler sonra yeniden yazılınca ESKİ kimlik kullanılıyordu (24 sa "az önce gönderildi");
//  F6  tekilleşen tekrarın satırı GÖNDERİLEMEDİ iken yazılan metin teslim edilmiş gibi siliniyordu.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestChat } from "@/components/guest-chat/guest-chat";
import { ConversationThread } from "@/components/inbox/conversation-thread";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
async function flush(n = 8) {
  await act(async () => {
    for (let i = 0; i < n; i++) await Promise.resolve();
  });
}

function setVisible() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("QR sohbeti — gönderim", () => {
  beforeEach(setVisible);

  it("🚨 F12: tarayıcıda crypto.randomUUID YOKSA da mesaj gider; kimlik sunucu biçimine uyar", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    const posts: { requestId?: string; message?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return json(200, {});
        }
        return json(200, { open: true, messages: [] });
      }),
    );
    render(<GuestChat token="tok-f12" />);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Sorunuzu yazın…"), { target: { value: "Havlu var mı?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await flush(12);
    expect(posts).toHaveLength(1);
    expect(posts[0].message).toBe("Havlu var mı?");
    expect(posts[0].requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("🚨 F2: gönderimden ÖNCE başlamış yavaş sorgu, gönderim sürerken dönse de iyimser balonu SİLMEZ", async () => {
    vi.useFakeTimers();
    let gets = 0;
    let releasePost: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Promise<Response>((resolve) => (releasePost = () => resolve(json(200, {}))));
        gets += 1;
        if (gets === 1) return Promise.resolve(json(200, { open: true, messages: [] }));
        // 2. sorgu: gönderimden önce başlar, 2 sn sonra ESKİ (boş) anlık görüntüyle döner — iptali yok sayan yavaş ağ.
        return new Promise<Response>((resolve) => setTimeout(() => resolve(json(200, { open: true, messages: [] })), 2_000));
      }),
    );
    render(<GuestChat token="tok-f2" />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(5_100); // 2. sorgu uçuşta
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(gets).toBe(2);
    fireEvent.change(screen.getByPlaceholderText("Sorunuzu yazın…"), { target: { value: "Havlu var mı?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await act(async () => {
      vi.advanceTimersByTime(2_500); // eski sorgu döndü; POST hâlâ bekliyor
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(screen.getByText("Havlu var mı?")).toBeTruthy();
    await act(async () => {
      releasePost?.();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  });

  it("F3: ekran kurulumu iki kez koşsa da (StrictMode) ilk yükleme beklemez — bir tam tur gecikme yok", async () => {
    vi.useFakeTimers();
    // Gerçek fetch gibi: iptal edilen istek REDDEDİLİR (sonucu gelmez).
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const t = setTimeout(() => resolve(json(200, { open: true, messages: [{ id: "a1", role: "ai", text: "Hoş geldiniz." }] })), 300);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      ),
    );
    render(
      <StrictMode>
        <GuestChat token="tok-f3" />
      </StrictMode>,
    );
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(screen.getByText("Hoş geldiniz.")).toBeTruthy();
  });
});

describe("gelen kutusu yazma alanı — istek kimliği", () => {
  const props = {
    conversationId: "conv-1",
    messages: [{ id: "m1", direction: "inbound", body: "Merhaba", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
    status: "new",
    priority: "standard",
    propertyId: "prop-1",
    templateVars: {},
    canReply: true,
  } as unknown as React.ComponentProps<typeof ConversationThread>;
  const area = () => screen.getByPlaceholderText(/Cevabınızı yazın/) as HTMLTextAreaElement;
  const sendBtn = () => screen.getByRole("button", { name: /^Gönder$/ });

  function capture(replies: (() => Promise<Response>)[]) {
    const ids: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/reply")) {
          ids.push(JSON.parse(String(init?.body)).requestId);
          return (replies.shift() ?? (async () => json(201, { id: "x" })))();
        }
        return json(200, []);
      }),
    );
    return ids;
  }

  it("🚨 F9: yanıtı kaybolan gönderimden sonra kutu boşaltılıp aynı metin YENİDEN yazılırsa YENİ kimlik (yeni mesaj)", async () => {
    const ids = capture([async () => Promise.reject(new TypeError("network"))]);
    render(<ConversationThread {...props} />);
    fireEvent.change(area(), { target: { value: "Tamam" } });
    await act(async () => {
      fireEvent.click(sendBtn());
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    fireEvent.change(area(), { target: { value: "" } });
    fireEvent.change(area(), { target: { value: "Tamam" } });
    await act(async () => {
      fireEvent.click(sendBtn());
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("KONTROL — kutu aynı metni tutarken tekrar basmak AYNI kimliği taşır (yanıtı kaybolan gönderimin tekrarı)", async () => {
    const ids = capture([async () => Promise.reject(new TypeError("network"))]);
    render(<ConversationThread {...props} />);
    fireEvent.change(area(), { target: { value: "Tamam" } });
    for (let k = 0; k < 2; k++) {
      await act(async () => {
        fireEvent.click(sendBtn());
        for (let i = 0; i < 8; i++) await Promise.resolve();
      });
    }
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it("🚨 N3: öneriden giden onayın yanıtı kaybolduktan sonra AYNI METİNLİ YENİ taslak gelirse YENİ kimlik; aynı panelde tekrar AYNI kimlik", async () => {
    const ids = capture([async () => Promise.reject(new TypeError("network")), async () => Promise.reject(new TypeError("network"))]);
    const draft = (messageId: string) => ({
      messageId,
      reply: "Rica ederiz, iyi tatiller!",
      intent: "general",
      confidence: 0.9,
      availabilityCheck: null,
      internalSourceCheck: false,
    });
    const { rerender } = render(<ConversationThread {...props} initialDraft={draft("m1")} />);
    const approve = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Onayla ve gönder/ }));
        for (let i = 0; i < 8; i++) await Promise.resolve();
      });
    };
    await approve();
    await approve(); // aynı panel nesnesi: yanıtı kaybolan onayın tekrarı → aynı kimlik (çift gönderim yok)
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    // Misafir yeniden yazdı; yeni mesajın taslağı birebir aynı metin → YENİ mesaj.
    rerender(<ConversationThread {...props} initialDraft={draft("m2")} />);
    await flush();
    await approve();
    expect(ids).toHaveLength(3);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("🚨 F6: tekilleşen tekrarın satırı GÖNDERİLEMEDİ ise yazılan metin KORUNUR ve sebep görünür", async () => {
    capture([async () => json(200, { id: "x", outbox: { status: "queued", deduped: true, delivery: "failed" } })]);
    render(<ConversationThread {...props} />);
    fireEvent.change(area(), { target: { value: "Kapı şifresi 4512" } });
    await act(async () => {
      fireEvent.click(sendBtn());
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(area().value).toBe("Kapı şifresi 4512");
    expect(screen.getAllByText("Gönderilemedi").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mesaj gönderildi.")).toBeNull();
  });
});
