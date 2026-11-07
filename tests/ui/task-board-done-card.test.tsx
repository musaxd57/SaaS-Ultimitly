// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U16 (kurucu 10-22, "Dediğin gibi olsun a iyi"): biten görev kartı SOLUKLAŞTIRILMAZ. Eskiden kart %70 opaklıktaydı; içindeki gri yazı açık
// temada 2,7:1'e düşüyordu (eşik 4,5:1) — temizlikçi telefonda, gün ışığında okur. Artık başlık üstü çizili + "Tamamlandı" rozeti; açık
// görev kartı değişmedi (çizgi yok, rozet yok).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";

const base: TaskCardData = {
  id: "t1",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Lale",
  assigneeName: null,
  dueLabel: "23 Tem 2026",
  dueDays: 2,
  checklist: null,
};

afterEach(cleanup);

function cardOf(container: HTMLElement, title: string): HTMLElement {
  const p = Array.from(container.querySelectorAll("p")).find((el) => el.textContent === title);
  if (!p) throw new Error(`"${title}" kartı yok`);
  return p.closest("div.rounded-lg") as HTMLElement;
}

describe("U16 — biten görev kartı", () => {
  it("biten kart: soluk değil, başlık üstü çizili, 'Tamamlandı' rozeti; açık kart: ikisi de yok", () => {
    const { container } = render(
      <TaskBoard
        tasks={[
          { ...base, id: "done1", title: "Biten iş", status: "done" },
          { ...base, id: "open1", title: "Açık iş", status: "todo" },
        ]}
        canManage
      />,
    );
    const done = cardOf(container, "Biten iş");
    expect(done.className).not.toMatch(/opacity-/);
    expect(within(done).getByText("Biten iş").className).toContain("line-through");
    // Kartın durum seçicisinde de "Tamamlandı" seçeneği var — rozet ayrı bir <span>.
    const badge = (card: HTMLElement) => Array.from(card.querySelectorAll("span")).filter((el) => el.textContent === "Tamamlandı");
    expect(badge(done)).toHaveLength(1);

    const open = cardOf(container, "Açık iş");
    expect(within(open).getByText("Açık iş").className).not.toContain("line-through");
    expect(badge(open)).toHaveLength(0);
  });
});
