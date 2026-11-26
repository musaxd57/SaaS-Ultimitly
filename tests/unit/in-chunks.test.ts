import { describe, it, expect, vi } from "vitest";
import { findInChunks, IN_LIST_CHUNK } from "@/lib/in-chunks";

// Ölçek turu 11-04 DB-4: PostgreSQL bir hazır ifadede en çok 32.767 bağ değişkeni alır, Prisma `in` listesini parçalamaz.

describe("findInChunks — büyük IN listesi dilim dilim", () => {
  it("varsayılan dilim PostgreSQL sınırının güvenli altında", () => {
    expect(IN_LIST_CHUNK).toBeGreaterThan(1000);
    expect(IN_LIST_CHUNK).toBeLessThanOrEqual(30_000);
  });

  it("boş liste → sorgu YOK, boş sonuç", async () => {
    const fetch = vi.fn(async (ids: string[]) => ids);
    expect(await findInChunks([], fetch)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("dilim sınırında doğru bölünür; sonuçlar dilim sırasıyla birleşir", async () => {
    const keys = Array.from({ length: 7 }, (_, i) => `k${i}`);
    const seen: string[][] = [];
    const out = await findInChunks(keys, async (ids) => {
      seen.push(ids);
      return ids.map((id) => `r-${id}`);
    }, 3);
    expect(seen).toEqual([["k0", "k1", "k2"], ["k3", "k4", "k5"], ["k6"]]);
    expect(out).toEqual(keys.map((k) => `r-${k}`));
  });

  it("tam katta fazladan boş dilim sorulmaz", async () => {
    const fetch = vi.fn(async (ids: number[]) => ids);
    await findInChunks([1, 2, 3, 4, 5, 6], fetch, 3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("tekrarlı anahtar bir kez sorulur (aynı satır iki kez dönmez)", async () => {
    const fetch = vi.fn(async (ids: string[]) => ids);
    expect(await findInChunks(["a", "b", "a", "c", "b"], fetch, 2)).toEqual(["a", "b", "c"]);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([["a", "b"], ["c"]]);
  });

  it("dilimler SIRAYLA sorulur (aynı anda tek sorgu)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await findInChunks(Array.from({ length: 10 }, (_, i) => i), async (ids) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return ids;
    }, 2);
    expect(maxInFlight).toBe(1);
  });

  it("geçersiz dilim boyu (0, kesirli) sonsuz döngüye girmez", async () => {
    const fetch = vi.fn(async (ids: number[]) => ids);
    expect(await findInChunks([1, 2, 3], fetch, 0)).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear();
    expect(await findInChunks([1, 2, 3], fetch, 2.7)).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
