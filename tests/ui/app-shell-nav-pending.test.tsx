// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPlainNavigationClick, navigationSettled, remainingPendingMs, NAV_PENDING_MAX_MS, ROUTE_SKELETON_ATTR } from "@/components/shell/nav-pending";

// ---------------------------------------------------------------------------
// HZ2 — MENÜ TIKLAMASINDA ANINDA GERİ BİLDİRİM (kurucu 10-29 gece: "hz2 için önerini beğendim").
// Kurucunun şartları, her biri ayrı vaka:
//  · tıklamada ANINDA işaret (tıklanan bağlantı seçili + üst çubukta bekleme şeridi);
//  · "geçiş başladı" ≠ "veri hazır": adres değişse de rota iskeleti ekrandayken şerit sürer, iskelet kalkınca biter;
//  · hata / 404 / başka yere gitme / yeni tıklama: doğru biter; ASLA sonsuz dönmez (15 sn); bağlantılar ASLA kilitlenmez;
//  · mobilde menü kapandıktan sonra da üst çubukta görünür;
//  · Cmd / Ctrl tık (yeni sekme) ve açık sayfaya tıklama bekleme göstermez.
// ---------------------------------------------------------------------------

let pathname = "/dashboard";
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, refresh }),
}));

import { AppShell } from "@/components/shell/app-shell";

const shell = () => (
  <AppShell user={{ name: "Owner", email: "o@x.com", role: "owner", orgName: "Org" } as never} guestChatEnabled={false} impersonating={null}>
    <div>içerik</div>
  </AppShell>
);
const indicator = () => screen.queryByTestId("nav-pending");
/** Kenar çubuğundaki (masaüstü) bağlantı. */
const navLink = (name: string) => screen.getAllByRole("link", { name })[0];
const isHighlighted = (el: HTMLElement) => el.className.includes("bg-primary text-primary-foreground");

/** Next'in gezinme anını taklit: adres değişir, yol değişir, (isteğe bağlı) rota iskeleti görünür. */
function commitNavigation(to: string, withSkeleton: boolean, rerender: (ui: React.ReactElement) => void) {
  window.history.pushState({}, "", to);
  pathname = to.split("?")[0];
  if (withSkeleton) {
    const sk = document.createElement("div");
    sk.setAttribute(ROUTE_SKELETON_ATTR, "");
    sk.id = "sk";
    document.body.appendChild(sk);
  }
  rerender(shell());
}

describe("nav-pending saf kuralları", () => {
  const ev = (over: Partial<Parameters<typeof isPlainNavigationClick>[0]> = {}) => ({
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    currentTarget: { getAttribute: () => null }, ...over,
  });
  it("yalnız düz sol tık gezinme sayılır", () => {
    expect(isPlainNavigationClick(ev())).toBe(true);
    for (const o of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }])
      expect(isPlainNavigationClick(ev(o)), JSON.stringify(o)).toBe(false);
    expect(isPlainNavigationClick(ev({ currentTarget: { getAttribute: () => "_blank" } }))).toBe(false);
  });
  it("bitiş = adres değişti VE iskelet yok", () => {
    expect(navigationSettled("http://x/a", "http://x/a", false)).toBe(false);
    expect(navigationSettled("http://x/a", "http://x/b", true)).toBe(false);
    expect(navigationSettled("http://x/a", "http://x/b", false)).toBe(true);
    // Yalnız sorgu değişse de biter (/billing → /settings?tab=…).
    expect(navigationSettled("http://x/settings", "http://x/settings?tab=faturalandirma", false)).toBe(true);
    // C14 (10-30): bekleme sırasında bir kez ayrılmış adres başlangıca dönünce de biter (geri tuşu); iskelet varken bitmez.
    expect(navigationSettled("http://x/a", "http://x/a", false, true)).toBe(true);
    expect(navigationSettled("http://x/a", "http://x/a", true, true)).toBe(false);
  });
  it("güvenlik süresi TIKLAMADAN ölçülür (C15)", () => {
    expect(remainingPendingMs(1_000, 1_000)).toBe(NAV_PENDING_MAX_MS);
    expect(remainingPendingMs(1_000, 4_000)).toBe(NAV_PENDING_MAX_MS - 3_000);
    expect(remainingPendingMs(1_000, 1_000 + NAV_PENDING_MAX_MS + 5)).toBe(0);
  });
  it("her rota iskeleti (loading.tsx kökü) işareti taşır — taşımayan iskelette şerit erken biterdi", () => {
    const appDir = join(process.cwd(), "src", "app");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n === "loading.tsx" ? [join(d, n)] : []));
    const files = walk(appDir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src.includes(ROUTE_SKELETON_ATTR) || src.includes("SkeletonScreen"), f).toBe(true);
    }
    expect(readFileSync(join(process.cwd(), "src/components/ui/skeleton.tsx"), "utf8")).toContain(ROUTE_SKELETON_ATTR);
  });
});

