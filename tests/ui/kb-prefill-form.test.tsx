// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// B1 (kurucu 10-11, "ev sahibi döngüsü"): gelen kutusundaki "Eksik bilgi"den gelen ön doldurma formda — mülk / kategori / başlık dolu,
// içerik BOŞ (ev sahibi yazar, kendisi kaydeder; otomatik kalem yok), imleç içerikte, kısa açıklama görünür.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbManager } from "@/components/knowledge/kb-manager";

const PROPS = [
  { id: "p1", name: "Lale 1" },
  { id: "p2", name: "Lale 2" },
];

describe("KbManager — ön dolu form", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fromTemplates: [] }) })));
  });

  it("mülk / kategori / başlık dolu, içerik boş ve odakta; açıklama görünür; hiçbir şey kaydedilmez", () => {
    render(<KbManager properties={PROPS} items={[]} prefill={{ propertyId: "p2", category: "local_tips", title: "Yakındaki kahvaltı yerleri" }} />);
    expect((screen.getByLabelText("Mülk") as HTMLSelectElement).value).toBe("p2");
    expect((screen.getByLabelText("Kategori") as HTMLSelectElement).value).toBe("local_tips");
    expect((document.getElementById("kb-title") as HTMLInputElement).value).toBe("Yakındaki kahvaltı yerleri");
    const content = document.getElementById("kb-content") as HTMLTextAreaElement;
    expect(content.value).toBe("");
    expect(document.activeElement).toBe(content);
    expect(screen.getByText(/Misafirin sorduğu ama bilgi tabanında olmayan konu/)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("KONTROL: ön doldurma yoksa ilk mülk + Genel, açıklama yok, odak içerikte değil", () => {
    render(<KbManager properties={PROPS} items={[]} />);
    expect((screen.getByLabelText("Mülk") as HTMLSelectElement).value).toBe("p1");
    expect((screen.getByLabelText("Kategori") as HTMLSelectElement).value).toBe("general");
    expect(screen.queryByText(/Misafirin sorduğu ama bilgi tabanında olmayan konu/)).toBeNull();
    expect(document.activeElement).not.toBe(document.getElementById("kb-content"));
  });
});
