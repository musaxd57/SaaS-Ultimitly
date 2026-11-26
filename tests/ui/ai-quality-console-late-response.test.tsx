// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Codex 11-17 H3 — operatör yapay zekâ kalite konsolu: işletme A için "İzleri göster" uçuştayken işletme B seçilir; A'nın yanıtı sonradan
// gelince eskiden A'nın satırları B seçiminin ALTINDA görünüyordu (kartların etiket isteği de B kimliğiyle gider). Yanıt yalnız hâlâ en
// son istekse uygulanır (`guest-chat.tsx` `loadSeq` kalıbı); seçim değişince düğme uçuştaki eski isteği beklemeden yeniden kullanılabilir.
// ---------------------------------------------------------------------------

import { AiQualityConsole } from "@/components/admin/ai-quality-console";

const orgs = [
  { id: "org-a", name: "İşletme A" },
  { id: "org-b", name: "İşletme B" },
];
const gen = (id: string, draft: string) => ({
  id,
  conversationId: "c1",
  surface: "reply",
  model: "m",
  promptVersion: "v1",
  decision: "human_review",
  gateReason: null,
  latencyMs: null,
  promptTokens: null,
  completionTokens: null,
  reasoningTokens: null,
  draftText: draft,
  sentText: null,
  createdAt: "2026-03-04T05:06:07.000Z",
  labels: [],
});

type Pending = { url: string; resolve: (r: Response) => void; reject: (e: unknown) => void };
let pending: Pending[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => new Promise<Response>((resolve, reject) => pending.push({ url: String(url), resolve, reject }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
async function settle(p: Pending, r: Response | Error) {
  if (r instanceof Error) p.reject(r);
  else p.resolve(r);
  await flush();
}
function setup() {
  render(<AiQualityConsole orgs={orgs} />);
  fireEvent.change(screen.getByLabelText("Amaç"), { target: { value: "quality_review" } });
}
const showButton = () => screen.getByRole("button", { name: "İzleri göster" }) as HTMLButtonElement;

describe("kalite konsolu — geç gelen yanıt güncel seçimin altında görünmez (H3)", () => {
  it("🚨 A uçuştayken B seçildi → A'nın yanıtı gelince satırları GÖRÜNMEZ; düğme hemen kullanılabilir; B'nin yanıtı görünür", async () => {
    setup();
    fireEvent.click(showButton());
    expect(pending[0]!.url).toContain("orgId=org-a");
    fireEvent.change(screen.getByLabelText("İşletme"), { target: { value: "org-b" } });
    expect(showButton().disabled).toBe(false);
    await settle(pending[0]!, json({ generations: [gen("ga", "A taslağı")], nextBefore: "x" }));
    expect(screen.queryByText("A taslağı")).toBeNull();
    expect(screen.queryByRole("button", { name: "Daha eski izler" })).toBeNull();
    expect(screen.queryByText("Bu işletme için kayıtlı iz yok.")).toBeNull();
    fireEvent.click(showButton());
    expect(pending[1]!.url).toContain("orgId=org-b");
    await settle(pending[1]!, json({ generations: [gen("gb", "B taslağı")], nextBefore: null }));
    expect(screen.getByText("B taslağı")).toBeTruthy();
  });

  it("🚨 B isteği A'dan ÖNCE dönerse, sonra gelen A yanıtı B'nin listesini ezmez; A'nın geç bitişi B'nin meşgul durumunu da kapatmaz", async () => {
    setup();
    fireEvent.click(showButton());
    fireEvent.change(screen.getByLabelText("İşletme"), { target: { value: "org-b" } });
    fireEvent.click(showButton());
    await settle(pending[0]!, json({ generations: [gen("ga", "A taslağı")], nextBefore: null }));
    expect(screen.queryByText("A taslağı")).toBeNull();
    // B hâlâ uçuşta: A'nın `finally`si düğmeyi açmamalı.
    expect(showButton().disabled).toBe(true);
    await settle(pending[1]!, json({ generations: [gen("gb", "B taslağı")], nextBefore: null }));
    expect(screen.getByText("B taslağı")).toBeTruthy();
    expect(showButton().disabled).toBe(false);
  });

  it("eski isteğin hatası / ağ arızası güncel seçimde hata olarak görünmez", async () => {
    setup();
    fireEvent.click(showButton());
    fireEvent.change(screen.getByLabelText("İşletme"), { target: { value: "org-b" } });
    await settle(pending[0]!, json({ error: "İzler yüklenemedi (A)." }, 500));
    expect(screen.queryByText("İzler yüklenemedi (A).")).toBeNull();
    fireEvent.click(showButton());
    fireEvent.change(screen.getByLabelText("İşletme"), { target: { value: "org-a" } });
    await settle(pending[1]!, new Error("ağ"));
    expect(screen.queryByText(/İnternet bağlantınızda sorun/)).toBeNull();
  });

  it("'Daha eski izler' uçuştayken karar süzgeci değişti → eski sayfa yeni listeye eklenmez", async () => {
    setup();
    fireEvent.click(showButton());
    await settle(pending[0]!, json({ generations: [gen("g1", "İlk sayfa")], nextBefore: "cur1" }));
    fireEvent.click(screen.getByRole("button", { name: "Daha eski izler" }));
    expect(pending[1]!.url).toContain("before=cur1");
    fireEvent.change(screen.getByLabelText("Karar"), { target: { value: "auto_sent" } });
    await settle(pending[1]!, json({ generations: [gen("g2", "Eski sayfa")], nextBefore: null }));
    expect(screen.queryByText("Eski sayfa")).toBeNull();
    expect(screen.queryByText("İlk sayfa")).toBeNull();
  });

  it("KONTROL: tek istek (seçim değişmedi) bugünkü gibi uygulanır; sayfalama listeye ekler", async () => {
    setup();
    fireEvent.click(showButton());
    expect(showButton().disabled).toBe(true);
    await settle(pending[0]!, json({ generations: [gen("g1", "İlk sayfa")], nextBefore: "cur1" }));
    expect(screen.getByText("İlk sayfa")).toBeTruthy();
    expect(showButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Daha eski izler" }));
    await settle(pending[1]!, json({ generations: [gen("g2", "Eski sayfa")], nextBefore: null }));
    expect(screen.getByText("İlk sayfa")).toBeTruthy();
    expect(screen.getByText("Eski sayfa")).toBeTruthy();
  });
});
