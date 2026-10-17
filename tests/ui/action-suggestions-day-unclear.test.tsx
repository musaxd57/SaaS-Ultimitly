// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Sözün günü mesajdan okunamadı (sert itirazcı 10-17 gece-4, D3: "Teknisyen yarın 10'da gelecek. Havlu getireceğim." havlu): kartta gün
// ÖNCEDEN SEÇİLİ GELMEZ ("Gün seçin"), seçilmeden "Onayla" basılamaz; seçilen gün sunucuya gider. Günü belli öneride bugünkü davranış.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { ActionSuggestions, type ActionSuggestionItem } from "@/components/ai-suggestions/action-suggestions";

const unclear: ActionSuggestionItem = {
  key: "commitment:m1:1",
  kind: "commitment",
  title: "Söz kaydet: Havlu / çarşaf — gün ve saat belirtilmedi",
  detail: "Mesajınızda sözün günü belli değil — günü seçin",
  evidenceAt: new Date().toISOString(),
  proposal: { messageId: "m1", commitmentKind: "towels", topic: null, day: "today", time: "", precision: "day", dayUnclear: true },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("eylem önerisi — günü belli olmayan söz", () => {
  it("🚨 gün seçili gelmez, seçilmeden onay basılamaz; seçilen gün gönderilir", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "done", decision: "approved", created: { commitmentId: "c1" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionSuggestions items={[unclear]} />);
    const day = screen.getByLabelText("Gün") as HTMLSelectElement;
    expect(day.value).toBe("");
    expect(screen.getByText("Gün seçin")).toBeTruthy();
    const approve = screen.getByText("Onayla").closest("button") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(day, { target: { value: "tomorrow" } });
    expect(approve.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve);
    });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { day?: string };
    expect(sent.day).toBe("tomorrow");
  });

  it("KONTROL: günü belli öneride gün seçili gelir, onay hemen basılabilir", () => {
    render(<ActionSuggestions items={[{ ...unclear, proposal: { ...unclear.proposal, dayUnclear: undefined } as ActionSuggestionItem["proposal"] }]} />);
    expect((screen.getByLabelText("Gün") as HTMLSelectElement).value).toBe("today");
    expect(screen.queryByText("Gün seçin")).toBeNull();
    expect((screen.getByText("Onayla").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
