// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LicensesCard } from "@/components/settings/licenses-card";

// ---------------------------------------------------------------------------
// Ayarlar › İşletme belgeleri — "Geri çek" (kurucu 11-06 S-B: soru sakin, tehdit gibi okunmaz; geri dönüşün yolu söylenir).
// Eşleşmiş / askıdaki BELGE ile incelemedeki BAŞVURU ayrı söylenir — soru da sonuç bildirimi de aynı ayrımla (Opus 11-06: başvuru geri
// çekilince bildirim "Belgeyi geri çektiniz" diyordu, soru "Başvuruyu…" derken). Vazgeçilirse hiçbir istek gitmez.
// ---------------------------------------------------------------------------

const DOC_QUESTION = "Bu belgeyi geri çekmek istiyor musunuz? İstediğiniz zaman yeniden ekleyebilirsiniz; ekibimiz belgeyi yeniden kontrol eder.";
const APP_QUESTION = "Başvuruyu geri çekmek istiyor musunuz? İstediğiniz zaman yeniden başvurabilirsiniz.";

function row(id: string, status: string, statusLabel: string) {
  return {
    id,
    type: "agency",
    typeLabel: "Seyahat acentası belgesi",
    number: id === "lic-doc" ? "12345" : "67890",
    status,
    statusLabel,
    statusText: null,
    group: "A",
    holder: { kind: "company", legalName: "Örnek Tur Ltd. Şti.", taxIdMasked: "•••••••89" },
    units: [],
    mark: null,
  };
}

const LIST = {
  planAllowed: true,
  twoFactor: true,
  licenses: [row("lic-doc", "verified", "Eşleşti"), row("lic-app", "pending", "İnceleniyor")],
};

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      // Sunucunun genel cümlesi — bildirim satırın durumuna göre seçilir, bu cümleye bakılmaz.
      return new Response(JSON.stringify({ ok: true, message: "Belgeyi geri çektiniz." }), { status: 200 });
    }
    return new Response(JSON.stringify(LIST), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function withdrawButtons() {
  return screen.getAllByRole("button", { name: "Geri çek" });
}

describe("İşletme belgeleri — geri çekme sorusu ve bildirimi", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("eşleşmiş belge: belge sorusu, onaylanınca 'Belgeyi geri çektiniz.'", async () => {
    const fetchMock = mockFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LicensesCard properties={[]} />);
    await waitFor(() => expect(withdrawButtons()).toHaveLength(2));
    fireEvent.click(withdrawButtons()[0]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Belgeyi geri çektiniz."));
    expect(confirm).toHaveBeenCalledWith(DOC_QUESTION);
    expect(fetchMock).toHaveBeenCalledWith("/api/licenses/lic-doc/withdraw", expect.objectContaining({ method: "POST" }));
  });

  it("incelemedeki başvuru: başvuru sorusu, onaylanınca 'Başvuruyu geri çektiniz.'", async () => {
    mockFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LicensesCard properties={[]} />);
    await waitFor(() => expect(withdrawButtons()).toHaveLength(2));
    fireEvent.click(withdrawButtons()[1]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Başvuruyu geri çektiniz."));
    expect(confirm).toHaveBeenCalledWith(APP_QUESTION);
  });

  it("soru 'işaret kalkar' gibi tehdit cümlesi taşımaz; vazgeçilirse istek GİTMEZ", async () => {
    const fetchMock = mockFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LicensesCard properties={[]} />);
    await waitFor(() => expect(withdrawButtons()).toHaveLength(2));
    fireEvent.click(withdrawButtons()[0]);
    fireEvent.click(withdrawButtons()[1]);
    expect(confirm).toHaveBeenCalledTimes(2);
    for (const [q] of confirm.mock.calls) expect(String(q)).not.toMatch(/işaret|kalkar|kaybed/i);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
