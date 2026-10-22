// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Klavye erişilebilirliği (10-22, Haiku klavye incelemesi): satır içi onaylarda açan düğme kalkınca odak sayfanın başına düşüyordu;
// açılır bölüm düğmeleri ekran okuyucuya açık / kapalı durumunu söylemiyordu, görev süre süzgeci hangisinin seçili olduğunu yalnız
// renkle gösteriyordu. Onay açılınca odak "Vazgeç"e iner, vazgeçince açan düğmeye döner.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReservationPinControl } from "@/components/properties/reservation-pin-control";
import { DecisionPanel, type DecisionCardData } from "@/components/inbox/decision-panel";
import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const focused = () => document.activeElement as HTMLElement | null;

describe("giriş kodunu kaldır onayı", () => {
  it("onay açılınca odak Vazgeç'te; vazgeçince 'Giriş kodunu kaldır'a döner", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReservationPinControl reservationId="r1" initialHasPin />);
    fireEvent.click(screen.getByRole("button", { name: "Giriş kodunu kaldır" }));
    expect(focused()?.textContent).toBe("Vazgeç");
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(focused()?.textContent).toBe("Giriş kodunu kaldır"));
  });
});

const card: DecisionCardData = {
  id: "d1",
  kind: "early_checkin",
  title: "13:00 erken giriş",
  statusLabel: "Karar bekliyor",
  open: true,
  unverified: false,
  sending: false,
  version: 0,
  requestedTime: "13:00",
  dayKey: "2026-10-14",
  dayLabel: "14 Ekim (varış günü)",
  askedAt: "13 Eki 10:00",
  requestQuote: "13:00'te girebilir miyiz?",
  standardTime: "15:00",
  lang: "tr",
  fee: null,
  note: null,
  lines: [{ ok: false, text: "Çıkış temizliği henüz bitmedi." }],
  laterGuestMessageId: null,
  factsHash: "h1",
};

describe("karar kartı satır içi onayları", () => {
  it("Kartı kapat: odak Vazgeç'e iner, vazgeçince Kartı kapat'a döner", async () => {
    render(<DecisionPanel conversationId="c1" decisions={[card]} />);
    fireEvent.click(screen.getByRole("button", { name: "Kartı kapat" }));
    expect(focused()?.textContent).toBe("Vazgeç");
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(focused()?.textContent).toBe("Kartı kapat"));
  });

  it("Hazır metne dön: Vazgeç → açan düğme; Evet → mesaj alanı", async () => {
    render(<DecisionPanel conversationId="c1" decisions={[card]} />);
    fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
    const textarea = screen.getByLabelText("Misafire gidecek mesaj") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Kendi yazdığım metin." } });

    fireEvent.click(screen.getByRole("button", { name: "Hazır metne dön" }));
    // Düzenleyicide başka bir "Vazgeç" de var (cevap kipinden çıkış) — odaklanan, onayın kendi Vazgeç'i olmalı.
    const cancel = focused()!;
    expect(cancel.textContent).toBe("Vazgeç");
    expect(cancel.closest("span")?.textContent).toContain("Düzenlemeleriniz silinsin mi?");
    fireEvent.click(cancel);
    await waitFor(() => expect(focused()?.textContent).toBe("Hazır metne dön"));

    fireEvent.click(screen.getByRole("button", { name: "Hazır metne dön" }));
    fireEvent.click(screen.getByRole("button", { name: "Evet" }));
    await waitFor(() => expect(focused()).toBe(screen.getByLabelText("Misafire gidecek mesaj")));
    expect((screen.getByLabelText("Misafire gidecek mesaj") as HTMLTextAreaElement).value).not.toBe("Kendi yazdığım metin.");
  });

  it("Onayla / Reddet düğmeleri yalnız açtıkları düzenleyici ekrandayken ona işaret eder", () => {
    render(<DecisionPanel conversationId="c1" decisions={[card]} />);
    const decline = screen.getByRole("button", { name: /Reddet/ });
    expect(decline.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(decline);
    const id = decline.getAttribute("aria-controls");
    expect(id && document.getElementById(id)).toBeTruthy();
    const approve = screen.getAllByRole("button").find((b) => b.getAttribute("aria-expanded") === "false" && /Onayla/.test(b.textContent ?? ""));
    expect(approve?.hasAttribute("aria-controls")).toBe(false);
  });

  it("kontrol listesi düğmesi yalnız liste ekrandayken ona işaret eder", () => {
    render(<DecisionPanel conversationId="c1" decisions={[card]} />);
    const toggle = screen.getByRole("button", { name: /Kontrol listesini/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(toggle);
    const id = toggle.getAttribute("aria-controls");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(id && document.getElementById(id)).toBeTruthy();
  });
});

const task = (over: Partial<TaskCardData>): TaskCardData => ({
  id: "t1",
  title: "Çıkış temizliği",
  shareTitle: "Çıkış temizliği",
  type: "cleaning",
  priority: "standard",
  status: "todo",
  propertyName: "Lale",
  assigneeName: null,
  dueLabel: "14 Eki 2026",
  dueDays: 0,
  checklist: null,
  ...over,
});

describe("görev panosu durum bildirimleri", () => {
  it("süre süzgeci seçili olanı aria-pressed ile söyler (yalnız renkle değil)", () => {
    render(<TaskBoard tasks={[task({})]} />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    const other = screen.getAllByRole("button", { pressed: false })[0];
    fireEvent.click(other);
    expect(other.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("paylaş ve ayrıntı düğmeleri açık / kapalı durumunu taşır", () => {
    render(<TaskBoard tasks={[task({})]} />);
    const share = screen.getByRole("button", { name: /Temizlik listesini paylaş/ });
    expect(share.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(share);
    expect(share.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(share.getAttribute("aria-controls")!)).toBeTruthy();

    const detail = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-expanded") && b !== share)!;
    expect(detail.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(detail);
    expect(detail.getAttribute("aria-expanded")).toBe("true");
  });
});
