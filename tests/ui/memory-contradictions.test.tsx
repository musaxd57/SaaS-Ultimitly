// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// Değişmez 13 (kurucu 10-11): Mülk Hafızası olası çelişki uyarısı — "Bilerek böyle" yalnız o uyarının kalemlerini gönderir; hata görünür.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { MemoryContradictions } from "@/components/properties/memory-contradictions";

const ITEMS = [
  { memoryIds: ["m1", "m2"], text: 'Bilgi tabanında "Wi-Fi" bilgisi var, ama son 30 günde 3 misafir bu konuda sorun bildirdi. Bilgi güncel mi?' },
  { memoryIds: ["m9"], text: "Giriş saati: mülk ayarı 15:00, bilgi tabanı 14:00." },
];

describe("MemoryContradictions", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uyarı yoksa hiçbir şey çizilmez", () => {
    render(<MemoryContradictions propertyId="p1" items={[]} />);
    expect(screen.queryByTestId("memory-contradictions")).toBeNull();
  });

  it("'Bilerek böyle' YALNIZ o uyarının kalemlerini gönderir ve sayfayı yeniler", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, count: 2 }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryContradictions propertyId="p1" items={ITEMS} />);
    expect(screen.getByText(ITEMS[0].text)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Bilerek böyle" })[0]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/properties/p1/memory-acknowledge");
    expect(JSON.parse(String(init.body))).toEqual({ memoryIds: ["m1", "m2"] });
    expect(refresh).toHaveBeenCalled();
  });

  it("sunucu reddederse hata görünür, sayfa yenilenmez", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    render(<MemoryContradictions propertyId="p1" items={ITEMS} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Bilerek böyle" })[1]);
    });
    expect(screen.getByRole("alert").textContent).toContain("İşaretlenemedi");
    expect(refresh).not.toHaveBeenCalled();
  });
});
