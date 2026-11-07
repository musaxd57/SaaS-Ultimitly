// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Kurucu T5 (10-21): "Teknisyen yarın 7'de gelecek." — saat öğleden önce mi sonra mı belli değil, bağlam da söylemiyor → kartta iki saat
// seçeneği; seçilmeden "Onayla" basılamaz; seçilen saat sunucuya gider.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { ActionSuggestions, type ActionSuggestionItem } from "@/components/ai-suggestions/action-suggestions";

const choices: ActionSuggestionItem = {
  key: "commitment:m1:0-0-maintenance",
  kind: "commitment",
  title: "Söz kaydet: Bakım / onarım — yarın",
  detail: "Saat sabah mı akşam mı belli değil (07:00 / 19:00) — saati seçin",
  evidenceAt: new Date().toISOString(),
  proposal: {
    messageId: "m1",
    commitmentKind: "maintenance",
    topic: null,
    day: "tomorrow",
    time: "",
    precision: "time",
    timeAmbiguous: true,
    timeChoices: ["07:00", "19:00"],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("eylem önerisi — sabah mı akşam mı belli olmayan saat (kurucu T5)", () => {
  it("🚨 iki seçenek gösterilir, seçilmeden onay basılamaz; seçilen saat gönderilir", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "done", decision: "approved", created: { commitmentId: "c1" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionSuggestions items={[choices]} />);
    const approve = screen.getByText("Onayla").closest("button") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByText("19:00"));
    expect(approve.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve);
    });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { time?: string };
    expect(sent.time).toBe("19:00");
  });

  it("KONTROL: seçeneksiz öneride saat düğmesi yok, onay hemen basılabilir", () => {
    const plain = { ...choices, proposal: { ...choices.proposal, time: "10:00", timeChoices: undefined, timeAmbiguous: undefined } } as ActionSuggestionItem;
    render(<ActionSuggestions items={[plain]} />);
    expect(screen.queryByText("19:00")).toBeNull();
    expect((screen.getByText("Onayla").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
