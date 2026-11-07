// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// KURUCU T4 (10-21) — "Otomatik mesajlar" kartı: "Kaydetmeden önce misafire gidecek metnin önizlemesi gösterilsin" → değişmiş taslak
// önizlenmeden KAYDEDİLEMEZ; önizleme sonrası taslak yeniden değişirse düğme yine kapanır. "Boş veya çözülemeyen değişken taşıyan mesaj
// gönderilmesin; host uyarı görsün" → uyarı satırı görünür. Kayıt sürümle gider (`expectedRevision`).
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutoMessagesCard, type AutoMessageCardItem } from "@/components/properties/auto-messages-card";

const item = (over: Partial<AutoMessageCardItem> = {}): AutoMessageCardItem => ({
  kind: "checkin",
  body: "Kod 4821",
  revision: 3,
  needsReview: false,
  lastSkipReason: null,
  kbChangedAfter: false,
  preview: { text: "Merhaba Ayşe,\n\nKod 4821", issue: null, unfilledTokens: [] },
  ...over,
});

describe("Otomatik mesajlar kartı", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (init?.method === "POST") {
        const issue = String(body.body).includes("[") ? "unfilled" : null;
        return { ok: true, status: 200, json: async () => ({ preview: { text: `Merhaba Ayşe,\n\n${body.body}`, issue, unfilledTokens: issue ? ["[AÇIK ADRES]"] : [] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ kind: body.kind, body: body.body, revision: body.expectedRevision + 1, preview: { text: body.body, issue: null, unfilledTokens: [] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("kayıtlı metin önizlemesiyle görünür; değişiklik yokken kaydet düğmesi yok", () => {
    render(<AutoMessagesCard propertyId="p1" canEdit items={[item()]} />);
    expect(screen.getByTestId("auto-message-checkin").textContent).toContain("Misafire böyle gider");
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
  });

  it("🚨 değişen taslak ÖNİZLENMEDEN kaydedilemez; önizlemeden sonra açılır; taslak yeniden değişince yine kapanır", async () => {
    render(<AutoMessagesCard propertyId="p1" canEdit items={[item()]} />);
    const area = screen.getByLabelText("Giriş mesajı");
    fireEvent.change(area, { target: { value: "Kod 7310" } });
    const save = screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("auto-message-checkin").textContent).toContain("Kod 7310");
    fireEvent.change(area, { target: { value: "Kod 7311" } });
    expect((screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("kayıt beklenen sürümle gider", async () => {
    render(<AutoMessagesCard propertyId="p1" canEdit items={[item()]} />);
    fireEvent.change(screen.getByLabelText("Giriş mesajı"), { target: { value: "Kod 7310" } });
    fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ kind: "checkin", body: "Kod 7310", expectedRevision: 3 });
  });

  it("🚨 doldurulmamış alan → 'gönderilmez' uyarısı ve alan adı", async () => {
    render(<AutoMessagesCard propertyId="p1" canEdit items={[item()]} />);
    fireEvent.change(screen.getByLabelText("Giriş mesajı"), { target: { value: "Adres: [AÇIK ADRES]" } });
    fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
    const issue = await screen.findByTestId("auto-message-issue");
    expect(issue.textContent).toContain("gönderilmez");
    expect(issue.textContent).toContain("[AÇIK ADRES]");
  });

  it("boş kayıtlı metin → 'Bu mesaj boş — gönderilmez.'; geçiş kontrolü ve bilgi tabanı notları görünür", () => {
    render(
      <AutoMessagesCard
        propertyId="p1"
        canEdit
        items={[item({ body: "", preview: { text: "", issue: "empty", unfilledTokens: [] }, needsReview: true, kbChangedAfter: true })]}
      />,
    );
    const box = screen.getByTestId("auto-message-checkin");
    expect(box.textContent).toContain("Bu mesaj boş — gönderilmez.");
    expect(box.textContent).toContain("Metni kontrol edip kaydedin");
    expect(box.textContent).toContain("Otomatik mesaj kendiliğinden değişmez");
  });

  it("destek görünümü (düzenleme yok): alan kapalı, düğme yok", () => {
    render(<AutoMessagesCard propertyId="p1" canEdit={false} items={[item()]} />);
    expect((screen.getByLabelText("Giriş mesajı") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Önizle" })).toBeNull();
  });
});
