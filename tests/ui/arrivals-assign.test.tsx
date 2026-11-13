// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";
import { ASSIGN_ERROR } from "@/components/arrivals/assign-task";
import type { Factor } from "@/lib/readiness-list/evaluate";

// UX-10 D3 (kurucu 11-13): Girişler satırından doğrudan atama — bir ada dokunmak atar (ayrı "Kaydet" yok), sunucuya satırın gördüğü atanan
// ön şart olarak gider, bayat satırda açıklama + liste yenilenir. Kişi listesi verilmezse (yönetici değil) düğme yok.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const members = [
  { id: "u-ali", name: "Ali" },
  { id: "u-ayse", name: "Ayşe" },
];
const factor = (over: Partial<Factor> = {}): Factor => ({
  key: "cleaning",
  state: "blocking",
  label: "Temizlik açık · kimseye atanmadı · başlanmadı",
  missing: '"bitti" kaydı',
  basis: [],
  link: { to: "task", taskId: "t1" },
  assign: { taskId: "t1", expectAssigneeId: null, mode: "assign" },
  ...over,
});
const row = (f: Factor): ArrivalsListRow => ({
  reservationId: "r1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: "Bugün · 7 Kasım Cumartesi",
  checkInTime: "15:00",
  conversationId: null,
  overall: "not_ready",
  factors: [f],
});
const renderList = (f: Factor, m: typeof members | null = members) => render(<ArrivalsList rows={[row(f)]} truncated={0} members={m} />);

describe("Girişler — satırdan atama", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "t1" }), { status: 200 })));
  });

  it("'Birini atayın' seçimi: ada dokunmak PATCH gönderir (ön şart: atanmamış), liste yenilenir", async () => {
    renderList(factor());
    const select = screen.getByLabelText("Birini atayın") as HTMLSelectElement;
    // İlk seçenek seçilemeyen yer tutucu (düğmenin yazısı); seçilebilir olanlar kişiler.
    expect(Array.from(select.options).map((o) => [o.textContent, o.disabled])).toEqual([["Birini atayın", true], ["Ali", false], ["Ayşe", false]]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "u-ayse" } });
    });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/tasks/t1");
    expect((call[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ assignedToId: "u-ayse", expectAssignedToId: "" });
    expect(refresh).toHaveBeenCalled();
  });

  it("'Değiştirin': şimdiki kişi listede yok, sonda 'Atanmadı' (boş kimlik gönderir); ön şart şimdiki kişi", async () => {
    renderList(factor({ assign: { taskId: "t1", expectAssigneeId: "u-ayse", mode: "change" } }));
    const select = screen.getByLabelText("Değiştirin") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Değiştirin", "Ali", "Atanmadı"]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "__none" } });
    });
    const body = JSON.parse(String(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ assignedToId: "", expectAssignedToId: "u-ayse" });
  });

  it("'Başkasına atayın' (Yapılamıyor) — 'Atanmadı' seçeneği yok", () => {
    renderList(factor({ assign: { taskId: "t1", expectAssigneeId: "u-ayse", mode: "reassign" } }));
    const select = screen.getByLabelText("Başkasına atayın");
    expect(within(select).queryByText("Atanmadı")).toBeNull();
  });

  it("bayat satır (409 assignee_changed) → açıklama satırın altında + liste yenilenir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "assignee_changed", error: "x" }), { status: 409 })));
    renderList(factor());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Birini atayın"), { target: { value: "u-ali" } });
    });
    expect(screen.getByRole("alert").textContent).toBe(ASSIGN_ERROR.assignee_changed);
    expect(refresh).toHaveBeenCalled();
  });

  it("ağ hatası → bağlantı cümlesi, yenileme yok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    renderList(factor());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Birini atayın"), { target: { value: "u-ali" } });
    });
    expect(screen.getByRole("alert").textContent).toBe(ASSIGN_ERROR.network);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("kişi listesi verilmezse ya da satırda atama yoksa düğme çizilmez; görev bağlantısı yerinde kalır", () => {
    renderList(factor(), null);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("link", { name: "Görevi açın" })).toBeTruthy();
    cleanup();
    renderList(factor({ assign: undefined }));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
