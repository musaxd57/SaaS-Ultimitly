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
