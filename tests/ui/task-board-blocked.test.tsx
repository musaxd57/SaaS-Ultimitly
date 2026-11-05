// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Kurucu 11-05 gece — "Yapamıyorum": temizlikçi kartından bildirir (neden isteğe bağlı); ev sahibi kartta "Yapılamıyor" rozetini, kim /
// ne zaman / neden satırını görür ve kartın üstünden BAŞKA BİRİNE atar. Kart "Yapılacak" sütununda durur (ev sahibinin işi).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { blockedLine } from "@/lib/tasks/card-data";

const base: TaskCardData = {
  id: "t1",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Lale",
  assigneeName: "Ayşe",
  assigneeId: "u-ayse",
  dueLabel: "23 Tem 2026",
  dueDays: 0,
  checklist: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

describe("pano — 'Yapamıyorum'", () => {
  it("🚨 temizlikçi: 'Yapamıyorum' → neden → 'Ev sahibine bildir' isteği {status: blocked, note}", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[base]} canManage={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Yapamıyorum/ }));
    fireEvent.change(screen.getByLabelText("Yapamama nedeni: Çıkış temizliği"), { target: { value: "hastayım" } });
    fireEvent.click(screen.getByRole("button", { name: "Ev sahibine bildir" }));
    await settle();
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "blocked", note: "hastayım" } }]);
  });

  it("neden boşsa yalnız durum gider (not satırı açılmaz)", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[base]} canManage={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Yapamıyorum/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ev sahibine bildir" }));
    await settle();
    expect(calls[0].body).toEqual({ status: "blocked" });
  });

  it("🚨 ev sahibi: 'Yapılamıyor' kartı Yapılacak sütununda, rozet + kim/ne zaman/neden satırı; kart üstünden başka birine atanır", async () => {
    const calls = stubFetch();
    const blocked = { ...base, status: "blocked", blocked: "Ayşe yapamıyor · 12:05 — hastayım", latestNote: "hastayım" };
    render(<TaskBoard tasks={[blocked]} canManage members={[{ id: "u-ayse", name: "Ayşe" }, { id: "u-mehmet", name: "Mehmet" }]} />);
    const heading = screen.getByRole("heading", { name: "Yapılacak" });
    const todoColumn = heading.closest("div.rounded-xl") as HTMLElement;
    expect(within(todoColumn).getByText("Yapılamıyor")).toBeTruthy();
    expect(within(todoColumn).getByText("Ayşe yapamıyor · 12:05 — hastayım")).toBeTruthy();
    // Neden zaten satırda — son not olarak İKİNCİ kez yazılmaz.
    expect(screen.queryAllByText("hastayım")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Atanan kişi: Çıkış temizliği"), { target: { value: "u-mehmet" } });
    await settle();
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { assignedToId: "u-mehmet" } }]);
  });

  it("mutasyon Q28: temizlikçi 'Yapılamıyor' kartında düğme yerine 'Ev sahibine bildirildi' + yine yaparsa ne yapacağı yazar", () => {
    render(<TaskBoard tasks={[{ ...base, status: "blocked" }]} canManage={false} />);
    expect(screen.getByText(/Ev sahibine bildirildi\. Yine de yaparsanız durumu/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Yapamıyorum/ })).toBeNull();
  });

  it("KONTROL — temizlikçi kartında 'Atanan' seçimi YOK; biten görevde 'Yapamıyorum' YOK", () => {
    render(<TaskBoard tasks={[{ ...base, status: "done" }]} canManage={false} />);
    expect(screen.queryByLabelText(/Atanan kişi/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Yapamıyorum/ })).toBeNull();
  });

  it("geç çıkış: temizlik kartı 'Misafir çıkışı 14:00 · geç çıkış onaylı' satırını çizer; biten kartta çizmez", () => {
    const note = "Misafir çıkışı 14:00 · geç çıkış onaylı";
    const { unmount } = render(<TaskBoard tasks={[{ ...base, checkoutNote: note }]} canManage={false} />);
    expect(screen.getByText(note)).toBeTruthy();
    unmount();
    render(<TaskBoard tasks={[{ ...base, status: "done", checkoutNote: note }]} canManage={false} />);
    expect(screen.queryByText(note)).toBeNull();
  });

  it("kart satırı: bugünse saat, başka günse gün + saat; neden kısaltılır; kişi yoksa 'Atanan kişi'", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    expect(blockedLine({ by: "Ayşe", at: new Date("2026-11-07T09:05:00Z"), reason: "hastayım" }, "Europe/Istanbul", now)).toBe("Ayşe yapamıyor · 12:05 — hastayım");
    expect(blockedLine({ by: null, at: new Date("2026-11-06T09:05:00Z"), reason: null }, "Europe/Istanbul", now)).toBe("Atanan kişi yapamıyor · 6 Kas 12:05");
    expect(blockedLine({ by: "Ayşe", at: new Date("2026-11-07T09:05:00Z"), reason: "x".repeat(300) }, "Europe/Istanbul", now)).toHaveLength(
      "Ayşe yapamıyor · 12:05 — ".length + 120,
    );
  });
});
