// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// B1 (kurucu 10-11, "ev sahibi döngüsü"): taslakta "Eksik bilgi" satırı çıkınca yanında "Bilgi tabanına ekle" bağlantısı — bilgi tabanı
// formu mülk / kategori / başlık ön dolu açılır. Yalnız yönetici (personel bilgi tabanını açamaz) ve mülkü bilinen konuşmada.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Yakında kahvaltı yeri var mı?", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as Props;

async function suggest(props: Partial<Props>, missingInfo: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ intent: "general", confidence: 0.4, reply: "Mesajınız kaydedildi.", risk: null, source: "openai", riskLevel: "none", usedSources: [], missingInfo }),
        { status: 200 },
      ),
    ),
  );
  render(<ConversationThread {...baseProps} {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "AI cevap öner" }));
  });
  await screen.findByText("AI Önerisi");
}

describe("ConversationThread — 'Eksik bilgi' → 'Bilgi tabanına ekle'", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("yer sorusu: bağlantı Yerel Tavsiye + başlık + mülk ön dolu forma gider", async () => {
    await suggest({}, ["Yakındaki kahvaltı yerleri"]);
    const link = screen.getByRole("link", { name: "Bilgi tabanına ekle" });
    const sp = new URLSearchParams(link.getAttribute("href")!.split("?")[1]);
    expect(link.getAttribute("href")!.startsWith("/knowledge?")).toBe(true);
    expect(Object.fromEntries(sp)).toEqual({ property: "prop-1", category: "local_tips", title: "Yakındaki kahvaltı yerleri" });
  });

  it("KONTROL: personel (canReply yok) → öneri paneli hiç yok, bağlantı da yok", () => {
    render(<ConversationThread {...baseProps} canReply={false} />);
    expect(screen.queryByRole("button", { name: "AI cevap öner" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Bilgi tabanına ekle" })).toBeNull();
  });

  it("KONTROL: mülkü bilinmeyen konuşma → bağlantı YOK", async () => {
    await suggest({ propertyId: undefined }, ["Yakındaki kahvaltı yerleri"]);
    expect(screen.queryByRole("link", { name: "Bilgi tabanına ekle" })).toBeNull();
  });

  it("KONTROL: eksik bilgi yok → bağlantı YOK", async () => {
    await suggest({}, []);
    expect(screen.queryByRole("link", { name: "Bilgi tabanına ekle" })).toBeNull();
  });
});
