// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// UI turu (Codex 07-23 #7): mobil drawer'ın modal sözleşmesi (dialog semantiği +
// body scroll-lock + focus restore) ve logout/exit'in `res.ok` disiplini —
// fetch HTTP 500'de throw ETMEZ; eski kod çerez temizlenmemişken login'e
// yönlendirip "çıktım" sandırıyordu.

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push, refresh }),
}));

import { AppShell } from "@/components/shell/app-shell";

function renderShell() {
  return render(
    <AppShell
      user={{ name: "Owner", email: "o@x.com", role: "owner", orgName: "Org" } as never}
      superAdmin={false}
      guestChatEnabled={false}
      impersonating={null}
    >
      <div>içerik</div>
    </AppShell>,
  );
}

describe("AppShell — mobil drawer modal sözleşmesi + logout res.ok", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  it("drawer açılınca dialog semantiği + body scroll-lock; Escape kapatır, scroll geri gelir, focus hamburger'a döner", async () => {
    renderShell();
    const burger = screen.getByRole("button", { name: "Menüyü aç" });
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    burger.focus();
    await act(async () => {
      fireEvent.click(burger);
    });
    const dialog = screen.getByRole("dialog", { name: "Ana menü" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden"); // arkaplan kilitli
    expect(screen.getByRole("button", { name: "Menüyü aç" }).getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe(""); // kilit kalktı
    expect(document.activeElement).toBe(burger); // focus restore
  });

  it("impersonation exit: HTTP 500'de /admin'e YÖNLENDİRME YOK (yanlış bağlam riski); 200'de gider", async () => {
    render(
      <AppShell
        user={{ name: "Owner", email: "o@x.com", role: "owner", orgName: "Org" } as never}
        superAdmin={false}
        guestChatEnabled={false}
        impersonating={{ orgName: "Müşteri", actorName: "Operatör" } as never}
      >
        <div>içerik</div>
      </AppShell>,
    );
    const exitBtn = screen.getByRole("button", { name: /Kendi hesabıma dön/ });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await act(async () => {
      fireEvent.click(exitBtn);
    });
    expect(push).not.toHaveBeenCalled(); // impersonation hâlâ aktif — /admin'e gitmek yanlış bağlam olurdu
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kendi hesabıma dön/ }));
    });
    expect(push).toHaveBeenCalledWith("/admin");
    vi.unstubAllGlobals();
  });

  it("logout: HTTP 500'de YÖNLENDİRME YOK (buton geri açılır); 200'de /login'e gider", async () => {
    renderShell();
    const logoutBtn = screen.getAllByRole("button", { name: /Çıkış/ })[0];
    // 500 → redirect yok.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await act(async () => {
      fireEvent.click(logoutBtn);
    });
    expect(push).not.toHaveBeenCalled();
    // 200 → login'e yönlendirir.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Çıkış/ })[0]);
    });
    expect(push).toHaveBeenCalledWith("/login");
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// SIDEBAR YOĞUNLUĞU — ÖLÇÜLMÜŞ, DRIFT'E KAPALI.
//
// Kullanıcı "sanki çok çok ufak" dedi ve sebebi ölçüldü: ikonlar `size-4.5`
// yazıyordu ama o sınıf ölçekte olmadığı için HİÇ CSS üretmiyordu → lucide'ın
// varsayılanı 24px'te çiziliyorlardı. Sınıf çalışır hâle gelince 18px'e
// düştüler. Şimdiki değerler: satır 40px (`py-2.5` + 20px satır kutusu), ikon
// 20px. Yazı boyutu bilerek `text-sm` — kullanıcı "font aynı kalsa da olur"
// dedi, yani BÜYÜTÜLMESİNİ istemedi.
//
// ⚠️ Bu blok sınıf ADI değil, RENDER EDİLMİŞ çıktıyı karşılaştırıyor: asıl
// değişmez "iki satır BİRBİRİNİN AYNI" — gezinme listesi ile Operatör Paneli
// aynı listenin parçası gibi okunuyor ve biri güncellenip diğeri unutulursa
// göze batacak şekilde ayrışır (aynı sınıf iki ayrı yerde yazılı).
// ---------------------------------------------------------------------------
describe("AppShell — sidebar satır ölçüsü", () => {
  beforeEach(cleanup);

  function renderWithAdmin() {
    return render(
      <AppShell
        user={{ name: "Owner", email: "o@x.com", role: "owner", orgName: "Org" } as never}
        superAdmin
        guestChatEnabled={false}
        impersonating={null}
      >
        <div>içerik</div>
      </AppShell>,
    );
  }

  it("Operatör Paneli satırı gezinme satırlarıyla BİREBİR aynı sınıfları taşır", () => {
    renderWithAdmin();
    // `getAllBy…` — aynı ağaç masaüstü sidebar'ında bir kez render ediliyor.
    const navRow = screen.getAllByRole("link", { name: "Panel" })[0];
    const adminRow = screen.getAllByRole("link", { name: "Operatör Paneli" })[0];
    expect(adminRow.className).toBe(navRow.className.replace("bg-primary text-primary-foreground", "text-muted-foreground hover:bg-accent hover:text-accent-foreground"));
    // İkonlar da aynı boyutta (satır yüksekliğine bedava — 20px satır kutusu).
    expect(navRow.querySelector("svg")?.getAttribute("class")).toContain("size-5");
    expect(adminRow.querySelector("svg")?.getAttribute("class")).toContain("size-5");
  });

  it("🚨 gezinme kabı `mt-4` — `mt-6`ya dönmek 768px'te kaydırma çubuğu doğurur", () => {
    // Aritmetik (CSS px, `zoom:.95` öncesi): p-4 32 + marka 32 + mt 16 +
    // (14 satır × 40 + 13 boşluk × 4 = 612) + kart mt 16 + kart 95 = 803.
    // Kullanılabilir alan `100vh/0.95` = 808.4 → 5.4 px pay. `mt-6` ile 811 →
    // 2.6 px taşma. Yani bu değer kozmetik değil, sığdıran şeyin ta kendisi.
    renderWithAdmin();
    const container = screen.getAllByRole("link", { name: "Panel" })[0].closest("nav")?.parentElement;
    expect(container?.className).toContain("mt-4");
    expect(container?.className).not.toContain("mt-6");
    expect(container?.className).toContain("overflow-y-auto"); // taşarsa kart ezilmez, nav kayar
  });
});
