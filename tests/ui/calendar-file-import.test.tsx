// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Dosyadan içe aktar" paneli (Codex, 09-08): .ics seç/sürükle → ÖNİZLEME (mülk adı +
// eklenecek/güncellenecek/iptal/atlanacak) → "İçe aktar" → sonuç; hata görünür; tek
// seferlik olduğu ve URL senkronizasyonundan AYRI olduğu açıkça yazar.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { CalendarFileImport } from "@/components/properties/calendar-file-import";

const PREVIEW = {
  preview: true,
  property: { id: "p1", name: "Test Dairesi" },
  counts: { create: 1, update: 0, cancel: 1, skipped: 1 },
  rows: [
    { line: 1, uid: "a@x", guestName: "A", arrival: "2026-10-14", departure: "2026-10-17", action: "create", reason: null },
    { line: 2, uid: "b@x", guestName: "B", arrival: "2026-10-20", departure: "2026-10-22", action: "cancel", reason: null },
    { line: 3, uid: "c@x", guestName: "C", arrival: "2026-11-01", departure: "2026-11-03", action: "skip", reason: "owned_by_feed" },
  ],
  total: 3,
};

function stubFetch(seq: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = seq.shift() ?? { ok: false, status: 500, body: { error: "beklenmeyen" } };
    return { ok: next.ok, status: next.status ?? (next.ok ? 200 : 400), json: async () => next.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function pickFile(name = "test-reservation.ics") {
  const input = screen.getByLabelText(".ics dosyası seç") as HTMLInputElement;
  const file = new File(["BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"], name, { type: "text/calendar" });
  return act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe("CalendarFileImport — tek seferlik .ics aktarımı", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("tek seferlik olduğunu ve URL senkronizasyonundan AYRI olduğunu açıkça söyler", () => {
    render(<CalendarFileImport propertyId="p1" />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/tek seferlik/i);
    expect(text).toMatch(/senkroniz/i);
    expect(text).toMatch(/eksik/i); // dosyada olmayan kayıt iptal edilmez
  });

  it("dosya seçilince ÖNİZLEME ister (mode=preview) ve mülk + sayıları gösterir; sonra 'İçe aktar' gerçek aktarımı yapar ve sonucu gösterir", async () => {
    const { fetchMock, calls } = stubFetch([
      { ok: true, body: PREVIEW },
      { ok: true, body: { imported: 1, updated: 0, cancelled: 1, skipped: 1, errors: [] } },
    ]);
    render(<CalendarFileImport propertyId="p1" />);
    await pickFile();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe("/api/reservations/import");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("mode")).toBe("preview");
    expect(fd.get("propertyId")).toBe("p1");
    expect((fd.get("file") as File).name).toBe("test-reservation.ics");

    const text = () => document.body.textContent ?? "";
    expect(text()).toContain("Test Dairesi");
    expect(text()).toMatch(/1 eklenecek/);
    expect(text()).toMatch(/1 iptal/);
    expect(text()).toMatch(/1 atlanacak/);
    expect(text()).toMatch(/takvim bağlantısına ait/i); // owned_by_feed gerekçesi okunur
    expect(router.refresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /İçe aktar/ }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((calls[1].init.body as FormData).get("mode")).toBeNull();
    expect(text()).toMatch(/1 eklendi/);
    expect(text()).toMatch(/1 iptal edildi/);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("önizleme hatası görünür, 'İçe aktar' düğmesi çıkmaz", async () => {
    stubFetch([{ ok: false, status: 400, body: { fields: { file: "Yalnızca .ics veya .csv dosyaları kabul edilir" } } }]);
    render(<CalendarFileImport propertyId="p1" />);
    await pickFile("notlar.txt");
    expect(document.body.textContent).toContain("Yalnızca .ics veya .csv dosyaları kabul edilir");
    expect(screen.queryByRole("button", { name: /İçe aktar/ })).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("yapılacak işlem yoksa (hepsi atlanacak) aktarım düğmesi devre dışıdır", async () => {
    stubFetch([
      {
        ok: true,
        body: { ...PREVIEW, counts: { create: 0, update: 0, cancel: 0, skipped: 1 }, rows: [PREVIEW.rows[2]], total: 1 },
      },
    ]);
    render(<CalendarFileImport propertyId="p1" />);
    await pickFile();
    const btn = screen.getByRole("button", { name: /İçe aktar/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
