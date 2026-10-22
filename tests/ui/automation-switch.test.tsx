// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// U5 (kurucu 10-22: "Olur ama güzel yap görünüşü yerinide"): Ayarlar → AI ve Otomasyon sekmesinin EN ÜSTÜNDE "Otomasyon durumu" kartı;
// dört anahtar gerçek açma / kapama biçiminde (`role="switch"`, ray + top) ve durumu yazıyla da okunur. Davranış aynı: aynı PATCH, aynı
// abonelik kilidi. Mesajlar başlığındaki çip görünümü değişmedi.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";

describe("AutoReplyToggle — anahtar görünümü", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("role=switch + aria-checked + açıklama bağlantısı; tıklayınca aynı PATCH ve durum yazısı değişir", async () => {
    render(
      <>
        <p id="d1">Rezervasyon onaylanınca bir kez gider.</p>
        <AutoReplyToggle variant="switch" field="autoWelcome" label="Karşılama mesajı" enabled={false} describedBy="d1" />
      </>,
    );
    const sw = screen.getByRole("switch", { name: "Karşılama mesajı" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.getAttribute("aria-describedby")).toBe("d1");
    expect(screen.getByText("Kapalı")).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText("Açık")).toBeTruthy();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ autoWelcome: true });
    expect(refresh).toHaveBeenCalled();
  });

  it("kilitli: anahtar devre dışı, 'Kilitli' yazar, istek gitmez (açık kayıtlı olsa da açık görünmez)", () => {
    render(<AutoReplyToggle variant="switch" field="autoCheckout" label="Çıkış mesajı" enabled locked />);
    const sw = screen.getByRole("switch", { name: "Çıkış mesajı" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Kilitli")).toBeTruthy();
    fireEvent.click(sw);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("çip görünümü (varsayılan) değişmedi: düğme + aria-pressed", () => {
    render(<AutoReplyToggle field="autoReplyHospitable" label="AI" enabled />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Ayarlar sayfası yerleşimi (kaynak)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/(app)/settings/page.tsx"), "utf8");
  it("Otomasyon durumu kartı AI ve Otomasyon sekmesinin İLK öğesi; dört alan da kartta, anahtarlar başka yerde tekrar etmez", () => {
    const tab = src.slice(src.indexOf('"ai-otomasyon": ('));
    expect(tab.indexOf("{automationStatusView}")).toBeGreaterThan(-1);
    expect(tab.indexOf("{automationStatusView}")).toBeLessThan(tab.indexOf("{aiView}"));
    for (const f of ["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout"]) {
      expect(src).toContain(`field: "${f}" as const`);
      expect(src).not.toContain(`field="${f}"`); // ikinci kontrol yok (durum ayrışırdı)
    }
    expect((src.match(/<AutoReplyToggle/g) ?? []).length).toBe(1);
  });
});
