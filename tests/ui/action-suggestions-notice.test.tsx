// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Söz önerisi mevcut söze bağlanınca (kurucu Q1 "a", 10-17) ev sahibine kısa bilgi: "Aynı saatte kaydettiğiniz söze bağlandı (klima);
// yeni görev açılmadı." Öneri listeden kalksa da (yenileme) bilgi görünür kalır. Bağlanmayan onayda bilgi YOK.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { ActionSuggestions, type ActionSuggestionItem } from "@/components/ai-suggestions/action-suggestions";

const item: ActionSuggestionItem = {
  key: "c:1",
  kind: "commitment",
  title: "Söz kaydet: Arıza / bakım · klima — yarın 10:00",
  detail: "Ev sahibinin mesajından",
  evidenceAt: new Date().toISOString(),
  proposal: { messageId: "m1", commitmentKind: "maintenance", topic: "ac", day: "tomorrow", time: "10:00" },
};

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("eylem önerisi — mevcut söze bağlandı bilgisi", () => {
  it("konu yazıldıysa konu adıyla bilgi; öneri listesi boşalınca da görünür", async () => {
    stubFetch({ status: "done", decision: "approved", created: { merged: true, topicAttached: true, commitmentId: "c1", taskId: "t1" } });
    const { rerender } = render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.getByTestId("action-suggestion-notice").textContent).toBe("Aynı saatte kaydettiğiniz söze bağlandı (klima); yeni görev açılmadı.");
    rerender(<ActionSuggestions items={[]} />);
    expect(screen.getByTestId("action-suggestion-notice")).toBeTruthy();
  });

  it("saat düzenlenip konulu söze bağlandıysa konusuz bilgi; yeni söz açıldıysa bilgi YOK", async () => {
    stubFetch({ status: "done", decision: "approved", created: { merged: true, commitmentId: "c1", taskId: "t1" } });
    render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.getByTestId("action-suggestion-notice").textContent).toBe("Aynı saatte kaydettiğiniz söze bağlandı; yeni görev açılmadı.");
    cleanup();
    stubFetch({ status: "done", decision: "approved", created: { commitmentId: "c2", taskId: "t2" } });
    const { container } = render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.queryByTestId("action-suggestion-notice")).toBeNull();
    expect(container.textContent).not.toMatch(/bağlandı/u);
  });

  it("Haiku 10-17: saat geçmişte kaldı (400, alan 'time') → hata gösterilir VE liste yenilenir (öneri artık yoksa kalkar)", async () => {
    router.refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ fields: { time: "Geçmiş bir saat seçilemez." } }) })));
    render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.getByRole("alert").textContent).toBe("Geçmiş bir saat seçilemez.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("Opus 10-17 Q1b-B: liste ile onay arasında seçim gerekli oldu (400, alan 'attach') → hata VE liste yenilenir (seçenekler görünür)", async () => {
    router.refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ fields: { attach: "Hangi söze bağlanacağını seçin." } }) })));
    render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.getByRole("alert").textContent).toBe("Hangi söze bağlanacağını seçin.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("başka bir alan hatasında (400, alan 'kind') liste YENİLENMEZ — yalnız hata görünür (aşırı uygulama kontrolü)", async () => {
    router.refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ fields: { kind: "Geçersiz istek." } }) })));
    render(<ActionSuggestions items={[item]} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(screen.getByRole("alert").textContent).toBe("Geçersiz istek.");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("Q1-b (kurucu 10-17) — 'hangi söze bağlansın?' seçimi", () => {
  const choice: ActionSuggestionItem = {
    ...item,
    key: "c:2",
    title: "Söz kaydet: Arıza / bakım — yarın 10:00",
    detail: "Aynı saatte kayıtlı sözler var (klima, musluk) — hangisine bağlanacağını seçin",
    proposal: { messageId: "m2", commitmentKind: "maintenance", topic: null, day: "tomorrow", time: "10:00", attachTopics: ["ac", "faucet"] },
  };

  it("seçenekler görünür (iki söz + yeni söz); seçim yapılmadan Onayla PASİF; seçim isteğe 'attach' olarak gider; bilgi seçilen konuyla", async () => {
    const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "done", decision: "approved", created: { merged: true, attachedTopic: "faucet", commitmentId: "c9", taskId: "t9" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionSuggestions items={[choice]} />);
    const group = screen.getByTestId("attach-choice");
    expect(group.textContent).toContain("Hangi söze bağlansın?");
    expect(screen.getByLabelText("klima sözüne bağla")).toBeTruthy();
    expect(screen.getByLabelText("musluk sözüne bağla")).toBeTruthy();
    expect(screen.getByLabelText("Yeni söz olarak kaydet")).toBeTruthy();
    expect((screen.getByText("Onayla").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("musluk sözüne bağla"));
    expect((screen.getByText("Onayla").closest("button") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByText("Onayla"));
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ key: "c:2", decision: "approve", attach: "faucet" });
    expect(screen.getByTestId("action-suggestion-notice").textContent).toBe("Aynı saatte kaydettiğiniz söze bağlandı (musluk); yeni görev açılmadı.");
  });

  it("'Yok say' seçim istemez ve 'attach' GÖNDERMEZ; seçimsiz öneride seçim kutusu YOK", async () => {
    const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ status: "done", decision: "dismissed" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionSuggestions items={[choice]} />);
    fireEvent.click(screen.getByLabelText("klima sözüne bağla"));
    await act(async () => {
      fireEvent.click(screen.getByText("Yok say"));
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).not.toHaveProperty("attach");
    cleanup();
    render(<ActionSuggestions items={[item]} />);
    expect(screen.queryByTestId("attach-choice")).toBeNull();
  });
});
