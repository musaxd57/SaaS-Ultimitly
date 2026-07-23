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
