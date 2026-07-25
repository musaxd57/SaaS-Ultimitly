// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// GÖRSEL İNCELEME BULGUSU (ekran görüntüsüyle yakalandı): panoda GECİKEN görev
// zamanında olandan AYIRT EDİLEMİYORDU.
//
// Ekranda "Bu hafta" görünümünde 3 geciken görev vardı (22/23/24 Tem, bugün 25)
// ve üçü de gelecekteki bir görevle bire bir aynı görünüyordu: aynı gri saat
// ikonu, aynı gri tarih. Aciliyeti öğrenmenin TEK yolu "Geciken" filtresine
// tıklamaktı — yani hostun geciktiğini zaten BİLMESİ gerekiyordu.
//
// Ev sahibi için panonun tek asıl sorusu "ne kaldı / ne gecikti"dir; varsayılan
// görünümde bu okunamıyorsa pano işini yapmıyor demektir.
//
// SÖZLEŞME:
//  • gecikme METİNLE yazılır (yalnız RENK olmaz — WCAG 1.4.1; renk körü kullanıcı
//    ve gri-tonlamalı baskıda da okunur),
//  • "Tamamlandı" ASLA geciken sayılmaz — "Geciken (N)" sayacının kuralıyla
//    (inWindow) birebir aynı tanım; iki farklı tanım rozetle sayacı çeliştirirdi,
//  • gelecekteki görev süslenmez (50 kartta her karta rozet = gürültü).
//
// TEST TEKNİĞİ: iddialar KARTIN TARİH SATIRINA kapsanır, sayfanın geneline
// değil. İlk yazımda `queryByText(/Bugün/)` panonun ÜSTÜNDEKİ "Bugün (6)"
// filtre düğmesine eşleşiyordu: "bugün işaretlenir" testi kod düzeltilmeden de
// yeşildi (vakum), "gelecek süslenmez" testi ise düzeltmeden sonra da kırmızı
// kalıyordu. Tarih satırını doğrudan seçmek ikisini de gerçek kılar.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";

const base: TaskCardData = {
  id: "t",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Daire 1",
  assigneeName: null,
  dueLabel: "23 Tem 2026",
  dueDays: 0,
  checklist: null,
};

const card = (over: Partial<TaskCardData>): TaskCardData => ({ ...base, ...over });

/** Kartın tarih satırı: tarih etiketini taşıyan TEK <p>. */
function dueLine(container: HTMLElement, label: string): HTMLParagraphElement {
  const line = Array.from(container.querySelectorAll("p")).find((p) =>
    p.textContent?.includes(label),
  );
  if (!line) throw new Error(`"${label}" tarih satırı bulunamadı`);
  return line as HTMLParagraphElement;
}

describe("TaskBoard — geciken görev kartta GÖRÜNÜR", () => {
  beforeEach(() => cleanup());

  it("2 gün geciken görev gecikmeyi METİNLE söyler", () => {
    const { container } = render(<TaskBoard tasks={[card({ dueDays: -2 })]} />);
    expect(dueLine(container, "23 Tem 2026").textContent).toContain("2 gün gecikti");
  });

  it("gecikme YALNIZ renkle anlatılmaz — satır hem metni hem destructive sınıfını taşır", () => {
    const { container } = render(
      <TaskBoard tasks={[card({ dueDays: -3, dueLabel: "22 Tem 2026" })]} />,
    );
    const line = dueLine(container, "22 Tem 2026");
    expect(line.textContent).toContain("3 gün gecikti");
    expect(line.className).toContain("text-destructive");
  });

  it("bugün teslim edilecek görev tarih satırında BUGÜN der", () => {
    const { container } = render(
      <TaskBoard tasks={[card({ dueDays: 0, dueLabel: "25 Tem 2026" })]} />,
    );
    expect(dueLine(container, "25 Tem 2026").textContent).toContain("Bugün");
  });

  it("gelecekteki görevin tarih satırı SÜSLENMEZ (gürültü yok)", () => {
    const { container } = render(
      <TaskBoard tasks={[card({ dueDays: 4, dueLabel: "29 Tem 2026" })]} />,
    );
    const line = dueLine(container, "29 Tem 2026");
    expect(line.textContent).not.toContain("gecikti");
    expect(line.textContent).not.toContain("Bugün");
    expect(line.className).not.toContain("text-destructive");
  });

  it("TAMAMLANMIŞ görev geciken sayılmaz — 'Geciken (N)' sayacıyla aynı tanım", () => {
    // Aynı gecikmede iki kart: biri açık, biri tamamlanmış. Yalnız açık olan
    // gecikme taşımalı; aksi hâlde rozet, filtrenin saymadığı bir şeyi "geciken"
    // diye gösterirdi.
    const { container } = render(
      <TaskBoard
        tasks={[
          card({ id: "open", dueDays: -5, dueLabel: "20 Tem 2026" }),
          card({ id: "done", dueDays: -5, status: "done", dueLabel: "19 Tem 2026" }),
        ]}
      />,
    );
    expect(dueLine(container, "20 Tem 2026").textContent).toContain("5 gün gecikti");
    expect(dueLine(container, "19 Tem 2026").textContent).not.toContain("gecikti");
  });

  it("BUGÜNE tarihli TAMAMLANMIŞ görev 'Bugün' demez (bekleyen iş izlenimi yok)", () => {
    // Bilinçli asimetri: "Bugün (N)" FİLTRESİ bugüne tarihli tamamlanmış görevi
    // de sayar (o pencerenin işi), ama KART işareti "bugün YAPILACAK" demektir.
    // Bitmiş bir kartta bu izlenim yanlış olurdu.
    const { container } = render(
      <TaskBoard tasks={[card({ dueDays: 0, status: "done", dueLabel: "25 Tem 2026" })]} />,
    );
    expect(dueLine(container, "25 Tem 2026").textContent).not.toContain("Bugün");
  });

  it("tarihi olmayan görevde tarih satırı hiç basılmaz", () => {
    const { container } = render(
      <TaskBoard tasks={[card({ dueDays: null, dueLabel: null })]} />,
    );
    expect(container.textContent).not.toContain("gecikti");
  });
});
