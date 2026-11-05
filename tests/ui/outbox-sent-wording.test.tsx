// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-05 (kurucunun aktardığı teknik doğrulama): "Sağlayıcının kabulü ile misafire teslim ayrılmalı. Sağlayıcı teslim bilgisi
// vermiyorsa arayüz kesin teslim iddiasında bulunmamalı." Kuyruğun `sent` durumu = kanal sağlayıcısı KABUL ETTİ (`outbox/worker.ts`); teslim /
// okundu bilgisi gelmiyor. Eskiden balon "İletildi" + ÇİFT tik (WhatsApp'taki "ulaştı" işareti) gösteriyordu.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { ConversationThread } from "@/components/inbox/conversation-thread";

afterEach(() => cleanup());

describe("gönderim durumu — kabul ≠ teslim", () => {
  it("🚨 kuyruktan 'sent' balonu 'Gönderildi' der, 'İletildi' DEMEZ", () => {
    const props = {
      conversationId: "conv-1",
      messages: [
        { id: "m1", direction: "inbound", body: "Merhaba", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" },
        { id: "m2", direction: "outbound", body: "Hoş geldiniz", createdAt: new Date("2026-01-01T10:05:00Z"), senderName: "Ev Sahibi", outboxStatus: "sent" },
      ],
      status: "answered",
      priority: "standard",
      propertyId: "prop-1",
      templateVars: {},
      canReply: true,
    } as unknown as React.ComponentProps<typeof ConversationThread>;
    render(<ConversationThread {...props} />);
    expect(screen.getByText("Gönderildi")).toBeTruthy();
    expect(screen.queryByText("İletildi")).toBeNull();
  });

  it("🚨 gönderim kuyruğu sayfası 'ulaştı / teslim' iddia etmez", () => {
    const queue = readFileSync("src/app/(app)/sent/queue/page.tsx", "utf8");
    expect(queue).toContain('sent: { label: "Gönderildi", tone: "success" }');
    expect(queue).not.toContain('"İletildi"');
    // Opus 11-06 N12: küçük harfli "· iletildi <an>" satırı da (yorum satırları hariç) — sağlayıcı kabulü teslim değildir.
    const code = queue
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/iletildi/i);
    expect(queue).not.toMatch(/ulaştı, bekliyor ya da ulaşamadı/);
    expect(queue).not.toMatch(/mesajların teslim durumu/);
  });
});
