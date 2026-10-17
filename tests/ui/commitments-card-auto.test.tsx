// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Söz kartı (kurucu 10-17 gece, söz → görev otomatik): kendiliğinden kaydedilen söz "Mesajınızdan kaydedildi" der ve "Yanlış, kaldır"
// sunar (istekte `reason: "wrong"`); elle kaydedilen söz bugünkü "İptal". Açık saatin 30 dk payı içinde "zamanı geldi".
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { CommitmentsCard, type CommitmentRow } from "@/components/inbox/commitments-card";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const autoRow: CommitmentRow = { id: "c1", kind: "towels", dueLabel: "yarın akşam", minutesLeft: 300, auto: true };
const manualRow: CommitmentRow = { id: "c2", kind: "maintenance", topic: "ac", dueLabel: "17 Eki 10:00", minutesLeft: 0 };

describe("CommitmentsCard — otomatik söz", () => {
  it("🚨 otomatik söz: etiket + 'Yanlış, kaldır' → reason 'wrong'; elle söz: etiket yok + 'İptal' → nedensiz", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CommitmentsCard conversationId="conv1" commitments={[autoRow, manualRow]} readOnly={false} />);
    expect(screen.getAllByTestId("commitment-auto-label")).toHaveLength(1);
    expect(screen.getByText("Mesajınızdan kaydedildi")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Yanlış, kaldır"));
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/conversations/conv1/commitments/c1");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ status: "cancelled", reason: "wrong" });
    await act(async () => {
      fireEvent.click(screen.getByText("İptal"));
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({ status: "cancelled" });
  });

  it("kalan 0 → 'zamanı geldi' (gecikti değil); saatsiz sözün etiketi sunucunun metni ('yarın akşam')", () => {
    render(<CommitmentsCard conversationId="conv1" commitments={[autoRow, manualRow]} readOnly={false} />);
    expect(screen.getByText("zamanı geldi")).toBeTruthy();
    expect(screen.queryByText(/gecikti/u)).toBeNull();
    expect(screen.getByText(/yarın akşam/u)).toBeTruthy();
  });

  it("salt-okunur (bürünme): etiket görünür, düğme YOK", () => {
    render(<CommitmentsCard conversationId="conv1" commitments={[autoRow]} readOnly />);
    expect(screen.getByText("Mesajınızdan kaydedildi")).toBeTruthy();
    expect(screen.queryByText("Yanlış, kaldır")).toBeNull();
  });
});
