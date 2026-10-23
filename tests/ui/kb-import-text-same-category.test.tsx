// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// KB istek kimliği kalemin KENDİSİNE bağlı (Haiku 10-14): çıkarıcı bugün kategori başına tek kalem üretiyor, ama yarın aynı kategoriden
// iki kalem dönerse ikisi AYNI kimliği almamalı — yoksa sunucu ilkini döndürür, ikincisi sessizce kaybolurdu. Çıkarıcı burada sahte
// (aynı kategoride iki kalem); ayrı dosya, çünkü modül sahtesi öteki ekran testlerini etkiler.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("@/lib/kb-extract", async (orig) => {
  const actual = await orig<typeof import("@/lib/kb-extract")>();
  return {
    ...actual,
    extractKbSuggestions: () => ({
      fields: [],
      items: [
        { category: "parking", title: "Otopark", content: "Otopark bina altındadır.", lines: [1] },
        { category: "parking", title: "Otopark 2", content: "Misafir yeri 3 numaradır.", lines: [2] },
      ],
      skipped: [],
      linesRead: 2,
      truncated: false,
    }),
  };
});

import { KbImportText } from "@/components/knowledge/kb-import-text";

describe("KB içe aktarım — aynı kategoriden iki kalem", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("🚨 iki kalem iki AYRI istek kimliğiyle gider", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<KbImportText properties={[{ id: "p1", name: "Daire 1" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    fireEvent.change(screen.getByLabelText("Metin"), { target: { value: "x\ny" } });
    fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Seçilenleri ekle/ }));
    });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { content: string; requestId: string });
    expect(bodies.map((b) => b.content)).toEqual(["Otopark bina altındadır.", "Misafir yeri 3 numaradır."]);
    expect(bodies[0].requestId).not.toBe(bodies[1].requestId);
  });
});
