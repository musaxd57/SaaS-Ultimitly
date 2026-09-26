// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CalendarSources } from "@/components/properties/calendar-sources";

// Kaynak adı artık chip'lerle seçiliyor (kullanıcı kararı 07-29): Airbnb ve
// Booking.com tek dokunuş, "Diğer" serbest metni açar (Vrbo/Google Takvim gibi
// kaynaklar var — salt 2 seçenekle kilitlenmez). API sözleşmesi değişmedi:
// label yine düz string gider. Client URL doğrulaması sunucuyla AYNI kurala
// çekildi: yalnız https (eski "http(s)" ipucu sunucunun 400'üyle çelişiyordu).

function stubFetch(ok = true) {
  const fn = vi.fn(() =>
    Promise.resolve({ ok, json: async () => (ok ? { id: "cs1" } : { fields: { url: "hata" } }) }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderEmpty() {
  return render(<CalendarSources propertyId="p1" sources={[]} />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CalendarSources — kaynak chip'leri", () => {
  it("Airbnb ve Booking.com hazır seçenek, Diğer serbest metin olarak sunulur; ad inputu başta gizli", () => {
    renderEmpty();
    expect(screen.getByRole("button", { name: "Airbnb" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Booking.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Diğer" })).toBeTruthy();
    expect(screen.queryByLabelText("Takvim kaynağı adı")).toBeNull();
  });

  it("Airbnb chip'i seçiliyken ekleme, label=Airbnb ile POST eder", async () => {
    const fetchFn = stubFetch();
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Airbnb" }));
    expect(screen.getByRole("button", { name: "Airbnb" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Takvim (.ics) bağlantısı"), {
      target: { value: "https://www.airbnb.com/calendar/ical/539.ics?s=abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Takvim bağlantısı ekle/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const body = JSON.parse(((fetchFn.mock.calls[0] as unknown[])[1] as RequestInit).body as string);
    expect(body).toEqual({ label: "Airbnb", url: "https://www.airbnb.com/calendar/ical/539.ics?s=abc" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Diğer seçilince ad inputu açılır ve özel ad gönderilir", async () => {
    const fetchFn = stubFetch();
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Diğer" }));
    const nameInput = screen.getByLabelText("Takvim kaynağı adı");
    fireEvent.change(nameInput, { target: { value: "Vrbo" } });
    fireEvent.change(screen.getByLabelText("Takvim (.ics) bağlantısı"), {
      target: { value: "https://vrbo.example.com/feed.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Takvim bağlantısı ekle/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const body = JSON.parse(((fetchFn.mock.calls[0] as unknown[])[1] as RequestInit).body as string);
    expect(body.label).toBe("Vrbo");
  });

  it("kaynak seçilmeden ekleme denenirse fetch olmaz, yönlendirici hata görünür", () => {
    const fetchFn = stubFetch();
    renderEmpty();
    fireEvent.change(screen.getByLabelText("Takvim (.ics) bağlantısı"), {
      target: { value: "https://www.airbnb.com/calendar/ical/539.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Takvim bağlantısı ekle/ }));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByText(/Önce kaynağı seçin/)).toBeTruthy();
  });

  it("http:// bağlantı client'ta da reddedilir (sunucu kuralıyla parite — https şart)", () => {
    const fetchFn = stubFetch();
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Booking.com" }));
    fireEvent.change(screen.getByLabelText("Takvim (.ics) bağlantısı"), {
      target: { value: "http://admin.booking.com/feed.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Takvim bağlantısı ekle/ }));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByText(/Yalnızca https/)).toBeTruthy();
  });

  it("kanal bağlantısı çakışma uyarısı görünür (aynı ilan iki kaynaktan çift düşer); arayüzde PMS adı YOK", () => {
    renderEmpty();
    expect(screen.getByText(/kanal bağlantınızdan zaten geliyorsa aynı ilanın iCal/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Hospitable/);
  });
});
