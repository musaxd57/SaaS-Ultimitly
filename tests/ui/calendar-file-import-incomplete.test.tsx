// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { CalendarFileImport } from "@/components/properties/calendar-file-import";

// F16 (09-26): sunucunun eksik okuma notu önizlemede ve aktarım sonucunda görünür; not yoksa hiçbir uyarı yok.

const NOTE = "Dosyanın bir kısmı okunamadı (takvim dosyası yarım geldi); bazı rezervasyonlar aktarılmayabilir.";
const PREVIEW = {
  preview: true,
  property: { id: "p1", name: "Test Dairesi" },
  counts: { create: 1, update: 0, cancel: 0, skipped: 0 },
  rows: [{ line: 1, uid: "a@x", guestName: "A", arrival: "2026-10-14", departure: "2026-10-17", action: "create", reason: null }],
  total: 1,
};

function stubFetch(bodies: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => bodies.shift() })),
  );
}
function pickFile() {
  const input = screen.getByLabelText(".ics dosyası seç") as HTMLInputElement;
  const file = new File(["BEGIN:VCALENDAR\r\n"], "takvim.ics", { type: "text/calendar" });
  return act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe("CalendarFileImport — eksik okuma notu", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("not önizlemede ve sonuçta görünür", async () => {
    stubFetch([{ ...PREVIEW, note: NOTE }, { imported: 1, updated: 0, cancelled: 0, skipped: 0, errors: [], note: NOTE }]);
    render(<CalendarFileImport propertyId="p1" />);
    await pickFile();
    expect(screen.getByRole("status").textContent).toBe(NOTE);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /İçe aktar/ }));
    });
    expect(document.body.textContent).toMatch(/1 eklendi/);
    expect(document.body.textContent).toContain(NOTE);
  });

  it("not yoksa uyarı da yok", async () => {
    stubFetch([{ ...PREVIEW, note: null }]);
    render(<CalendarFileImport propertyId="p1" />);
    await pickFile();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain("okunamadı");
  });
});
