// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Telefonda dokunma alanı (görsel inceleme 10-22, Chromium 390 px): yazı boyu (15–19 px) düğme / bağlantılar — görev kartı "Not / fotoğraf"
// (temizlikçi telefonda basıyor), bilgi tabanı "Devamını göster", panel "Tümü", mülk "Düzenle", "Varsayılan Şablonlar", gönderim kuyruğu
// bağlantıları. Dokunma alanı 27–31 px'e çıktı; yerleşim AYNI (aynı sayfada eski / yeni sınıfla yazı konumu + sonraki öğe + sayfa boyu
// birebir ölçüldü; yazının 6 px üstü / altı artık düğmeye isabet ediyor). Yöntem: dolgu + eşit eksi pay; kart başlığında eksi pay
// `space-y-0` yüzünden işlemediği için görünmez `::after` (başlık uzuyordu — ölçüldü, düzeltildi). jsdom düzen hesaplamaz → sınıf sözleşmesi.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { KbManager } from "@/components/knowledge/kb-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cls = (el: Element) => el.className.split(/\s+/);

describe("dokunma alanı — çizilen bileşenler", () => {
  it("görev kartı Not / fotoğraf: dikey dolgu + eşit eksi alt pay (yazı yerinde: mt-0.5 + pt 1.5 = eski mt-2)", () => {
    const task: TaskCardData = {
      id: "t1", title: "Çıkış temizliği", shareTitle: "Çıkış temizliği", type: "cleaning", priority: "standard", status: "todo",
      propertyName: "Lale", assigneeName: null, dueLabel: "14 Eki 2026", dueDays: 0, checklist: null,
    };
    render(<TaskBoard tasks={[task]} />);
    const toggle = screen.getByRole("button", { name: /Not \/ fotoğraf/ });
    expect(cls(toggle)).toEqual(expect.arrayContaining(["py-1.5", "-mb-1.5", "mt-0.5"]));
    expect(cls(toggle)).not.toContain("mt-2");
  });

  it("bilgi tabanı Devamını göster: alt dolgu eşit eksi payla, üst boşluk eskisi kadar", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fromTemplates: [] }) })));
    render(
      <KbManager
        properties={[{ id: "p1", name: "Lale 1" }]}
        items={[{ id: "k1", propertyId: "p1", propertyName: "Lale 1", category: "general", title: "Not", content: "x".repeat(200), language: "tr", isActive: true }]}
      />,
    );
    const more = screen.getByRole("button", { name: "Devamını göster" });
    expect(cls(more)).toEqual(expect.arrayContaining(["pb-2", "-mb-2", "pt-1"]));
  });
});

describe("dokunma alanı — sunucu sayfaları (kaynak)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const HEADER_LINK = "relative text-xs font-medium text-primary after:absolute after:-inset-2 after:content-[''] hover:underline";

  it("kart başlığı bağlantıları görünmez ::after ile büyür (eksi pay değil — space-y-0 sıfırlıyor)", () => {
    const dash = read("src/app/(app)/dashboard/page.tsx");
    expect(dash.split(`<Link href="/inbox" className="${HEADER_LINK}">`).length - 1).toBe(1);
    expect(dash.split(`<Link href="/tasks" className="${HEADER_LINK}">`).length - 1).toBe(1);
    expect(read("src/app/(app)/properties/[id]/page.tsx")).toContain(`className="${HEADER_LINK}"`);
  });

  it("gönderilenler ↔ kuyruk bağlantıları dikey dolgu + eşit eksi pay", () => {
    for (const p of ["src/app/(app)/sent/page.tsx", "src/app/(app)/sent/queue/page.tsx"]) {
      expect(read(p)).toMatch(/className="-my-1\.5 inline-flex items-center gap-1 py-1\.5 text-sm/);
    }
  });
});
