// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U26 (Codex 10-07): pano kontrol listesinde YALNIZ tıklanan maddeyi gönderir (sıra + gördüğü etiket + yeni işaret). Eskiden
// listenin tamamını gönderiyordu → eşzamanlı başka işaret siliniyordu. 409'da (liste değişti) sayfa yenilenir.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/tasks" }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { toast } from "@/lib/toast";

const task: TaskCardData = {
  id: "t1",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Daire 1",
  assigneeName: null,
  dueLabel: "23 Tem 2026",
  dueDays: 1,
  checklist: { items: [{ label: "Çarşaf × 2", done: false }, { label: "Havlu × 4", done: true }] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function openCard() {
  render(<TaskBoard tasks={[task]} />);
  fireEvent.click(screen.getByRole("button", { name: /Not/ }));
}

describe("U26 — pano tek madde gönderir", () => {
  it("🚨 2. maddenin işareti kaldırılır → gövde yalnız { index: 1, label, done: false }", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    openCard();
    await act(async () => fireEvent.click(screen.getByLabelText("Havlu × 4")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/t1");
    expect(JSON.parse(String(init.body))).toEqual({ checklistToggle: { index: 1, label: "Havlu × 4", done: false } }); // ⬅️ ARIZADA tüm liste
  });

  it("409 (liste değişti) → kullanıcıya söylenir ve sayfa yenilenir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    openCard();
    await act(async () => fireEvent.click(screen.getByLabelText("Çarşaf × 2")));
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining("bu arada değişti"));
    expect(refresh).toHaveBeenCalled();
  });
});
