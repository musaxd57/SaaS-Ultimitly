// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { GuestChatThread, type GuestChatMessage } from "@/components/guest-chat/guest-chat-thread";
import { GUEST_COPY } from "@/components/guest-chat/guest-chat-copy";

// ---------------------------------------------------------------------------
// UX-1 (kurucu onayı 11-13): QR sohbetinde cevap gelmeyince misafir ekranı hiçbir şey söylemiyordu; misafir aynı soruyu yeniden yazıyordu
// (UX denetimi B001 B007 B017). Karar: CÜMLE YOK (K10 — "mesajınız alındı / iletildi" gibi bildirim cümlesi misafire gitmez), yalnız son
// kaydedilmiş misafir balonunun altında küçük "Gönderildi" / "Sent".
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const g = (id: string, time?: string): GuestChatMessage => ({ id, role: "guest", text: `soru ${id}`, ...(time ? { time } : {}) });
const marks = (container: HTMLElement) => [...container.querySelectorAll("[data-guest-sent]")];

describe("misafir QR sohbeti — 'Gönderildi' işareti", () => {
  it("son satır misafirin kaydedilmiş mesajıysa altında yalnız 'Gönderildi' (tek işaret, son balonun içinde)", () => {
    const { container } = render(<GuestChatThread messages={[g("1", "04:08"), g("2", "04:10")]} />);
    const m = marks(container);
    expect(m).toHaveLength(1);
    expect(m[0].textContent).toBe("Gönderildi");
    expect(m[0].parentElement!.textContent).toContain("soru 2");
    expect(m[0].parentElement!.textContent).not.toContain("soru 1");
  });

  it("İngilizce ekranda 'Sent'", () => {
    const { container } = render(<GuestChatThread messages={[g("1", "04:08")]} locale="en" />);
    expect(marks(container).map((e) => e.textContent)).toEqual(["Sent"]);
  });

  it("arkasından cevap geldiyse işaret yok (cevap yeterli işaret)", () => {
    for (const role of ["ai", "host"] as const) {
      const { container, unmount } = render(<GuestChatThread messages={[g("1", "04:08"), { id: "r", role, text: "cevap", time: "04:09" }]} />);
      expect(marks(container), role).toHaveLength(0);
      unmount();
    }
  });

  it("gönderilmekte olan (henüz kaydedilmemiş, saati yok) satırda işaret yok", () => {
    const { container } = render(<GuestChatThread messages={[g("1", "04:08"), { id: "r", role: "ai", text: "cevap", time: "04:09" }, g("tmp")]} />);
    expect(marks(container)).toHaveLength(0);
  });

  it("boş akış ve 'yeniden etkinleştirildi' ayracıyla biten akış: işaret yok", () => {
    expect(marks(render(<GuestChatThread messages={[]} />).container)).toHaveLength(0);
    cleanup();
    expect(marks(render(<GuestChatThread messages={[g("1", "04:08"), { id: "x", role: "resume", text: "" }]} />).container)).toHaveLength(0);
  });

  it("🚨 K10: işaret bir CÜMLE değil — tek sözcük, bildirim / devir / söz içermez (iki dil)", () => {
    for (const loc of ["tr", "en"] as const) {
      const s = GUEST_COPY[loc].sent;
      expect(s.split(/\s+/)).toHaveLength(1);
      expect(s).not.toMatch(/[.!?]/);
      expect(s).not.toMatch(/ilet|bilgilendir|kaydedil|al[ıi]nd|yan[ıi]t|okundu|ev sahib|forward|notif|reply|read|host/i);
    }
  });
});

describe("UX-9 (kurucu onayı 11-13): konaklama dışı ekranı tek, sızıntısız metin", () => {
  it("girişten önce / çıkıştan sonra / boş daire AYRIMI yapmaz; 'giriş gününüz' ve iç terim 'aktif' yok; ipucu kutusu yok", () => {
    expect(GUEST_COPY.tr.inactiveTitle).toBe("Bu sohbet yalnız konaklama süresince açık");
    expect(GUEST_COPY.tr.inactiveBody).toBe("Bize rezervasyon yaptığınız uygulamanın mesajlarından yazabilirsiniz.");
    expect(GUEST_COPY.en.inactiveTitle).toBe("This chat is open only during your stay");
    expect(GUEST_COPY.en.inactiveBody).toBe("You can message us through the app you booked with.");
    for (const loc of ["tr", "en"] as const) {
      const all = `${GUEST_COPY[loc].inactiveTitle} ${GUEST_COPY[loc].inactiveBody}`;
      expect(all).not.toMatch(/giriş gün|check-in day|aktif|active|sona er|ended|henüz|not yet/i);
      expect("inactiveHint" in GUEST_COPY[loc]).toBe(false);
    }
  });
});
