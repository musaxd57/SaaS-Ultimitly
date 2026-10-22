// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Aboneliği devam ettir" klavye odağı (erişilebilirlik 10-22): açan düğme her adımda kalkıyor, odak sayfanın başına düşüyordu. Paket seçimi
// açılınca odak seçili pakete, tutar onayı açılınca "Vazgeç"e iner (Enter'a yanlışlıkla basmak ödeme almaz); vazgeçince açan düğmeye, sonuç
// gelince durum satırına (ödeme alındı / belirsiz) ya da "Devam et"e (kesin ret — yeniden denenebilir) döner. Onay kutusu başlığı ve küçük
// yazısı grubun adı + açıklamasıdır (ekran okuyucu odak inince tutarı okur).
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ResumeSubscription } from "@/components/settings/resume-subscription";

const plans = [
  { code: "baslangic", name: "Başlangıç", priceMinor: 44900, currency: "TRY" },
  { code: "pro", name: "Pro", priceMinor: 89900, currency: "TRY" },
];
const PREVIEW = {
  planCode: "pro",
  planName: "Pro",
  amount: "₺899,00",
  confirm: { headline: "Pro planınız hemen açılır.", fine: "₺899,00 kayıtlı kartınızdan şimdi tahsil edilecek." },
  previewToken: "t1",
};
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const focused = () => document.activeElement as HTMLElement | null;

function stubFetch(resume: () => Promise<Response>) {
  const fetchMock = vi.fn((url: string) => (url === "/api/billing/resume-preview" ? json(200, PREVIEW) : resume()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openPreview() {
  render(<ResumeSubscription plans={plans} currentPlanCode="pro" locale="tr-TR" />);
  fireEvent.click(screen.getByRole("button", { name: "Aboneliği devam ettir" }));
  fireEvent.click(screen.getByRole("button", { name: "Devam et" }));
  await screen.findByRole("group", { name: "Pro planınız hemen açılır." });
}

describe("devam ettir — odak", () => {
  it("paket seçimi açılınca odak seçili pakette; seçim grubu adlı; Vazgeç açan düğmeye döner", async () => {
    stubFetch(() => json(500, {}));
    render(<ResumeSubscription plans={plans} currentPlanCode="pro" locale="tr-TR" />);
    fireEvent.click(screen.getByRole("button", { name: "Aboneliği devam ettir" }));
    const group = screen.getByRole("radiogroup", { name: "Paketinizi seçin" });
    expect(focused()).toBe(group.querySelector("input:checked"));
    expect((focused() as HTMLInputElement).closest("label")?.textContent).toContain("Pro");

    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(focused()?.textContent).toBe("Aboneliği devam ettir"));
  });

  it("tutar onayı açılınca odak Vazgeç'te (ödeme düğmesinde DEĞİL); onay kutusu tutarı açıklama olarak taşır; Vazgeç → Devam et", async () => {
    stubFetch(() => json(500, {}));
    await openPreview();
    const group = screen.getByRole("group", { name: "Pro planınız hemen açılır." });
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toBe(PREVIEW.confirm.fine);
    expect(focused()?.textContent).toBe("Vazgeç");
    expect(group.contains(focused())).toBe(true);

    fireEvent.click(focused()!);
    await waitFor(() => expect(focused()?.textContent).toBe("Devam et"));
  });

  it("ödeme alındı → odak durum satırında", async () => {
    stubFetch(() => json(200, { ok: true }));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: /öde ve devam ettir/ }));
    await waitFor(() => expect(focused()?.getAttribute("role")).toBe("status"));
    expect(focused()?.textContent).toContain("devam ettirildi");
  });

  it("belirsiz sonuç (okunamayan cevap) → odak durum satırında", async () => {
    stubFetch(() => Promise.resolve(new Response("gateway", { status: 504 })));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: /öde ve devam ettir/ }));
    await waitFor(() => expect(focused()?.getAttribute("role")).toBe("status"));
    expect(focused()?.textContent).toContain("henüz kesinleşmedi");
  });

  it("kart reddi (402) → odak Devam et'e döner (yeniden denenebilir), hata uyarı olarak okunur", async () => {
    stubFetch(() => json(402, { error: "Ödeme alınamadı. Kart bilgilerinizi güncelleyin.", cardUpdateUrl: null }));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: /öde ve devam ettir/ }));
    await waitFor(() => expect(focused()?.textContent).toBe("Devam et"));
    expect(screen.getByRole("alert").textContent).toContain("Ödeme alınamadı");
  });
});
