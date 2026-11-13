// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";
import { SEND_CHECKIN_LABEL, SEND_CHECKIN_WARNING } from "@/components/arrivals/send-checkin";
import { CHECKIN_NOW_TEXT } from "@/lib/checkin-now-text";
import type { Factor } from "@/lib/readiness-list/evaluate";

// UX-10 D5 (kurucu 11-13): onay pencereli "Giriş mesajını gönderin". Metin pencere açılınca istenir (liste HTML'inde yok), misafirin göreceği
// TAM hâli + "geri alınamaz" uyarısı gösterilir, "Gönderin" önizlenen sürümü yollar; belirsiz teslimde uyarı tonu ve yeniden gönder YOK.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const factor: Factor = {
  key: "access",
  state: "info",
  label: "Otomatik giriş mesajı kapalı · giriş bilgisini siz gönderin",
  missing: "erişim kontrolü",
  basis: [],
  link: { to: "conversation" },
  sendCheckin: true,
};
const row: ArrivalsListRow = {
  reservationId: "r-1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: "Bugün · 7 Kasım Cumartesi",
  checkInTime: "15:00",
  conversationId: "c1",
  overall: "unknown",
  factors: [factor],
};
const preview = { ok: true, body: "Merhaba Ayşe, kapı kodumuz 4821.", revision: 3, propertyName: "Lale 5", guestName: "Ayşe" };

function stubFetch(post: { status: number; body: unknown }) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? new Response(JSON.stringify(post.body), { status: post.status }) : new Response(JSON.stringify(preview), { status: 200 }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Girişler — giriş mesajını elle gönderme", () => {
  it("metin listede YOK; düğmeye basınca istenir ve tam hâli + uyarı gösterilir; 'Gönderin' önizlenen sürümü yollar", async () => {
    const fetchFn = stubFetch({ status: 200, body: { ok: true, kind: "sent", message: CHECKIN_NOW_TEXT.sent } });
    const { container } = render(<ArrivalsList rows={[row]} truncated={0} canAct />);
    expect(container.textContent).not.toContain("4821");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SEND_CHECKIN_LABEL }));
    });
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/reservations/r-1/checkin-message");
    const dialog = screen.getByRole("dialog", { name: SEND_CHECKIN_LABEL });
    expect(dialog.textContent).toContain("Merhaba Ayşe, kapı kodumuz 4821.");
    expect(dialog.textContent).toContain(SEND_CHECKIN_WARNING);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gönderin" }));
    });
    const post = fetchFn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ revision: 3 });
    expect(screen.getByRole("status").textContent).toBe(CHECKIN_NOW_TEXT.sent);
    expect(refresh).toHaveBeenCalled();
  });

  it("'Vazgeçin' hiçbir şey göndermez", async () => {
    const fetchFn = stubFetch({ status: 200, body: { ok: true } });
    render(<ArrivalsList rows={[row]} truncated={0} canAct />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SEND_CHECKIN_LABEL }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Vazgeçin" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("belirsiz teslim → 'ulaşmış olabilir' uyarısı, yeniden gönder düğmesi YOK", async () => {
    stubFetch({ status: 200, body: { ok: false, code: "ambiguous", error: CHECKIN_NOW_TEXT.ambiguous } });
    render(<ArrivalsList rows={[row]} truncated={0} canAct />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SEND_CHECKIN_LABEL }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gönderin" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(CHECKIN_NOW_TEXT.ambiguous);
    expect(screen.queryByRole("button", { name: "Gönderin" })).toBeNull();
  });

  it("yazma yetkisi olmayan görünümde (canAct yok) düğme çizilmez", () => {
    render(<ArrivalsList rows={[row]} truncated={0} />);
    expect(screen.queryByRole("button", { name: SEND_CHECKIN_LABEL })).toBeNull();
  });
});
