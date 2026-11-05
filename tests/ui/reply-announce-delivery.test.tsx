// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-05 (43fb93e incelemesi P2): elle cevap duyurusu HTTP kodundan seçiliyordu — tekilleşen kuyruk tekrarı (aynı istek kimliği)
// 200 döner ve ekran okuyucuya "Mesaj gönderildi." deniyordu; oysa satır hâlâ sırada ya da başarısız olabilir. Karar artık sunucunun
// döndürdüğü AÇIK durumdan (`outbox.delivery`); metinler mevcut olanlar (kuyruk notu + mesaj balonunun durum etiketi).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

const props = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Merhaba", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

const QUEUED_NOTE = "Mesaj sıraya alındı — birazdan gönderilecek.";

async function sendWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(url.endsWith("/reply") ? new Response(JSON.stringify(body), { status }) : new Response("[]", { status: 200 })),
    ),
  );
  render(<ConversationThread {...props} />);
  fireEvent.change(screen.getByPlaceholderText(/Cevabınızı yazın/), { target: { value: "Havlular dolapta" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Gönder$/ }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("elle cevap duyurusu — açık durumdan", () => {
  it("🚨 tekilleşen 200 + satır hâlâ SIRADA → 'gönderildi' DENMEZ, kuyruk notu gösterilir", async () => {
    await sendWith(200, { id: "x", outbox: { status: "queued", deduped: true, delivery: "pending" } });
    expect(screen.getByText(QUEUED_NOTE)).toBeTruthy();
    expect(screen.queryByText("Mesaj gönderildi.")).toBeNull();
  });

  it("🚨 tekilleşen 200 + satır BAŞARISIZ → balonun etiketi duyurulur ('Gönderilemedi'), 'gönderildi' denmez", async () => {
    await sendWith(200, { id: "x", outbox: { status: "queued", deduped: true, delivery: "failed" } });
    expect(screen.getAllByText("Gönderilemedi").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mesaj gönderildi.")).toBeNull();
    expect(screen.queryByText(QUEUED_NOTE)).toBeNull();
  });

  it("tekilleşen 200 + satır GÖNDERİLMİŞ → 'Mesaj gönderildi.'", async () => {
    await sendWith(200, { id: "x", outbox: { status: "queued", deduped: true, delivery: "sent" } });
    expect(screen.getByText("Mesaj gönderildi.")).toBeTruthy();
    expect(screen.queryByText(QUEUED_NOTE)).toBeNull();
  });

  it("KONTROL — yeni kuyruk satırı (202) → kuyruk notu (bugünkü gibi)", async () => {
    await sendWith(202, { id: "x", outbox: { status: "queued", deduped: false, delivery: "pending" } });
    expect(screen.getByText(QUEUED_NOTE)).toBeTruthy();
    expect(screen.queryByText("Mesaj gönderildi.")).toBeNull();
  });

  it("KONTROL — doğrudan teslim (201, kuyruk yok) → 'Mesaj gönderildi.' (bugünkü gibi)", async () => {
    await sendWith(201, { id: "x" });
    expect(screen.getByText("Mesaj gönderildi.")).toBeTruthy();
  });
});
