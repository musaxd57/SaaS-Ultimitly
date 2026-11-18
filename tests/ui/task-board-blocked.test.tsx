// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Yapamıyorum" düğmesi KALDIRILDI (kurucu 11-13; yerine yedek temizlikçi). Eski veride kalmış "Yapılamıyor" görev hâlâ okunur: ev sahibi
// kartta rozeti, kim / ne zaman / neden satırını görür ve kartın üstünden BAŞKA BİRİNE atar; kart "Yapılacak" sütununda durur.
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

describe("pano — 'Yapamıyorum' kaldırıldı; eski 'Yapılamıyor' verisi", () => {
  it("🚨 temizlikçinin kartında 'Yapamıyorum' düğmesi ve neden kutusu YOK; 'Başladım' duruyor (kontrol)", () => {
    stubFetch();
    render(<TaskBoard tasks={[base]} canManage={false} />);
    expect(screen.queryByRole("button", { name: /Yapamıyorum/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ev sahibine bildir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Başladım" })).toBeTruthy();
  });

  it("🚨 ev sahibi: 'Yapılamıyor' kartı Yapılacak sütununda, rozet + kim/ne zaman/neden satırı; kart üstünden başka birine atanır", async () => {
    const calls = stubFetch();
    const blocked = { ...base, status: "blocked", blocked: "Ayşe yapamıyor · 12:05 — hastayım", latestNote: "hastayım" };
    render(<TaskBoard tasks={[blocked]} canManage members={[{ id: "u-ayse", name: "Ayşe" }, { id: "u-mehmet", name: "Mehmet" }]} />);
    const heading = screen.getByRole("heading", { name: "Yapılacak" });
    const todoColumn = heading.closest("div.rounded-xl") as HTMLElement;
    // Rozet (durum kutusundaki seçenek değil — o da "Yapılamıyor" yazar).
    expect(within(todoColumn).getAllByText("Yapılamıyor").filter((el) => el.tagName !== "OPTION")).toHaveLength(1);
    expect(within(todoColumn).getByText("Ayşe yapamıyor · 12:05 — hastayım")).toBeTruthy();
    // Neden zaten satırda — son not olarak İKİNCİ kez yazılmaz.
    expect(screen.queryAllByText("hastayım")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Atanan kişi: Çıkış temizliği"), { target: { value: "u-mehmet" } });
    await settle();
    // H7: kartın gördüğü atanan ön şart olarak gider (yalnız atanan sınanır).
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { assignedToId: "u-mehmet", expectAssignedToId: "u-ayse", expectAssigneeOnly: true } }]);
  });

  it("mutasyon Q28: temizlikçi eski 'Yapılamıyor' kartında düğme yerine 'Ev sahibi bu görevi görüyor' + yine yaparsa ne yapacağı yazar", () => {
    render(<TaskBoard tasks={[{ ...base, status: "blocked" }]} canManage={false} />);
    expect(screen.getByText(/Ev sahibi bu görevi görüyor\. Yine de yaparsanız “Başladım”a basın\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Yapamıyorum/ })).toBeNull();
  });

  it("🚨 gerçek uygulama ekranı (11-06): 'Yapılamıyor' kartının durum kutusu 'Yapılacak' GÖSTERMEZ — 'Yapılamıyor' yazar; 'Yapılacak' seçilince durum gider", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[{ ...base, status: "blocked", blocked: "Ayşe yapamıyor · 12:05" }]} canManage members={[{ id: "u-ayse", name: "Ayşe" }]} />);
    const select = screen.getByLabelText("Görev durumu: Çıkış temizliği") as HTMLSelectElement;
    expect(select.value).toBe("blocked");
    expect(select.selectedOptions[0].textContent).toBe("Yapılamıyor");
    // Seçenek yeniden seçilemez (bildirim yalnız atanan kişinin "Yapamıyorum"u ile gelir).
    expect((select.querySelector('option[value="blocked"]') as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "todo" } });
    await settle();
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "todo" } }]);
  });

  it("KONTROL — 'Yapılamıyor' olmayan kartta durum kutusunda o seçenek YOK", () => {
    render(<TaskBoard tasks={[base]} canManage />);
    const select = screen.getByLabelText("Görev durumu: Çıkış temizliği") as HTMLSelectElement;
    expect(select.value).toBe("todo");
    expect(select.querySelector('option[value="blocked"]')).toBeNull();
  });

  it("🚨 Opus 11-06 N1: kart üstünde 'Atanmadı' seçilince boş kimlik gider (şema `null`u reddeder → 400 'Görev atanamadı' oluyordu)", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[{ ...base, status: "blocked" }]} canManage members={[{ id: "u-ayse", name: "Ayşe" }]} />);
    fireEvent.change(screen.getByLabelText("Atanan kişi: Çıkış temizliği"), { target: { value: "" } });
    await settle();
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { assignedToId: "", expectAssignedToId: "u-ayse", expectAssigneeOnly: true } }]);
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
