// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// S1 (kurucu kararı 11-11) — PANEL: "Onayla ve gönder" önerinin üretildiği andaki konuşma sonunu sunucuya yollar ("yüklem var, argüman
// yok" sınıfı: sunucudaki tek-işlem kuralı ancak istemci bu kimliği gerçekten gönderirse çalışır). Elle yazılan cevapta gönderilmez.
// "Zaten gönderildi" cevabında konuşma yenilenir (başka birinin gönderdiği cevap görünsün).
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Otopark var mı?", createdAtLabel: "10:00", senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as Props;

const PREPARED = { messageId: "m1", reply: "Evet, arkada ücretsiz otopark var.", intent: "parking", confidence: 0.9, availabilityCheck: null, internalSourceCheck: false };
const SUGGESTION = {
  intent: "parking",
  confidence: 0.9,
  reply: "Evet, binanın arkasında otopark var.",
  risk: null,
  priority: "standard",
  source: "openai",
  riskLevel: "none",
  detectedLanguage: "tr",
  usedSources: [],
  missingInfo: [],
  availabilityCheck: null,
  earlyCheckin: null,
  internalSourceCheck: false,
};

/** URL'ye göre cevap veren sahte ağ; gönderilen istek gövdelerini kaydeder. */
function network(handlers: { suggest?: unknown; reply?: () => Response }) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sent.push({ url: String(url), body });
      if (String(url).endsWith("/ai-suggest")) return new Response(JSON.stringify(handlers.suggest ?? SUGGESTION), { status: 200 });
      if (String(url).endsWith("/reply")) return handlers.reply ? handlers.reply() : new Response(JSON.stringify({ id: "out-1" }), { status: 201 });
      return new Response("{}", { status: 200 });
    }),
  );
  return { replies: () => sent.filter((s) => s.url.endsWith("/reply")).map((s) => s.body) };
}
const click = (name: RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("konuşma ekranı — öneri onayı işlem kimliğini taşır (S1)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("🚨 kayıtlı hazır taslağın onayı: taslağın ait olduğu mesaj konuşma sonu olarak gider", async () => {
    const net = network({});
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await click(/Onayla ve gönder/);
    expect(net.replies()).toHaveLength(1);
    expect(net.replies()[0]).toMatchObject({ body: PREPARED.reply, aiAssisted: true, anchorMessageId: "m1" }); // ⬅️ ESKİDE yalnız sekmenin istek kimliği
    expect(typeof net.replies()[0].requestId).toBe("string");
  });

  it("🚨 'AI cevap öner' sonucunun onayı: SUNUCUNUN verdiği konuşma sonu gider (istemci tahmin etmez)", async () => {
    const net = network({ suggest: { ...SUGGESTION, anchorMessageId: "srv-anchor-123" } });
    render(<ConversationThread {...baseProps} />);
    await click(/AI cevap öner/);
    await click(/Onayla ve gönder/);
    expect(net.replies()[0]).toMatchObject({ body: SUGGESTION.reply, aiAssisted: true, anchorMessageId: "srv-anchor-123" });
  });

  it("sunucu konuşma sonu vermediyse (eski yanıt) alan hiç gönderilmez — uydurulmaz", async () => {
    const net = network({});
    render(<ConversationThread {...baseProps} />);
    await click(/AI cevap öner/);
    await click(/Onayla ve gönder/);
    expect(net.replies()[0]).toMatchObject({ aiAssisted: true });
    expect("anchorMessageId" in net.replies()[0]).toBe(false);
  });

  it("🚨 KONTROL: ELLE yazılan cevap konuşma sonu TAŞIMAZ ('Taslağı kullan' ile kutuya alınıp gönderilen metin de elle cevaptır)", async () => {
    const net = network({});
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await click(/Taslağı kullan/);
    await click(/^Gönder$/);
    expect(net.replies()).toHaveLength(1);
    expect(net.replies()[0]).toMatchObject({ body: PREPARED.reply, aiAssisted: false });
    expect("anchorMessageId" in net.replies()[0]).toBe(false);
  });

  it("🚨 onay 'az önce gönderildi' ile reddedilirse konuşma YENİLENİR ve sebep görünür; öneri silinmez (yenileme güncel durumu getirir)", async () => {
    network({ reply: () => new Response(JSON.stringify({ error: "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." }), { status: 409 }) });
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await click(/Onayla ve gönder/);
    expect(screen.getByText("Bu mesaj az önce gönderildi veya hâlâ gönderiliyor.")).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE eski sekme bayat kalıyordu
  });

  it("KONTROL: elle cevabın 409'u (aynı metin az önce gitti) yenileme tetiklemez — yalnız öneri onayında", async () => {
    network({ reply: () => new Response(JSON.stringify({ error: "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." }), { status: 409 }) });
    render(<ConversationThread {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Misafire cevabınız"), { target: { value: "Arkada otopark var." } });
    await click(/^Gönder$/);
    expect(screen.getByText("Bu mesaj az önce gönderildi veya hâlâ gönderiliyor.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("KONTROL: başka hata (ör. 502) öneri onayında da yenileme tetiklemez", async () => {
    network({ reply: () => new Response(JSON.stringify({ error: "Mesaj gönderilemedi." }), { status: 502 }) });
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await click(/Onayla ve gönder/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
