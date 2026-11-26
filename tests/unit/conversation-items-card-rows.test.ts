import { describe, it, expect } from "vitest";
import { ITEM_CARD_ROW_LIMIT, itemRowsForCard } from "@/lib/conversation-items/view";
import type { EffectiveItemStatus } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// Konuşma sayfası "Açık işler" kartı satır kuralı (Codex 11-17 E4): AÇIK öğelerin hepsi görünür, rozet toplamdan; tavan yalnız
// kapanmışları sınırlar (eski kural `.slice(0, 20)` açıkları da kesiyordu → 21. açık iş görünmüyor, rozet "20" diyordu).
// ---------------------------------------------------------------------------

const base = Date.UTC(2026, 0, 1);
let seq = 0;
function view(effective: EffectiveItemStatus, minutes: number) {
  return { id: `i${++seq}`, effective, messageAt: new Date(base + minutes * 60_000) };
}
const opens = (n: number, from = 0) => Array.from({ length: n }, (_, i) => view(i % 2 ? "open" : "pending_host", from + i));
const closeds = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => view((["host_replied", "answered", "done", "withdrawn", "superseded"] as const)[i % 5]!, from + i));

describe("itemRowsForCard", () => {
  it("🚨 21 açık + 5 kapalı → 21 açık satırın HEPSİ, rozet 21, kapanmışlar gizli (5)", () => {
    const views = [...closeds(5, 1000), ...opens(21)];
    const r = itemRowsForCard(views, new Set());
    expect(r.rows).toHaveLength(21);
    expect(r.rows.every((v) => v.effective === "open" || v.effective === "pending_host")).toBe(true);
    expect(r.openTotal).toBe(21);
    expect(r.hiddenClosed).toBe(5);
    // En ESKİ açık öğe de görünür (eski kuralda kesilen buydu).
    expect(r.rows.map((v) => v.id)).toContain(views[5]!.id);
  });

  it("aşırı uygulama: 3 açık + 30 kapalı → 20 satır, ilk 3'ü açık, kapanmışlar en yeniden; 13 kapalı gizli", () => {
    const o = opens(3);
    const c = closeds(30, 100);
    const r = itemRowsForCard([...c, ...o], new Set());
    expect(r.rows).toHaveLength(ITEM_CARD_ROW_LIMIT);
    expect(r.rows.slice(0, 3).map((v) => v.id)).toEqual([o[2]!.id, o[1]!.id, o[0]!.id]);
    expect(r.rows.slice(3).map((v) => v.id)).toEqual([...c].reverse().slice(0, 17).map((v) => v.id));
    expect(r.openTotal).toBe(3);
    expect(r.hiddenClosed).toBe(13);
  });

  it("kartı olan talebin öğesi (excludeIds) satırda da toplamda da yok", () => {
    const o = opens(2);
    const r = itemRowsForCard(o, new Set([o[0]!.id]));
    expect(r.rows.map((v) => v.id)).toEqual([o[1]!.id]);
    expect(r.openTotal).toBe(1);
    expect(r.hiddenClosed).toBe(0);
  });

  it("tavanın altında hiçbir şey gizlenmez; girdi dizisi değişmez", () => {
    const views = [...opens(2), ...closeds(3, 10)];
    const before = views.map((v) => v.id);
    const r = itemRowsForCard(views, new Set());
    expect(r.rows).toHaveLength(5);
    expect(r.hiddenClosed).toBe(0);
    expect(views.map((v) => v.id)).toEqual(before);
  });
});
