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

describe("pano — yönetici bayat karttan atama (H7, Codex 11-17)", () => {
  const MEMBERS = [{ id: "u-ayse", name: "Ayşe" }, { id: "u-mehmet", name: "Mehmet" }];
  async function pick(value: string) {
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Atanan kişi: Çıkış temizliği"), { target: { value } });
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("🚨 bu arada başkasına atanmış → sunucu 409 'assignee_changed' → 'Bu görev bu arada başka birine atandı.' + pano yenilenir", async () => {
    response = { status: 409, body: { error: "Bu görev bu arada başka birine atandı.", code: "assignee_changed" } };
    render(<TaskBoard tasks={[{ ...base, status: "in_progress" }]} canManage members={MEMBERS} />);
    await pick("u-mehmet");
    expect(toasts).toEqual(["error: Bu görev bu arada başka birine atandı."]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    // Gövde: kartın gördüğü atanan ön şart, yalnız atanan sınanır.
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ assignedToId: "u-mehmet", expectAssignedToId: "u-ayse", expectAssigneeOnly: true });
  });

  it("atanmamış kart: ön şart boş dize ('atanmamış gördüm')", async () => {
    response = { status: 200, body: {} };
    render(<TaskBoard tasks={[{ ...base, assigneeId: null, assigneeName: null }]} canManage members={MEMBERS} />);
    await pick("u-ayse");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ assignedToId: "u-ayse", expectAssignedToId: "", expectAssigneeOnly: true });
    expect(toasts).toEqual([]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("KONTROL — başka 409 / hata eski mesajı korur ('Görev atanamadı.'), pano yenilenmez", async () => {
    response = { status: 409, body: { error: "Bu iş bu arada başladı ya da bitti.", code: "task_moved_on" } };
    render(<TaskBoard tasks={[base]} canManage members={MEMBERS} />);
    await pick("u-mehmet");
    expect(toasts).toEqual(["error: Görev atanamadı."]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
