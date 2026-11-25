// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Plan madde 9 (kurucu 11-25): bakım görevi kapanırken "ne yapıldı" notu İSTENİR ama zorunlu DEĞİLDİR; açık bakım kartında dairenin son
// kapanmış bakım işi görünür. Tasarım: docs/TASARIM-2026-11-25-son-bakim-isi-notu.md
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { registerConfirmHandler, __resetConfirmForTest } from "@/lib/confirm";
import { subscribeToasts, __resetToastsForTest, type ToastMessage } from "@/lib/toast";

const base: TaskCardData = {
  id: "t1",
  title: "Bakım: kombi",
  type: "maintenance",
  priority: "standard",
  status: "in_progress",
  propertyName: "Lale",
  assigneeName: "Ahmet",
  assigneeId: "u-ahmet",
  dueLabel: null,
  dueDays: null,
  checklist: null,
};

let toasts: ToastMessage[] = [];
beforeEach(() => {
  toasts = [];
  subscribeToasts((m) => toasts.push(m));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetConfirmForTest();
  __resetToastsForTest();
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

async function flush(fn: () => void) {
  await act(async () => {
    fn();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const openCard = () => flush(() => fireEvent.click(screen.getByRole("button", { name: /^Not/ })));
const noteBox = () => screen.getByRole("textbox", { name: /Görev notu/ });
const statusBox = () => screen.getByRole("combobox", { name: /Görev durumu/ });

describe("bakım kapanışında not istemi", () => {
  it("bakım kartında not kutusu 'Ne yapıldı? (isteğe bağlı)' der; temizlik kartında eski yer tutucu", async () => {
    render(<TaskBoard tasks={[base, { ...base, id: "t2", type: "cleaning", title: "Çıkış temizliği" }]} canManage />);
    await flush(() => screen.getAllByRole("button", { name: /^Not/ }).forEach((b) => fireEvent.click(b)));
    const boxes = screen.getAllByRole("textbox", { name: /Görev notu/ });
    expect(boxes.map((b) => b.getAttribute("placeholder"))).toEqual(["Ne yapıldı? (isteğe bağlı)", "Not ekleyin…"]);
  });

  it("🚨 yönetici: kutuda yazı varken 'Tamamlandı' → durum + not TEK istekte; kutu temizlenir", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[base]} canManage />);
    await openCard();
    await flush(() => fireEvent.change(noteBox(), { target: { value: "  reset yapıldı " } }));
    await flush(() => fireEvent.change(statusBox(), { target: { value: "done" } }));
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "done", note: "reset yapıldı" } }]);
    expect((noteBox() as HTMLTextAreaElement).value).toBe("");
    expect(toasts).toEqual([]);
  });

  it("🚨 personel 'Bitti': yazılı not durumla birlikte gider", async () => {
    const calls = stubFetch();
    registerConfirmHandler(async () => true);
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await openCard();
    await flush(() => fireEvent.change(noteBox(), { target: { value: "parça değişti" } }));
    await flush(() => fireEvent.click(screen.getByRole("button", { name: "Bitti" })));
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "done", note: "parça değişti" } }]);
  });

  it("🚨 (g) notsuz 'bitti' ZORUNLU DEĞİL: istek eskisi gibi { status: 'done' }; ardından kart açılır ve nazik bilgi çıkar", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[base]} canManage />);
    expect(screen.queryByRole("textbox", { name: /Görev notu/ })).toBeNull();
    await flush(() => fireEvent.change(statusBox(), { target: { value: "done" } }));
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "done" } }]);
    expect(noteBox().getAttribute("placeholder")).toBe("Ne yapıldı? (isteğe bağlı)");
    expect(toasts.map((t) => [t.variant, t.text])).toEqual([["info", "Görev tamamlandı. İsterseniz ne yapıldığını karta not olarak ekleyin."]]);
  });

  it("KONTROL — kartta zaten not varsa ya da iş bakım değilse bilgi çıkmaz; temizlikte yazı durumla GİTMEZ", async () => {
    const calls = stubFetch();
    render(
      <TaskBoard
        tasks={[{ ...base, latestNote: "usta çağrıldı" }, { ...base, id: "t2", type: "cleaning", title: "Çıkış temizliği" }]}
        canManage
      />,
    );
    const [, cleanBtn] = screen.getAllByRole("button", { name: /^Not/ });
    await flush(() => fireEvent.click(cleanBtn));
    await flush(() => fireEvent.change(noteBox(), { target: { value: "havlu eksik" } }));
    const [maint, clean] = screen.getAllByRole("combobox", { name: /Görev durumu/ });
    await flush(() => fireEvent.change(maint, { target: { value: "done" } }));
    await flush(() => fireEvent.change(clean, { target: { value: "done" } }));
    expect(calls).toEqual([
      { url: "/api/tasks/t1", body: { status: "done" } },
      { url: "/api/tasks/t2", body: { status: "done" } },
    ]);
    expect(toasts).toEqual([]);
  });

  it("KONTROL — 'Başladım' (devam ediyor) notu götürmez", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[{ ...base, status: "todo" }]} canManage={false} />);
    await openCard();
    await flush(() => fireEvent.change(noteBox(), { target: { value: "bakıyorum" } }));
    await flush(() => fireEvent.click(screen.getByRole("button", { name: "Başladım" })));
    expect(calls).toEqual([{ url: "/api/tasks/t1", body: { status: "in_progress" } }]);
  });

  it("not kutusu kendi kaydını yaparken (blur) aynı yazı durumla İKİNCİ kez gönderilmez", async () => {
    const calls = stubFetch();
    render(<TaskBoard tasks={[base]} canManage />);
    await openCard();
    await flush(() => fireEvent.change(noteBox(), { target: { value: "reset yapıldı" } }));
    await flush(() => {
      fireEvent.blur(noteBox());
      fireEvent.change(statusBox(), { target: { value: "done" } });
    });
    expect(calls).toEqual([
      { url: "/api/tasks/t1", body: { note: "reset yapıldı" } },
      { url: "/api/tasks/t1", body: { status: "done" } },
    ]);
    expect(toasts).toEqual([]);
  });
});

describe("son bakım işi satırı", () => {
  it("kart verisinde satır varsa kartta görünür, yoksa yok", () => {
    const line = "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)";
    render(<TaskBoard tasks={[{ ...base, lastMaintenance: line }, { ...base, id: "t2", title: "Bakım: klima" }]} canManage />);
    expect(screen.getAllByText(/Bu dairede son bakım işi/)).toHaveLength(1);
    expect(screen.getByText(line)).toBeTruthy();
  });
});