describe("AppShell — menü geçişi bekleme şeridi", () => {
  beforeEach(() => {
    cleanup();
    pathname = "/dashboard";
    window.history.replaceState({}, "", "/dashboard");
    document.getElementById("sk")?.remove();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("sk")?.remove();
  });

  it("tıklamada ANINDA: şerit + tıklanan bağlantı seçili (eski sayfa bağlantısı değil)", () => {
    render(shell());
    expect(indicator()).toBeNull();
    fireEvent.click(navLink("Mesajlar"));
    expect(indicator()).not.toBeNull();
    // C16 (10-30): ekran okuyucu durumu TEK kez duyar — şerit görsel (aria-hidden), metin yalnız canlı bölgede.
    expect(screen.getAllByText("Sayfa yükleniyor")).toHaveLength(1);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(indicator()!.getAttribute("aria-hidden")).toBe("true");
    expect(isHighlighted(navLink("Mesajlar"))).toBe(true);
    expect(isHighlighted(navLink("Panel"))).toBe(false);
  });

  it("veri hazır ≠ gezinme başladı: iskelet ekrandayken sürer, iskelet kalkınca biter", async () => {
    const { rerender } = render(shell());
    fireEvent.click(navLink("Mesajlar"));
    await act(async () => commitNavigation("/inbox", true, rerender));
    expect(indicator()).not.toBeNull();
    await act(async () => {
      document.getElementById("sk")!.remove();
      await Promise.resolve();
    });
    expect(indicator()).toBeNull();
    expect(isHighlighted(navLink("Mesajlar"))).toBe(true);
  });

  it("önbellekten anında gelen sayfa (iskelet yok) → hemen biter", async () => {
    const { rerender } = render(shell());
    fireEvent.click(navLink("Görevler"));
    await act(async () => commitNavigation("/tasks", false, rerender));
    expect(indicator()).toBeNull();
  });

  it("yalnız sorgu değişen yönlendirme de biter (aynı yol, farklı adres)", async () => {
    pathname = "/settings";
    window.history.replaceState({}, "", "/settings");
    const { rerender } = render(shell());
    fireEvent.click(navLink("Mesajlar"));
    // Sunucu başka adrese yönlendirdi (ör. /billing → /settings?tab=…): yol aynı kalsa da adres değişti.
    await act(async () => commitNavigation("/settings?tab=faturalandirma", false, rerender));
    // DOM değişmedi (aynı yol) → yoklama yakalar.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(indicator()).toBeNull();
  });

  it("hiç bitmeyen gezinme sonsuz dönmez: 15 sn sonra kalkar; bağlantılar baştan sona tıklanabilir", async () => {
    vi.useFakeTimers();
    render(shell());
    fireEvent.click(navLink("Raporlar"));
    expect(indicator()).not.toBeNull();
    expect(navLink("Ayarlar").getAttribute("aria-disabled")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(NAV_PENDING_MAX_MS - 1);
    });
    expect(indicator()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(indicator()).toBeNull();
  });

  it("C14 (10-30): sayfa geldikten sonra geri tuşuyla başlangıç sayfasına dönüş → şerit biter, doğru menü seçili", async () => {
    const { rerender } = render(shell());
    fireEvent.click(navLink("Mesajlar"));
    await act(async () => commitNavigation("/inbox", true, rerender));
    expect(indicator()).not.toBeNull();
    await act(async () => {
      document.getElementById("sk")!.remove();
      window.history.replaceState({}, "", "/dashboard");
      pathname = "/dashboard";
      rerender(shell());
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(indicator()).toBeNull();
    expect(isHighlighted(navLink("Panel"))).toBe(true);
    expect(isHighlighted(navLink("Mesajlar"))).toBe(false);
  });

  it("C14: sayfa gelmeden açık sayfanın menü bağlantısına (ya da logoya) tık bekleyen gezinmeyi iptal eder", () => {
    render(shell());
    fireEvent.click(navLink("Mesajlar"));
    expect(indicator()).not.toBeNull();
    fireEvent.click(navLink("Panel"));
    expect(indicator()).toBeNull();
    expect(isHighlighted(navLink("Panel"))).toBe(true);
    fireEvent.click(navLink("Mesajlar"));
    expect(indicator()).not.toBeNull();
    const logo = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/dashboard" && !a.textContent?.includes("Panel"))!;
    fireEvent.click(logo);
    expect(indicator()).toBeNull();
  });

  it("Haiku 10-30: sayfa içi atlama bağlantısı (#icerik) beklemeyi iptal etmez", () => {
    render(shell());
    fireEvent.click(navLink("Mesajlar"));
    const skip = screen.getAllByRole("link").find((a) => (a.getAttribute("href") ?? "").startsWith("#"));
    expect(skip).toBeTruthy();
    fireEvent.click(skip!);
    expect(indicator()).not.toBeNull();
  });

  it("Haiku 10-30: aynı menüye ikinci tık 15 sn'yi yeniden başlatmaz", async () => {
    vi.useFakeTimers();
    render(shell());
    fireEvent.click(navLink("Raporlar"));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(navLink("Raporlar"));
    await act(async () => {
      vi.advanceTimersByTime(NAV_PENDING_MAX_MS - 10_000 + 1);
    });
    expect(indicator()).toBeNull();
  });

  it("C14 KONTROL: aynı menü bağlantısına ikinci tık beklemeyi iptal etmez", () => {
    render(shell());
    fireEvent.click(navLink("Mesajlar"));
    fireEvent.click(navLink("Mesajlar"));
    expect(indicator()).not.toBeNull();
    expect(isHighlighted(navLink("Mesajlar"))).toBe(true);
  });

  it("C15 (10-30): güvenlik süresi yol değişiminde baştan başlamaz — tıklamadan 15 sn sonra kalkar", async () => {
    vi.useFakeTimers();
    const { rerender } = render(shell());
    fireEvent.click(navLink("Raporlar"));
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => commitNavigation("/reports", true, rerender));
    expect(indicator()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(NAV_PENDING_MAX_MS - 3_000 + 1);
    });
    expect(indicator()).toBeNull();
  });

  it("yeni tıklama öncekini ezer (iptal / başka yere gitme)", () => {
    render(shell());
    fireEvent.click(navLink("Mesajlar"));
    fireEvent.click(navLink("Takvim"));
    expect(isHighlighted(navLink("Takvim"))).toBe(true);
    expect(isHighlighted(navLink("Mesajlar"))).toBe(false);
    expect(indicator()).not.toBeNull();
  });

  it("Cmd / Ctrl tık (yeni sekme) ve açık sayfaya tıklama bekleme göstermez", () => {
    render(shell());
    fireEvent.click(navLink("Mesajlar"), { ctrlKey: true });
    fireEvent.click(navLink("Mesajlar"), { metaKey: true });
    fireEvent.click(navLink("Panel"));
    expect(indicator()).toBeNull();
    expect(isHighlighted(navLink("Panel"))).toBe(true);
  });

  it("mobil: menüden tıklayınca menü kapanır, şerit üst çubukta görünür kalır", async () => {
    render(shell());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Menüyü aç" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Ana menü" });
    const drawerLink = Array.from(dialog.querySelectorAll("a")).find((a) => a.textContent?.includes("Mülkler"))!;
    await act(async () => {
      fireEvent.click(drawerLink);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    const bar = indicator();
    expect(bar).not.toBeNull();
    expect(bar!.closest("header")).not.toBeNull();
  });
});
