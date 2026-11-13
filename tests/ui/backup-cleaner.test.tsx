// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// YEDEK TEMİZLİKÇİ ekranları (kurucu 11-13 "sistem yedeği önersin"; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md T2):
// (1) Girişler'de kişi değişecekken yedek ön seçili gelir, "(yedek)" diye yazar, atama YİNE "Atayın" ile; (2) daire sayfasında "Yedek
// temizlikçi" ayrı kaydedilir, listede dairenin temizlikçisi yoktur.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";
import { BackupCleanerForm } from "@/components/properties/default-cleaner-form";
import { subscribeToasts, __resetToastsForTest } from "@/lib/toast";
import type { Factor } from "@/lib/readiness-list/evaluate";

const members = [
  { id: "u-ali", name: "Ali" },
  { id: "u-ayse", name: "Ayşe" },
  { id: "u-fatma", name: "Fatma" },
];
const factor = (assign: Factor["assign"]): Factor => ({
  key: "cleaning",
  state: "blocking",
  label: "Temizlik açık · atanan: Ayşe · başlanmadı",
  missing: '"bitti" kaydı',
  basis: [],
  link: { to: "task", taskId: "t1" },
  assign,
});
const row = (f: Factor): ArrivalsListRow => ({
  reservationId: "r1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: "Bugün · 7 Kasım Cumartesi",
  checkInTime: "15:00",
  conversationId: null,
  overall: "not_ready",
  factors: [f],
});
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
const bodyOf = (i: number) => JSON.parse(String((calls()[i]![1] as RequestInit).body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("Girişler — yedek temizlikçi önerisi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "t1" }), { status: 200 })));
  });

  it("🚨 'Değiştirin' + yedek → yedek ön seçili, '(yedek)' yazar, 'Atayın' hazır; dokunmadan istek GİTMEZ, dokununca yedeğe atar", async () => {
    render(<ArrivalsList rows={[row(factor({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "change", suggestUserId: "u-fatma" }))]} truncated={0} members={members} />);
    const select = screen.getByLabelText(/^Değiştirin/) as HTMLSelectElement;
    expect(select.value).toBe("u-fatma");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Değiştirin", "Ali", "Fatma (yedek)", "Atanmadı"]);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atayın" }));
    });
    expect(bodyOf(0)).toEqual({ assignedToId: "u-fatma", expectAssignedToId: "u-ayse" });
  });

  it("ev sahibi başka kişi seçerse o gider (öneri yalnız ön seçim)", async () => {
    render(<ArrivalsList rows={[row(factor({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "reassign", suggestUserId: "u-fatma" }))]} truncated={0} members={members} />);
    fireEvent.change(screen.getByLabelText(/^Başkasına atayın/), { target: { value: "u-ali" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atayın" }));
    });
    expect(bodyOf(0)).toEqual({ assignedToId: "u-ali", expectAssignedToId: "u-ayse" });
  });

  it("bayat satırdan sonra (liste yenilenir) öneri yine ön seçili gelir", async () => {
    const off = subscribeToasts(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "assignee_changed", error: "x" }), { status: 409 })));
    render(<ArrivalsList rows={[row(factor({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "change", suggestUserId: "u-fatma" }))]} truncated={0} members={members} />);
    fireEvent.change(screen.getByLabelText(/^Değiştirin/), { target: { value: "u-ali" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atayın" }));
    });
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText(/^Değiştirin/) as HTMLSelectElement).value).toBe("u-fatma");
    off();
  });

  it("KONTROL — yedek ekipte değilse (listede yok) ön seçim YOK, 'Atayın' görünmez", () => {
    render(<ArrivalsList rows={[row(factor({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "change", suggestUserId: "u-gitti" }))]} truncated={0} members={members} />);
    expect((screen.getByLabelText(/^Değiştirin/) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Atayın" })).toBeNull();
    expect(screen.queryByText(/\(yedek\)/)).toBeNull();
  });

  it("KONTROL — öneri yoksa eski görünüm aynen", () => {
    render(<ArrivalsList rows={[row(factor({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "change" }))]} truncated={0} members={members} />);
    const select = screen.getByLabelText(/^Değiştirin/) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Değiştirin", "Ali", "Fatma", "Atanmadı"]);
    expect(screen.queryByRole("button", { name: "Atayın" })).toBeNull();
  });
});

describe("Daire sayfası — yedek temizlikçi", () => {
  let bodies: unknown[];
  let reply: { status: number; body: unknown };
  let toasts: string[];
  beforeEach(() => {
    bodies = [];
    reply = { status: 200, body: { ok: true } };
    toasts = [];
    __resetToastsForTest();
    subscribeToasts((m) => toasts.push(`${m.variant}: ${m.text}`));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }),
    );
  });
  const pick = (v: string) => fireEvent.change(screen.getByLabelText("Yedek temizlikçi"), { target: { value: v } });
  const click = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
  };

  it("liste dairenin temizlikçisini içermez; seçim yalnız 'Kaydet' ile ve YALNIZ yedek alanıyla gider", async () => {
    render(<BackupCleanerForm propertyId="p1" primaryUserId="u-ayse" currentBackupId={null} members={members} />);
    const select = screen.getByLabelText("Yedek temizlikçi") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Yok", "Ali", "Fatma"]);
    pick("u-fatma");
    expect(bodies).toEqual([]);
    await click("Kaydet");
    expect(bodies).toEqual([{ backupUserId: "u-fatma" }]);
    expect(toasts.at(-1)).toBe("success: Kaydedildi. Temizlikçi değişecekse önce bu kişi önerilecek.");
    expect(refresh).toHaveBeenCalled();
  });

  it("'Yok' → null gönderir; sunucunun alan cümlesi gösterilir", async () => {
    reply = { status: 400, body: { error: "x", fields: { backupUserId: "Yedek, dairenin temizlikçisinden farklı biri olmalı." } } };
    render(<BackupCleanerForm propertyId="p1" primaryUserId="u-ayse" currentBackupId="u-fatma" members={members} />);
    pick("");
    await click("Kaydet");
    expect(bodies).toEqual([{ backupUserId: null }]);
    expect(toasts.at(-1)).toBe("error: Yedek, dairenin temizlikçisinden farklı biri olmalı.");
  });

  it("'Vazgeç' kayıtlı değere döner; sayfa yenilenip sunucu başka değer getirirse form ona döner", () => {
    const { rerender } = render(<BackupCleanerForm propertyId="p1" primaryUserId="u-ayse" currentBackupId="u-fatma" members={members} />);
    pick("u-ali");
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect((screen.getByLabelText("Yedek temizlikçi") as HTMLSelectElement).value).toBe("u-fatma");
    rerender(<BackupCleanerForm propertyId="p1" primaryUserId="u-fatma" currentBackupId={null} members={members} />);
    expect((screen.getByLabelText("Yedek temizlikçi") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
  });
});
