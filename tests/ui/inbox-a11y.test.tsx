// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// Inbox, panelin en çok kullanılan ekranı ama ana operasyon kontrolleri yalnız
// GÖRSEL olarak tanımlıydı (Codex): durum/öncelik seçimleri <span> ile
// "etiketlenmiş", cevap kutusunun adı sadece placeholder, şablon açılır yüzeyi
// düz bir <div> — role yok, Escape yok, odak yönetimi yok.

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

const baseProps = {
  conversationId: "conv-1",
  messages: [
    {
      id: "m1",
      direction: "inbound",
      body: "Merhaba, wifi şifresi nedir?",
      createdAt: new Date("2026-01-01T10:00:00Z"),
      senderName: "Ada",
    },
  ],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

describe("ConversationThread — operasyon kontrollerinin erişilebilir adı", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("durum ve öncelik seçimleri GERÇEK etiketle bağlı (span değil)", () => {
    render(<ConversationThread {...baseProps} />);
    expect(screen.getByLabelText("Durum")).toBeTruthy();
    expect(screen.getByLabelText("Öncelik")).toBeTruthy();
  });

  it("cevap kutusunun adı placeholder DEĞİL, gerçek bir etiket", () => {
    render(<ConversationThread {...baseProps} />);
    const box = screen.getByLabelText("Misafire cevabınız");
    expect(box.tagName).toBe("TEXTAREA");
  });

  it("gönderim hatası kutuya BAĞLI ve DUYURULUR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Gönderilemedi" }), { status: 500 })));
    render(<ConversationThread {...baseProps} />);
    const box = screen.getByLabelText("Misafire cevabınız");
    fireEvent.change(box, { target: { value: "Merhaba" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gönder/ }));
    });
    const alert = await screen.findByRole("alert");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("ConversationThread — şablon açılır yüzeyi dialog sözleşmesi", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ templates: [{ id: "t1", name: "Hoş geldiniz", body: "Merhaba" }] }), {
          status: 200,
        }),
      ),
    );
  });

  async function openTemplates() {
    render(<ConversationThread {...baseProps} />);
    const trigger = screen.getByRole("button", { name: /Şablonlar/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false"); // kapalıyken durum bildirilir
    await act(async () => {
      fireEvent.click(trigger);
    });
    return trigger;
  }

  it("tetikleyici durumu bildirir; panel ADLANDIRILMIŞ bir dialog'dur", async () => {
    const trigger = await openTemplates();
    const dialog = await screen.findByRole("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    // Erişilebilir ad: paneli duyan kullanıcı neye baktığını bilir.
    const labelId = dialog.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toBe("Mesaj Şablonları");
  });

  it("açılınca odak panele girer", async () => {
    await openTemplates();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("Escape kapatır ve odağı TETİKLEYİCİYE geri verir", async () => {
    const trigger = await openTemplates();
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Odak sayfanın başına düşmez — kullanıcı yerini kaybetmez.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("dışarı tıklama kapatır (tek çıkış yolu küçük X değil)", async () => {
    await openTemplates();
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("ConversationThread — odak kaybı ve sessiz başarı", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("mesaj geçmişi klavyeyle kaydırılabilir ve ADLANDIRILMIŞ", () => {
    render(<ConversationThread {...baseProps} />);
    const history = screen.getByRole("group", { name: "Mesaj geçmişi" });
    // Kutunun içinde odak durağı olmayan giden mesajlar da vardı; kutunun
    // KENDİSİ odaklanabilir olmadan ok tuşlarıyla kaydırmak mümkün değildi.
    expect(history.getAttribute("tabindex")).toBe("0");
  });

  it("BAŞARILI gönderimde duyuru yapılır ve odak yazma kutusuna DÖNER", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    render(<ConversationThread {...baseProps} />);
    const box = screen.getByLabelText("Misafire cevabınız");
    fireEvent.change(box, { target: { value: "Merhaba" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gönder/ }));
    });

    // Eskiden 200 dalı TAMAMEN sessizdi (yalnız hata ve 202 duyuruluyordu).
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Mesaj gönderildi."),
    );
    // Buton başarıdan sonra `!composer.trim()` ile disabled kalıyor → odak
    // <body>'ye düşüyordu.
    expect(document.activeElement).toBe(box);
  });

  it("durum değişiminde başarı DUYURULUR ve odak seçime döner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    render(<ConversationThread {...baseProps} />);
    const select = screen.getByLabelText("Durum");
    await act(async () => {
      fireEvent.change(select, { target: { value: "problem" } });
    });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Durum güncellendi."),
    );
    expect(document.activeElement).toBe(select);
  });
});

describe("ConversationThread — canlı bölge TEKRAR duyurur", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("art arda İKİ gönderim de duyurulur (aynı metin sessizleşmemeli)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    render(<ConversationThread {...baseProps} />);
    const box = screen.getByLabelText("Misafire cevabınız");

    async function send(text: string) {
      fireEvent.change(box, { target: { value: text } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Gönder/ }));
      });
    }

    await send("Birinci");
    const live = screen.getByRole("status");
    const firstNode = live.firstElementChild;
    expect(live.textContent).toContain("Mesaj gönderildi.");

    await send("İkinci");
    // aria-live YALNIZ DOM değişiminde duyurur. Aynı metni tekrar set etmek
    // React'te no-op'tur (Object.is) → metin düğümü hiç değişmez → ekran
    // okuyucu İKİNCİ gönderimi HİÇ duymaz. Yeni bir düğüm eklenmeli.
    expect(live.firstElementChild).not.toBe(firstNode);
    expect(live.textContent).toContain("Mesaj gönderildi.");
  });
});

