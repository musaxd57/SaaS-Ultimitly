// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// Codex tur-5: iki sessiz yüzey.
//  • Görev notu YALNIZ blur'da ve görünür durum olmadan kaydediliyordu —
//    kullanıcı sayfadan ayrılırken notun gidip gitmediğini bilemiyordu.
//  • Çıkış (ve operatör çıkışı) başarısız olduğunda buton sessizce geri
//    açılıyordu; kullanıcı tıklamasının hiç işlemediğini sanıyordu.
// Ayrıca kartın durum seçimi ve not alanının erişilebilir adı yoktu: 20 kartlık
// bir panoda ekran okuyucu 20 tane ayırt edilemez kontrol duyuyordu.

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/tasks",
}));

import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { AppShell } from "@/components/shell/app-shell";

const task: TaskCardData = {
  id: "task-1",
  title: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Daire 1",
  assigneeName: null,
  dueLabel: null,
  dueDays: null,
  checklist: null,
};

describe("TaskBoard — not kaydı görünür ve etiketli", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function openDetails() {
    render(<TaskBoard tasks={[task]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Not \/ fotoğraf/ }));
    });
  }

  it("durum seçimi ve not alanının ERİŞİLEBİLİR ADI var (görev adıyla ayrışır)", async () => {
    await openDetails();
    expect(screen.getByLabelText(/Görev durumu: Çıkış temizliği/)).toBeTruthy();
    expect(screen.getByLabelText(/Görev notu: Çıkış temizliği/)).toBeTruthy();
  });

  it("AÇIK Kaydet düğmesi vardır; boşken pasif, yazınca aktif", async () => {
    await openDetails();
    const btn = screen.getByRole("button", { name: "Notu kaydet" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true); // boş not gönderilmez
    fireEvent.change(screen.getByLabelText(/Görev notu/), { target: { value: "Anahtar kutuda" } });
    expect((screen.getByRole("button", { name: "Notu kaydet" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("kayıt DURUMU ekranda: Kaydediliyor… → Kaydedildi; yazmaya başlayınca kalkar", async () => {
    let resolve!: (r: Response) => void;
    const inflight = new Promise<Response>((r) => (resolve = r));
    vi.stubGlobal("fetch", vi.fn(() => inflight));
    await openDetails();
    fireEvent.change(screen.getByLabelText(/Görev notu/), { target: { value: "Not" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notu kaydet" }));
    });
    expect(screen.getByText("Kaydediliyor…")).toBeTruthy();

    await act(async () => {
      resolve(new Response("{}", { status: 200 }));
    });
    await screen.findByText("Kaydedildi");

    // Zamanlayıcı YOK: onay, kullanıcı yeniden yazana kadar durur.
    fireEvent.change(screen.getByLabelText(/Görev notu/), { target: { value: "Yeni" } });
    expect(screen.queryByText("Kaydedildi")).toBeNull();
  });

  it("blur güvenlik ağı DURUYOR ama çift göndermez (düğme + blur tek istek)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await openDetails();
    const field = screen.getByLabelText(/Görev notu/);
    fireEvent.change(field, { target: { value: "Tek istek" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notu kaydet" }));
      fireEvent.blur(field);
    });
    // Başarılı kayıt alanı temizler → blur'un ikinci çağrısı boş nota düşer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("YARIŞ: A kaydedilirken metin B olunca, A biten istekte B ne silinir ne 'Kaydedildi' der", async () => {
    // Codex: sonuç GÖNDERİLEN metne bağlanmalı. Aksi hâlde A'nın yanıtı gelince
    // (a) alan temizlenip B YOK OLUYOR, (b) hiç kaydedilmemiş B için "Kaydedildi"
    // yazıyordu — iki kere yalan.
    let resolveA!: (r: Response) => void;
    const inflight = new Promise<Response>((r) => (resolveA = r));
    const bodies: string[] = [];
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts?: RequestInit) => {
        bodies.push(JSON.parse(String(opts?.body)).note);
        if (first) {
          first = false;
          return inflight;
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
    await openDetails();
    const field = screen.getByLabelText(/Görev notu/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "A" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notu kaydet" }));
    });
    // Cevap gelmeden kullanıcı metni değiştiriyor…
    fireEvent.change(field, { target: { value: "B" } });
    // …ve A'nın cevabı şimdi geliyor.
    await act(async () => {
      resolveA(new Response("{}", { status: 200 }));
    });

    expect((screen.getByLabelText(/Görev notu/) as HTMLTextAreaElement).value).toBe("B"); // silinmedi
    expect(screen.queryByText("Kaydedildi")).toBeNull(); // B için YALAN onay yok
    expect(screen.queryByText("Kaydediliyor…")).toBeNull(); // takılı durum yok

    // B yeniden kaydedilebilir ve GİDEN gövde B'dir.
    const btn = screen.getByRole("button", { name: "Notu kaydet" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(bodies).toEqual(["A", "B"]));
    await screen.findByText("Kaydedildi");
  });

  it("başarısız kayıtta yazılan not KAYBOLMAZ ve hata görünür", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await openDetails();
    fireEvent.change(screen.getByLabelText(/Görev notu/), { target: { value: "Kaybolmasın" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notu kaydet" }));
    });
    await screen.findByText("Not kaydedilemedi, tekrar deneyin.");
    expect((screen.getByLabelText(/Görev notu/) as HTMLTextAreaElement).value).toBe("Kaybolmasın");
    expect(screen.queryByText("Kaydediliyor…")).toBeNull(); // takılı spinner yok
  });
});

describe("AppShell — çıkış başarısız olduğunda SEBEBİ söylenir", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const shellProps = {
    user: { name: "Musa", email: "a@b.com", role: "owner", orgName: "Nuve" },
    superAdmin: false,
    guestChatEnabled: false,
    impersonating: false,
    plan: null,
  } as unknown as React.ComponentProps<typeof AppShell>;

  it("500'de yönlendirme YOK, hata mesajı VAR (buton sessizce geri açılmaz)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<AppShell {...shellProps}>içerik</AppShell>);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Çıkış/ })[0]);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Çıkış yapılamadı");
    expect(push).not.toHaveBeenCalled(); // oturum kapanmadan yönlendirme yok
  });

  it("çıkış BAŞARISIZ olunca odak ÇIKIŞ düğmesine döner (yeniden denenebilsin)", async () => {
    // Başarısız çıkışta kullanıcı HÂLÂ oturumda ve tek yapması gereken tekrar
    // denemek. `disabled={loggingOut}` odağı <body>'ye düşürüyordu; hata
    // duyuruluyor ama düğmeye ulaşmak için baştan Tab'lamak gerekiyordu.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<AppShell {...shellProps}>içerik</AppShell>);
    const btn = screen.getAllByRole("button", { name: /Çıkış/ })[0];
    await act(async () => {
      fireEvent.click(btn);
    });
    await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it("ağ hatasında da sessiz kalmaz ve uyarı kapatılabilir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    render(<AppShell {...shellProps}>içerik</AppShell>);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Çıkış/ })[0]);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Bağlantı hatası");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Uyarıyı kapat" }));
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
