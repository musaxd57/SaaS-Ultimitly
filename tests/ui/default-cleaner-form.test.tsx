// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, act, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Bu dairenin temizlikçisi" kartı (kurucu 11-05 gece; K-1 kurucu / Codex 11-06): seçim "Kaydet" ile yazılır. Kişi değişirken eski kişide
// duran işler için TEK toplu onay YOK: aktarılabilir (başlanmamış / "Yapılamıyor") görevler sayı + tarih aralığı + liste olarak gösterilir,
// ev sahibi SEÇER ("Kaydet ve seçilenleri aktar" → moveTaskIds = seçilenler); "Yalnız kaydet" → hiçbiri; başlanmış işler ayrı listelenir,
// seçilemez, aktarılmaz.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { DefaultCleanerForm, type TransferItem } from "@/components/properties/default-cleaner-form";
import { subscribeToasts, __resetToastsForTest } from "@/lib/toast";

const members = [
  { id: "u-ayse", name: "Ayşe" },
  { id: "u-mehmet", name: "Mehmet" },
];
const movable: TransferItem[] = [
  { id: "t1", title: "Çıkış temizliği", dueLabel: "07 Kas 2026", statusLabel: "Yapılacak" },
  { id: "t2", title: "Çıkış temizliği", dueLabel: "12 Kas 2026", statusLabel: "Yapılamıyor" },
  { id: "t3", title: "Çıkış temizliği", dueLabel: "20 Kas 2026", statusLabel: "Yapılacak" },
];
const started: TransferItem[] = [{ id: "s1", title: "Çıkış temizliği", dueLabel: "06 Kas 2026", statusLabel: "Devam ediyor" }];

let bodies: unknown[];
let reply: unknown;
let toasts: string[];
beforeEach(() => {
  bodies = [];
  reply = {};
  toasts = [];
  subscribeToasts((m) => toasts.push(`${m.variant}: ${m.text}`));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetToastsForTest();
});

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
async function select(value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Bu dairenin temizlikçisi"), { target: { value } });
    await flush();
  });
}
async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await flush();
  });
}
const panel = () => screen.getByRole("region", { name: "Mevcut görevleri aktarma" });

