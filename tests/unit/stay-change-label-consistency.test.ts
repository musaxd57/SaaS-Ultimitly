import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// U24 (Codex 10-07): açık (görülmüş) geliştirme setlerinde AYNI durum zıt etiketliydi. Mülkün girişi 15:00 iken misafirin "ilanda
// 16:00 yazıyor, 15:00'te girebilir miyiz?" sorusu `stay-change.json` d-q017'de `early`, `stay-change-dev2.json` e-q049'da `none`.
// 10-02 kuralı (standart saat YALNIZ mülkün kendi saati): `none`. Eski raporlar o tarihte `early` saymıştı — satırın `relabel` notu.
// Yalnız `dev` / `dev2` satırları okunur (mühürlü / özel setlere dokunulmaz).
// ---------------------------------------------------------------------------

type Req = { id: string; split: string; kind: string; checkIn: string; relabel?: string };
const read = (f: string) => (JSON.parse(readFileSync(path.resolve(__dirname, "../../evals", f), "utf8")) as { requests: Req[] }).requests;

describe("U24 — açık setler arası etiket tutarlılığı", () => {
  const a = read("stay-change.json").find((r) => r.id === "d-q017" && r.split === "dev");
  const b = read("stay-change-dev2.json").find((r) => r.id === "e-q049" && r.split === "dev2");

  it("🚨 aynı durum (mülk 15:00, ilan 16:00, misafir 15:00 istiyor) iki sette de `none`", () => {
    expect(a?.checkIn).toBe("15:00");
    expect(b?.checkIn).toBe("15:00");
    expect(a?.kind).toBe("none"); // ⬅️ ESKİDE "early"
    expect(b?.kind).toBe("none");
  });

  it("etiket değişikliği satırda belgeli (eski raporlar sessizce yeniden yorumlanmaz)", () => {
    expect(a?.relabel).toMatch(/2026-10-07/);
  });
});
