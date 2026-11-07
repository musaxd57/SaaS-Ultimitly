// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// EV KURALLARI FORMU (#188 dilim 2): altı konu, kayıtlı seçimle açılır, kayıtta altı konunun tamamı gövdeye girer;
// yapay zekânın kuralları HENÜZ kullanmadığı açıkça yazar (dürüstlük); personel değiştiremez.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/properties/p1" }));

import { HouseRulesForm, HOUSE_RULE_TOPIC_LABELS } from "@/components/properties/house-rules-form";
import { HOUSE_RULE_TOPICS } from "@/lib/house-rules/core";

const INITIAL = {
  party_event: "ask_host",
  smoking: "forbidden",
  pets: "allowed",
  extra_guests: "ask_host",
  quiet_hours: "ask_host",
  visitors: "ask_host",
} as const;

describe("HouseRulesForm", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  it("kayıtlı seçimle açılır; değiştirip kaydedince altı konunun TAMAMI gövdede", async () => {
    render(<HouseRulesForm propertyId="p1" canManage initial={{ ...INITIAL }} />);
    expect((screen.getByLabelText(HOUSE_RULE_TOPIC_LABELS.smoking) as HTMLSelectElement).value).toBe("forbidden");
    expect((screen.getByLabelText(HOUSE_RULE_TOPIC_LABELS.pets) as HTMLSelectElement).value).toBe("allowed");
    fireEvent.change(screen.getByLabelText(HOUSE_RULE_TOPIC_LABELS.visitors), { target: { value: "forbidden" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/properties/p1/house-rules");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      rules: HOUSE_RULE_TOPICS.map((topic) => ({ topic, policy: topic === "visitors" ? "forbidden" : INITIAL[topic] })),
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("yapay zekânın kuralları HENÜZ kullanmadığını söyler", () => {
    render(<HouseRulesForm propertyId="p1" canManage initial={{ ...INITIAL }} />);
    expect(screen.getByTestId("house-rules-inactive").textContent).toMatch(/henüz/);
  });

  it("yönetici olmayan: seçimler kilitli, Kaydet yok", () => {
    render(<HouseRulesForm propertyId="p1" canManage={false} initial={{ ...INITIAL }} />);
    expect((screen.getByLabelText(HOUSE_RULE_TOPIC_LABELS.smoking) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Kaydet/ })).toBeNull();
  });

  it("sunucu hata metnini gösterir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ fields: { _: "Kuralları kontrol edin: x" } }), { status: 400 })),
    );
    render(<HouseRulesForm propertyId="p1" canManage initial={{ ...INITIAL }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    });
    expect(screen.getByText("Kuralları kontrol edin: x")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