describe("dairenin temizlikçisi kartı — seçerek aktarma (K-1)", () => {
  it("kutunun GÖRÜNÜR etiketi var ('Bu dairenin temizlikçisi')", () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={[]} started={[]} />);
    expect(screen.getByText("Bu dairenin temizlikçisi").tagName).toBe("LABEL");
  });

  it("🚨 aktarılabilir iş varken kişi değişip 'Kaydet'e basılınca İSTEK GİTMEZ, liste açılır: sayı + tarih aralığı + kurucunun sorusu, hepsi seçili", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={started} />);
    await select("u-mehmet");
    await click("Kaydet");
    expect(bodies).toEqual([]);
    const p = panel();
    expect(p.textContent).toContain("Mehmet bundan sonraki temizliklerde kullanılacak. Ayrıca mevcut 3 başlanmamış görevi de aktarmak ister misiniz?");
    expect(p.textContent).toContain("3 görev · 07 Kas 2026 – 20 Kas 2026");
    const boxes = within(p).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true]);
    // "Yapılamıyor" denmiş iş de listede (aktarılabilir) — durumuyla.
    expect(p.textContent).toContain("12 Kas 2026 · Çıkış temizliği · Yapılamıyor");
  });

  it("🚨 'Kaydet ve seçilenleri aktar' YALNIZ seçilenleri gönderir (birini çıkarınca o gitmez)", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={started} />);
    await select("u-mehmet");
    await click("Kaydet");
    const boxes = within(panel()).getAllByRole("checkbox");
    await act(async () => {
      fireEvent.click(boxes[1]);
      await flush();
    });
    await click("Kaydet ve seçilenleri aktar (2)");
    expect(bodies).toEqual([{ userId: "u-mehmet", moveTaskIds: ["t1", "t3"] }]);
  });

  it("'Yalnız kaydet' → kişi kaydedilir, HİÇBİR görev aktarılmaz (boş liste)", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={started} />);
    await select("u-mehmet");
    await click("Kaydet");
    await click("Yalnız kaydet");
    expect(bodies).toEqual([{ userId: "u-mehmet", moveTaskIds: [] }]);
    expect(screen.queryByRole("region", { name: "Mevcut görevleri aktarma" })).toBeNull();
  });

  it("🚨 başlanmış işler AYRI listelenir, seçilemez ve gönderilmez", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={started} />);
    await select("u-mehmet");
    await click("Kaydet");
    const p = panel();
    expect(p.textContent).toContain("Başlanmış işler aktarılmaz");
    expect(p.textContent).toContain("06 Kas 2026 · Çıkış temizliği · Devam ediyor");
    // Onay kutusu yalnız aktarılabilir 3 iş için.
    expect(within(p).getAllByRole("checkbox")).toHaveLength(3);
    await click("Kaydet ve seçilenleri aktar (3)");
    expect(bodies).toEqual([{ userId: "u-mehmet", moveTaskIds: ["t1", "t2", "t3"] }]);
  });

  it("'Seçimi kaldır' hepsini kaldırır → aktarma düğmesi kapalı; 'Tümünü seç' geri getirir", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={[]} />);
    await select("u-mehmet");
    await click("Kaydet");
    await click("Seçimi kaldır");
    expect((screen.getByRole("button", { name: "Kaydet ve seçilenleri aktar (0)" }) as HTMLButtonElement).disabled).toBe(true);
    await click("Tümünü seç");
    expect((screen.getByRole("button", { name: "Kaydet ve seçilenleri aktar (3)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("listedeki 'Vazgeç' → hiçbir şey yazılmaz, seçim eski kişiye döner, liste kapanır", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={started} />);
    await select("u-mehmet");
    await click("Kaydet");
    await click("Vazgeç");
    expect(bodies).toEqual([]);
    expect((screen.getByLabelText("Bu dairenin temizlikçisi") as HTMLSelectElement).value).toBe("u-ayse");
    expect(screen.queryByRole("region", { name: "Mevcut görevleri aktarma" })).toBeNull();
  });

  it("sonuç: aktarılan sayısı söylenir; sunucunun atladığı (arada başlanmış) iş ayrıca söylenir", async () => {
    reply = { ok: true, userId: "u-mehmet", moved: 2, skipped: 1 };
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={[]} />);
    await select("u-mehmet");
    await click("Kaydet");
    await click("Kaydet ve seçilenleri aktar (3)");
    expect(toasts).toEqual([
      "success: Kaydedildi. Sonraki temizlikler bu kişiye atanacak. 2 görev aktarıldı.",
      "error: 1 görev aktarılamadı: bu arada başlanmış ya da değişmiş. Görevler'den bakın.",
    ]);
  });

  it("🚨 Opus 11-06 N11: seçim TEK BAŞINA kaydetmez — 'Kaydet' gerekir; 'Vazgeç' seçimi geri alır", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={[]} />);
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    await select("u-mehmet");
    expect(bodies).toEqual([]);
    await click("Vazgeç");
    expect((screen.getByLabelText("Bu dairenin temizlikçisi") as HTMLSelectElement).value).toBe("u-ayse");
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(bodies).toEqual([]);
  });

  it("KONTROL — aktarılabilir iş yoksa ya da ilk seçimse liste AÇILMAZ (doğrudan kayıt, aktarma alanı yok); 'Kimse' kuralı kaldırır", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId={null} members={members} movable={[]} started={started} />);
    await select("u-ayse");
    await click("Kaydet");
    await select("");
    await click("Kaydet");
    expect(screen.queryByRole("region", { name: "Mevcut görevleri aktarma" })).toBeNull();
    expect(bodies).toEqual([{ userId: "u-ayse" }, { userId: null }]);
  });

  it("KONTROL — kişi 'Kimse'ye çekilirse liste açılmaz (eski kişinin işleri onda kalır)", async () => {
    render(<DefaultCleanerForm propertyId="p1" currentUserId="u-ayse" members={members} movable={movable} started={[]} />);
    await select("");
    await click("Kaydet");
    expect(screen.queryByRole("region", { name: "Mevcut görevleri aktarma" })).toBeNull();
    expect(bodies).toEqual([{ userId: null }]);
  });
});
