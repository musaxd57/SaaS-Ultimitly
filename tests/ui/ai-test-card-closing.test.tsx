// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { AiTestCard } from "@/components/settings/ai-test-card";

// ---------------------------------------------------------------------------
// Ayarlar "AI cevabını gör" kartı — KAPANIŞA SESSİZLİK önizlemesi (kurucu kuralı 09-25). Gerçek kanal teşekkür/övgüye
// HİÇBİR ŞEY göndermez; kart eskiden övgü için "normal AI akışına düşer, taslak onayınıza sunulur" diyor ve hiç
// gönderilmeyecek bir taslak gösteriyordu. Anlam yolunda ("Anladım") nezaket cevabı da gitmez.
// ---------------------------------------------------------------------------

const BASE = {
  reply: "Rica ederiz, iyi günler!",
  intent: "general",
  confidence: 0.3,
  riskLevel: "none",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  detectedLanguage: "tr",
  statedCheckoutTime: null,
  source: "openai",
  property: "Lale",
  wouldAutoSend: false,
};

async function runWith(result: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })));
  render(<AiTestCard properties={[{ id: "p1", name: "Lale" }]} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Teşekkürler" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /AI cevabını gör/ }));
  });
}

describe("AI test kartı — kapanışa sessizlik", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("🚨 övgü + nezaket kapalı: 'cevap gerekmez' der, gönderilmeyecek taslağı GÖSTERMEZ", async () => {
    await runWith({ ...BASE, closingAck: true, closingKind: "praise", closingReplyEnabled: false, closingReplyPreview: null });
    expect(await screen.findByText(/Bu mesaja cevap gerekmez/)).toBeTruthy();
    expect(screen.queryByText(/normal AI akışına düşer/)).toBeNull();
    expect(screen.queryByText(BASE.reply)).toBeNull();
  });

  it("🚨 anlam yolu ('Anladım'): nezaket AÇIK olsa bile hiçbir şey gönderilmez, önizleme metni YOK", async () => {
    await runWith({
      ...BASE,
      closingAck: true,
      closingKind: "ack",
      closingSemantic: true,
      closingReplyEnabled: true,
      closingReplyPreview: "Rica ederiz!",
    });
    expect(await screen.findByText(/Bu mesaja cevap gerekmez/)).toBeTruthy();
    expect(screen.queryByText(/ŞU mesaj GÖNDERİLİR/)).toBeNull();
    expect(screen.queryByText("Rica ederiz!")).toBeNull();
  });

  it("KONTROL: sözcük yolu + nezaket AÇIK → giden nezaket mesajı birebir gösterilir", async () => {
    await runWith({ ...BASE, closingAck: true, closingKind: "ack", closingReplyEnabled: true, closingReplyPreview: "Rica ederiz!" });
    expect(await screen.findByText(/ŞU mesaj GÖNDERİLİR/)).toBeTruthy();
    expect(screen.getByText("Rica ederiz!")).toBeTruthy();
  });

  it("KONTROL: kapanış olmayan mesaj → taslak gösterilir (bugünkü davranış)", async () => {
    await runWith({ ...BASE, reply: "Giriş 15:00'ten itibaren.", closingAck: false, closingKind: null });
    expect(await screen.findByText("Giriş 15:00'ten itibaren.")).toBeTruthy();
    expect(screen.queryByText(/Bu mesaja cevap gerekmez/)).toBeNull();
  });
});
