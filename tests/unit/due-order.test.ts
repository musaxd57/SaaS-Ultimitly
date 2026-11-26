import { describe, it, expect } from "vitest";
import { oldestFirst } from "@/lib/due-order";

// Ölçek turu 11-04 DB-1: oto-yanıt / abonelik-kapalı aday kümesinin sırası + tavanı SQL'den buraya taşındı. Seçilen küme ve sıra eskisiyle
// aynı olmalı: en eski `lastMessageAt` önce, eşitlikte `id` (çalışma dersi 09-27), tavan uygunluk süzgecinden SONRA.

const at = (min: number) => new Date(Date.UTC(2026, 10, 4, 12, min));
const row = (id: string, min: number) => ({ id, lastMessageAt: at(min) });

describe("oldestFirst — en eski önce, tavanlı", () => {
  it("en eski lastMessageAt önce gelir ve tavan uygulanır", () => {
    const rows = [row("c", 30), row("a", 10), row("d", 40), row("b", 20)];
    expect(oldestFirst(rows, 3).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("eşit zaman damgasında id artan sırayla kesinleşir (girdi sırasından bağımsız)", () => {
    const one = oldestFirst([row("z", 5), row("m", 5), row("a", 5)], 10).map((r) => r.id);
    const two = oldestFirst([row("a", 5), row("z", 5), row("m", 5)], 10).map((r) => r.id);
    expect(one).toEqual(["a", "m", "z"]);
    expect(two).toEqual(one);
  });

  it("zaman id'den önce gelir: daha eski ama büyük id'li satır önce", () => {
    expect(oldestFirst([row("a", 9), row("z", 1)], 1).map((r) => r.id)).toEqual(["z"]);
  });

  it("tavan küme boyundan büyükse hepsi döner; 0 ya da eksi tavan boş döner", () => {
    const rows = [row("b", 2), row("a", 1)];
    expect(oldestFirst(rows, 25).map((r) => r.id)).toEqual(["a", "b"]);
    expect(oldestFirst(rows, 0)).toEqual([]);
    expect(oldestFirst(rows, -3)).toEqual([]);
  });

  it("girdi dizisini değiştirmez; ek alanları korur", () => {
    const rows = [
      { id: "b", lastMessageAt: at(2), autoReplyAttemptedAt: null },
      { id: "a", lastMessageAt: at(1), autoReplyAttemptedAt: at(0) },
    ];
    const out = oldestFirst(rows, 5);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[0]).toBe(rows[1]);
    expect(out[0].autoReplyAttemptedAt).toEqual(at(0));
  });
});