// ---------------------------------------------------------------------------
// KALAN ODAK KAYIPLARI — gönderim/durum/öncelik için kapatılan sınıfın aynısı:
// `disabled` olan kontrol odağı <body>'ye düşürür ve yeniden etkinleşince odak
// KENDİLİĞİNDEN geri gelmez. Bu dosyada daha önce sendReply ve changeField
// kapatılmıştı; çeviri ve AI-öner aynı gözle taranmamıştı.
// ---------------------------------------------------------------------------
describe("ConversationThread — çeviri ve AI-öner odak iadesi", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const suggestion = JSON.stringify({
    intent: "general",
    confidence: 0.9,
    reply: "Merhaba, memnuniyetle yardımcı olurum.",
    risk: null,
    source: "fallback",
    riskLevel: "none",
    usedSources: [],
    missingInfo: [],
    detectedLanguage: "tr",
  });

  it("çeviri bitince odak ÇEVİR düğmesine döner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ translation: "Hello" }), { status: 200 })),
    );
    render(<ConversationThread {...baseProps} />);
    const btn = screen.getByRole("button", { name: /Çevir/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    // Düğme istek boyunca disabled → odak body'ye düşmüştü; geri gelmeli.
    expect(document.activeElement).toBe(btn);
  });

  it("AI önerisi gelince odak ÖNER düğmesine döner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(suggestion, { status: 200 })));
    render(<ConversationThread {...baseProps} />);
    const btn = screen.getByRole("button", { name: "AI cevap öner" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(document.activeElement).toBe(btn);
  });

  it("NUDGE'dan tetiklenince (düğme unmount olur) odak kalıcı öner düğmesine düşer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(suggestion, { status: 200 })));
    render(<ConversationThread {...baseProps} />);
    // Nudge kartı `!suggestLoading` koşullu: tıklanan düğme tıklandığı ANDA
    // DOM'dan kalkar — istek bitince odak verilecek hedef artık yok. Yedek
    // hedef: hâlâ ekranda duran "AI cevap öner".
    const nudge = screen.getByRole("button", { name: "AI ile cevapla" });
    await act(async () => {
      fireEvent.click(nudge);
    });
    expect(screen.queryByRole("button", { name: "AI ile cevapla" })).toBeNull(); // gerçekten unmount
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "AI cevap öner" }));
  });

  it("AĞ HATASINDA da gönderim odağı yazma kutusuna döner (yalnız başarıda değil)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ağ koptu"))));
    render(<ConversationThread {...baseProps} />);
    const box = screen.getByLabelText("Misafire cevabınız");
    fireEvent.change(box, { target: { value: "Merhaba" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gönder/ }));
    });
    // Hata role="alert" ile duyuruluyor; metin kutuda duruyor — düzeltmenin
    // doğal yeri orası. Eskiden odak iadesi try içindeydi, catch yolu atlıyordu.
    expect(document.activeElement).toBe(box);
  });
});

describe("HospitableSyncButton — odak iadesi", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("çekme bitince odak düğmeye döner (sonuç zaten role=status ile duyuruluyor)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: true, properties: 1, reservations: 2, conversations: 3, messages: 4 }),
          { status: 200 },
        ),
      ),
    );
    const { HospitableSyncButton } = await import("@/components/inbox/hospitable-sync-button");
    render(<HospitableSyncButton />);
    const btn = screen.getByRole("button", { name: /Mesajları çek/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(document.activeElement).toBe(btn);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI ÖNERİ PANELİ — KAPATMA YOLU (kullanıcı gözlemi, 08-09)
// Panel açıldıktan sonra kapanmanın İKİ yolu vardı ve ikisi de host'u bir eylem
// yapmaya zorluyordu: yeni öneri istemek ya da mesaj GÖNDERMEK. Öneriyi
// beğenmeyen host için çıkış yoktu — aynı dosyadaki şablon panelinin ZATEN
// sahip olduğu düğme burada eksikti. Bu blok üç şeyi birden pinler: düğme VAR ·
// panel gerçekten kapanır · kapanınca "AI ile cevapla" davetiyesi GERİ GELİR
// (yani host çıkmaza girmez, fikrini değiştirirse tekrar isteyebilir).
// ─────────────────────────────────────────────────────────────────────────────
describe("ConversationThread — AI öneri paneli kapatılabilir", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function openSuggestion() {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          reply: "Wifi şifresi: kapıdaki kartta yazıyor.",
          intent: "wifi",
          confidence: 0.9,
          riskLevel: "none",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationThread {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI ile cevapla/ }));
    });
    await screen.findByText("AI Önerisi");
    return fetchMock;
  }

  it("kapatma düğmesi paneli kaldırır ve SUNUCUYA İSTEK ATMAZ", async () => {
    const fetchMock = await openSuggestion();
    expect(fetchMock).toHaveBeenCalledTimes(1); // yalnız öneri isteği

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI önerisini kapat" }));
    });

    expect(screen.queryByText("AI Önerisi")).toBeNull();
    // Kapatmak bir KAYDETME değil: ikinci bir fetch olmamalı.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("kapatınca 'AI ile cevapla' davetiyesi GERİ GELİR (çıkmaz yok)", async () => {
    await openSuggestion();
    // Panel açıkken davetiye gizli (koşul: !suggestion).
    expect(screen.queryByRole("button", { name: /AI ile cevapla/ })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI önerisini kapat" }));
    });
    expect(screen.getByRole("button", { name: /AI ile cevapla/ })).toBeTruthy();
  });
});
