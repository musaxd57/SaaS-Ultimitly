// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// GECE-4 S6-12: "Tüm dairelere uygula" YALNIZ değişen saati gönderir. İlk değerler en eski dairenin saatleri; yalnız giriş saati
// değişince çıkış saati de gidiyor ve farklı çıkış saatli dairelerin saati sessizce eziliyordu (misafire bu saatler söyleniyor).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { BulkTimesForm } from "@/components/settings/bulk-times-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ updated: 3 }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<BulkTimesForm defaultCheckIn="15:00" defaultCheckOut="11:00" />);
  const [checkIn, checkOut] = Array.from(view.container.querySelectorAll('input[type="time"]')) as HTMLInputElement[];
  const submit = () => fireEvent.submit(view.container.querySelector("form")!);
  const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  return { checkIn, checkOut, submit, sentBody, fetchMock };
}

describe("BulkTimesForm — yalnız değişen alan", () => {
  it("🚨 yalnız giriş saati değişti → gövdede çıkış saati YOK", async () => {
    const { checkIn, submit, sentBody, fetchMock } = setup();
    fireEvent.change(checkIn!, { target: { value: "16:00" } });
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ checkInTime: "16:00" });
    await screen.findByText("3 daireye uygulandı.");
  });
  it("yalnız çıkış değişti → yalnız çıkış; ikisi değişti → ikisi", async () => {
    const a = setup();
    fireEvent.change(a.checkOut!, { target: { value: "12:00" } });
    a.submit();
    await waitFor(() => expect(a.fetchMock).toHaveBeenCalledTimes(1));
    expect(a.sentBody()).toEqual({ checkOutTime: "12:00" });
    cleanup();
    vi.unstubAllGlobals();
    const b = setup();
    fireEvent.change(b.checkIn!, { target: { value: "14:00" } });
    fireEvent.change(b.checkOut!, { target: { value: "10:00" } });
    b.submit();
    await waitFor(() => expect(b.fetchMock).toHaveBeenCalledTimes(1));
    expect(b.sentBody()).toEqual({ checkInTime: "14:00", checkOutTime: "10:00" });
  });
});
