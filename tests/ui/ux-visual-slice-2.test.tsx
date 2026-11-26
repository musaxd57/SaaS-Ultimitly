// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Inbox } from "lucide-react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { StatCard } from "@/components/stat-card";
import { DeleteConversationButton } from "@/components/inbox/delete-conversation-button";

// ---------------------------------------------------------------------------
// UX denetimi 11-13 (İE-2) — görünen metin ve ekran okuyucunun okuduğu ad DEĞİŞMEDİ; yalnız görsel işaret / aralık eklendi.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("StatCard — bağlantılı kutucukta ok", () => {
  it("bağlantılıyken etiketin yanında ekran okuyucudan gizli bir ok; bağlantının erişilebilir adı yalnız etiket + değer", () => {
    render(<StatCard label="Bekleyen mesaj" value={3} icon={Inbox} href="/inbox" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/inbox");
    expect(link.textContent).toBe("Bekleyen mesaj3");
    const label = screen.getByText("Bekleyen mesaj");
    const arrow = label.querySelector("svg");
    expect(arrow).not.toBeNull();
    expect(arrow!.getAttribute("aria-hidden")).toBe("true");
  });

  it("bağlantısızken ok yok (ölü kutucuk bağlantı gibi görünmez)", () => {
    render(<StatCard label="Aynı gün devir" value={0} icon={Inbox} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Aynı gün devir").querySelector("svg")).toBeNull();
  });
});

describe("DeleteConversationButton — aralık eklendi, yazı aynı", () => {
  it("düğme 'Sil' yazar ve komşusundan ayrılan aralık sınıfını taşır", () => {
    render(<DeleteConversationButton conversationId="c1" />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("Sil");
    expect(btn.className.split(/\s+/)).toContain("ml-4");
  });
});
