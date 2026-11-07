// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// K-1 (kurucu / Codex 11-06): "Eski sekmeden 'Başladım' sunucuda kontrol edilmeli." Sunucu zaten yazmaz (görev bu kişiye atalı değilse 403);
// sunucu bu durumu ayrı kodla (`not_assigned`) söyler. Pano "yetkiniz yok" yerine ne olduğunu söyler ve listeyi YENİLER (kart kaybolur).
// Not yazarken: "tekrar deneyin" denmez (tekrar da tutmaz) ve liste yenilenmez — yazılan not ekranda kalır.
// ---------------------------------------------------------------------------

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { subscribeToasts, __resetToastsForTest } from "@/lib/toast";

const base: TaskCardData = {
  id: "t1",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Lale",
  assigneeName: "Ayşe",
  assigneeId: "u-ayse",
  dueLabel: "07 Kas 2026",
  dueDays: 0,
  checklist: null,
};

let toasts: string[];
let response: { status: number; body: unknown };
beforeEach(() => {
  toasts = [];
  nav.refresh.mockClear();
  subscribeToasts((m) => toasts.push(`${m.variant}: ${m.text}`));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(response.body), { status: response.status })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetToastsForTest();
});

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

describe("pano — görev sayfa açıkken başkasına verildi (eski sekme)", () => {
  it("🚨 personel 'Başladım' → sunucu 'not_assigned' → 'Bu görev artık sizin listenizde değil.' + liste yenilenir", async () => {
    response = { status: 403, body: { error: "Bu görev size atanmamış.", code: "not_assigned" } };
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await click("Başladım");
    expect(toasts).toEqual(["error: Bu görev artık sizin listenizde değil."]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("🚨 personel 'Yapamıyorum' → 'Ev sahibine bildir' → aynı mesaj, form kapanır, liste yenilenir", async () => {
    response = { status: 403, body: { error: "Bu görev size atanmamış.", code: "not_assigned" } };
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await click("Yapamıyorum");
    await click("Ev sahibine bildir");
    expect(toasts).toEqual(["error: Bu görev artık sizin listenizde değil."]);
    expect(screen.queryByRole("button", { name: "Ev sahibine bildir" })).toBeNull();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("not kaydı → kart içinde aynı mesaj; liste YENİLENMEZ, yazılan not yerinde kalır", async () => {
    response = { status: 403, body: { error: "Bu görev size atanmamış.", code: "not_assigned" } };
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Not \/ fotoğraf/ }));
    });
    const box = screen.getByLabelText("Görev notu: Çıkış temizliği") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "Anahtar kapıda" } });
    });
    await click("Notu kaydet");
    expect(screen.getByText("Bu görev artık sizin listenizde değil.")).toBeTruthy();
    expect(box.value).toBe("Anahtar kapıda");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("KONTROL — kodsuz 403 (ör. destek görünümü) eski mesajı korur ve sayfayı yenilemez", async () => {
    response = { status: 403, body: { error: "Destek görünümünde değişiklik yapılamaz." } };
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await click("Başladım");
    expect(toasts).toEqual(["error: Bu işlem için yetkiniz yok."]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("KONTROL — başarılı 'Başladım' mesaj göstermez, listeyi yeniler", async () => {
    response = { status: 200, body: {} };
    render(<TaskBoard tasks={[base]} canManage={false} />);
    await click("Başladım");
    expect(toasts).toEqual([]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});
