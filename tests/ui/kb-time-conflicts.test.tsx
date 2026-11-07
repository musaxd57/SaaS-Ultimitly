// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Bilgi Tabanı "Uyuşmayan saatler" bloğu: çelişki DÜZELTMENİN yapılacağı yerde görünür (satır,
// ilgili cümle, "Mülk ayarlarını aç" bağlantısı, kalemin yanında rozet); çelişki yoksa blok YOK.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbManager, type KbItem } from "@/components/knowledge/kb-manager";
import { kbTimeConflicts } from "@/lib/kb-time-conflicts";

const PROPS = [{ id: "p1", name: "Lale 1" }];
const ITEM: KbItem = {
  id: "k1",
  propertyId: "p1",
  propertyName: "Lale 1",
  category: "checkout",
  title: "Çıkış",
  content: "Çıkış saati 12:00'dir; anahtarı masaya bırakın.",
  language: "tr",
  isActive: true,
};

describe("KbManager — uyuşmayan saatler", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fromTemplates: [] }) })));
  });

  it("çelişki satırı, cümle, mülk ayarları bağlantısı ve kalem rozeti görünür", () => {
    const rows = kbTimeConflicts({ checkInTime: "15:00", checkOutTime: "11:00" }, [ITEM]);
    render(<KbManager properties={PROPS} items={[ITEM]} timeConflicts={{ p1: rows }} />);
    const block = screen.getByTestId("kb-time-conflicts");
    expect(block.textContent).toContain("Uyuşmayan saatler");
    expect(block.textContent).toContain("Çıkış saati: mülk ayarlarında 11:00, “Çıkış” bilgisinde 12:00 yazıyor.");
    expect(block.textContent).toContain("“Çıkış”: Çıkış saati 12:00'dir");
    // Kurucu T4 (10-21): bilgi tabanı kalemi otomatik mesaj DEĞİL → otomatik mesaj notu yok.
    expect(block.textContent).not.toContain("Otomatik mesajdaki saat");
    expect(screen.getByRole("link", { name: "Mülk ayarlarını aç" }).getAttribute("href")).toBe("/properties/p1");
    expect(screen.getByText("Saat uyuşmuyor")).toBeTruthy();
  });

  it("kurucu T4: dairenin otomatik çıkış mesajı çelişirse satırda 'otomatik mesaj' notu görünür", () => {
    const rows = kbTimeConflicts({ checkInTime: "15:00", checkOutTime: "11:00" }, [
      { id: "auto-message:a1", title: "Çıkış mesajı", category: "checkout", content: "Çıkış saati 12:00'dir.", sentAutomatically: true },
    ]);
    render(<KbManager properties={PROPS} items={[]} timeConflicts={{ p1: rows }} />);
    expect(screen.getByTestId("kb-time-conflicts").textContent).toContain("Otomatik mesajdaki saat misafire aynen gider");
  });

  it("çelişki yoksa blok ve rozet YOK", () => {
    render(<KbManager properties={PROPS} items={[{ ...ITEM, content: "Çıkış saati 11:00'dir." }]} timeConflicts={{}} />);
    expect(screen.queryByTestId("kb-time-conflicts")).toBeNull();
    expect(screen.queryByText("Saat uyuşmuyor")).toBeNull();
  });
});
