// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TEMİZLİK LİSTESİ (WhatsApp / kopyala) temizlikçiye gider → misafir ADI taşımaz (kanıt modeli dilim 3). Liste kartın
// `shareTitle`ını (temizlikçi görünümü) kullanır; yoksa görev türünü yazar — ekrandaki (host) başlığı ASLA.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";

const card = (over: Partial<TaskCardData>): TaskCardData => ({
  id: "t1",
  title: "Çıkış temizliği - Ayşe Yılmaz",
  shareTitle: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Lale",
  assigneeName: null,
  dueLabel: "14 Eki 2026",
  dueDays: 0,
  checklist: null,
  ...over,
});

function openShare() {
  fireEvent.click(screen.getByRole("button", { name: /Temizlik listesini paylaş/ }));
  const pre = document.querySelector("pre");
  const wa = screen.getByRole("link", { name: /WhatsApp/ }) as HTMLAnchorElement;
  return { text: pre?.textContent ?? "", href: decodeURIComponent(wa.href) };
}

describe("TaskBoard — temizlik listesi misafir adı taşımaz", () => {
  beforeEach(() => cleanup());

  it("🚨 liste temizlikçi başlığını kullanır; host'un ekranındaki misafir adlı başlık listeye/WhatsApp bağlantısına girmez", () => {
    render(<TaskBoard tasks={[card({})]} />);
    // Host panosu kendi başlığını görmeye devam eder.
    expect(screen.getByText("Çıkış temizliği - Ayşe Yılmaz")).toBeTruthy();
    const { text, href } = openShare();
    expect(text).toContain("14 Eki 2026 — Lale — Çıkış temizliği");
    expect(text).not.toContain("Ayşe");
    expect(href).not.toContain("Ayşe");
  });

  it("temizlikçi başlığı verilmemiş kart (eski çağıran) listeye görev türünü yazar, başlığı değil", () => {
    render(<TaskBoard tasks={[card({ shareTitle: undefined })]} />);
    const { text } = openShare();
    expect(text).toContain("Lale — Temizlik");
    expect(text).not.toContain("Ayşe");
  });
});
