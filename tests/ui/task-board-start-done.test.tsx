// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Kurucu 11-05 gece akışı: "Temizlikçi Başladım → Bitti der." Personel kartında tek dokunuşluk düğme: "Başladım" (yapılacak / yapılamıyor →
// devam ediyor) ve "Bitti" (devam ediyor → tamamlandı). "Bitti" kaydı dairenin hazır olduğunun kanıtı olduğundan bir kez sorulur.
// Yönetici kartında bu düğmeler YOK (yönetici durum kutusunu kullanır).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { registerConfirmHandler, __resetConfirmForTest } from "@/lib/confirm";

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
  __resetConfirmForTest();
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

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

describe("personel kartı — 'Başladım' → 'Bitti'", () => {
  it("🚨 'Yapılacak' kartta 'Başladım' tek dokunuşla 'Devam ediyor' yapar (soru yok)", async () => {
    const calls = stubFetch();
    const asked: string[] = [];
    registerConfirmHandler(async (o) => {
      asked.push(o.title);
      return true;
    });
    render(<TaskBoard tasks={[base]} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Bitti" })).toBeNull();
    await click("Başladım");
    expect(asked).toEqual([]);
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "in_progress" } }]);
  });

  it("🚨 'Devam ediyor' kartta 'Bitti' önce SORAR; 'Evet, bitti' → 'Tamamlandı'", async () => {
    const calls = stubFetch();
    const asked: string[] = [];
    registerConfirmHandler(async (o) => {
      asked.push(`${o.title} | ${o.body}`);
      return true;
    });
    render(<TaskBoard tasks={[{ ...base, status: "in_progress" }]} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Başladım" })).toBeNull();
    await click("Bitti");
    expect(asked).toEqual(["İş bitti mi? | Ev sahibi dairenin hazır olduğunu görür."]);
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "done" } }]);
  });

  it("Haiku 11-06: temizlik DIŞI işte 'Bitti' sorusu dairenin hazır olduğunu söylemez", async () => {
    stubFetch();
    const asked: string[] = [];
    registerConfirmHandler(async (o) => {
      asked.push(String(o.body));
      return false;
    });
    render(<TaskBoard tasks={[{ ...base, type: "maintenance", title: "Klima", status: "in_progress" }]} canManage={false} />);
    await click("Bitti");
    expect(asked).toEqual(["Ev sahibi işin bittiğini görür."]);
  });

  it("KONTROL — soruda 'Vazgeç' → istek GİTMEZ", async () => {
    const calls = stubFetch();
    registerConfirmHandler(async () => false);
    render(<TaskBoard tasks={[{ ...base, status: "in_progress" }]} canManage={false} />);
    await click("Bitti");
    expect(calls).toEqual([]);
  });

  it("'Yapılamıyor' kartta da 'Başladım' var (fikrini değiştirirse); biten kartta düğme yok; yönetici kartında hiç yok", async () => {
    const calls = stubFetch();
    const { unmount } = render(<TaskBoard tasks={[{ ...base, status: "blocked" }]} canManage={false} />);
    await click("Başladım");
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "in_progress" } }]);
    unmount();
    const done = render(<TaskBoard tasks={[{ ...base, status: "done" }]} canManage={false} />);
    expect(screen.queryByRole("button", { name: /^(Başladım|Bitti)$/ })).toBeNull();
    done.unmount();
    render(<TaskBoard tasks={[base, { ...base, id: "t2", status: "in_progress" }]} canManage members={[{ id: "u-ayse", name: "Ayşe" }]} />);
    expect(screen.queryByRole("button", { name: /^(Başladım|Bitti)$/ })).toBeNull();
  });
});
