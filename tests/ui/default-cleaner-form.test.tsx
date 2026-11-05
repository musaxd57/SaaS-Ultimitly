// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Bu dairenin temizlikçisi" kartı (kurucu 11-05 gece): seçim kaydedilir; kişi değişirken eski kişide duran başlanmamış gelecekteki
// temizlikler için AÇIK soru sorulur — "Evet, geçsin" → moveOpen true, "Hayır, yalnız yeniler" → false (yine kaydedilir).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { DefaultCleanerForm } from "@/components/properties/default-cleaner-form";
import { registerConfirmHandler, __resetConfirmForTest } from "@/lib/confirm";

const members = [
  { id: "u-ayse", name: "Ayşe" },
  { id: "u-mehmet", name: "Mehmet" },
];

let bodies: unknown[];
let asked: string[];
beforeEach(() => {
  bodies = [];
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetConfirmForTest();
});

/** Seçer ve "Kaydet"e basar (seçim tek başına yazmaz — Opus 11-06 N11). */
async function choose(value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Bu dairenin temizlikçisi"), { target: { value } });
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

describe("dairenin temizlikçisi kartı", () => {
  it("gerçek uygulama ekranı (11-06): kutunun GÖRÜNÜR etiketi var ('Bu dairenin temizlikçisi'); soru metni 'Yapılamıyor'ların da geçtiğini söyler", async () => {
    const bodiesAsked: string[] = [];
    registerConfirmHandler(async (o) => {
      bodiesAsked.push(String(o.body));
      return false;
    });
    render(<DefaultCleanerForm propertyId="p1" propertyName="Lale 5" currentUserId="u-ayse" members={members} openFutureCount={1} />);
    expect(screen.getByText("Bu dairenin temizlikçisi").tagName).toBe("LABEL");
    await choose("u-mehmet");
    expect(bodiesAsked[0]).toBe(
      "Başlanmamış temizlikler geçer (“Yapılamıyor” denmiş ve elle atanmış olanlar dahil). Başlanmış işlere ve elle açtığınız görevlere dokunulmaz.",
    );
  });

  it("🚨 açık iş varken kişi değişirse SORU sorulur; 'Evet' → moveOpen true", async () => {
    registerConfirmHandler(async (o) => {
      asked.push(o.title);
      return true;
    });
    render(<DefaultCleanerForm propertyId="p1" propertyName="Lale 5" currentUserId="u-ayse" members={members} openFutureCount={3} />);
    await choose("u-mehmet");
    expect(asked).toEqual(["Lale 5: gelecekteki 3 açık temizlik de Mehmet adına geçsin mi?"]);
    expect(bodies).toEqual([{ userId: "u-mehmet", moveOpen: true }]);
  });

  it("'Hayır, yalnız yeniler' → yine kaydedilir, moveOpen false", async () => {
    registerConfirmHandler(async () => false);
    render(<DefaultCleanerForm propertyId="p1" propertyName="Lale 5" currentUserId="u-ayse" members={members} openFutureCount={3} />);
    await choose("u-mehmet");
    expect(bodies).toEqual([{ userId: "u-mehmet", moveOpen: false }]);
  });

  it("🚨 Opus 11-06 N11: seçim TEK BAŞINA kaydetmez — 'Kaydet' gerekir; 'Vazgeç' seçimi geri alır ve hiçbir şey yazılmaz", async () => {
    registerConfirmHandler(async (o) => {
      asked.push(o.title);
      return true;
    });
    render(<DefaultCleanerForm propertyId="p1" propertyName="Lale 5" currentUserId="u-ayse" members={members} openFutureCount={3} />);
    const select = screen.getByLabelText("Bu dairenin temizlikçisi") as HTMLSelectElement;
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    await act(async () => {
      fireEvent.change(select, { target: { value: "u-mehmet" } });
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(asked).toEqual([]);
    expect(bodies).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    expect(select.value).toBe("u-ayse");
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(bodies).toEqual([]);
  });

  it("KONTROL — açık iş yoksa ya da ilk seçimse soru SORULMAZ; 'Kimse' kuralı kaldırır", async () => {
    registerConfirmHandler(async (o) => {
      asked.push(o.title);
      return true;
    });
    render(<DefaultCleanerForm propertyId="p1" propertyName="Lale 5" currentUserId={null} members={members} openFutureCount={0} />);
    await choose("u-ayse");
    await choose("");
    expect(asked).toEqual([]);
    expect(bodies).toEqual([
      { userId: "u-ayse", moveOpen: false },
      { userId: null, moveOpen: false },
    ]);
  });
});
