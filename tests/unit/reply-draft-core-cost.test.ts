import { describe, it, expect } from "vitest";
import { diffDraft } from "@/lib/reply-draft/core";
import { costMessage, measureCost, scaled, SCALED_FULL } from "../helpers/linear-cost";

// ---------------------------------------------------------------------------
// SÜRE PİNİ — taslak ↔ gönderilen metin farkı ev sahibi / misafir metnine uygulanır (CLAUDE.md ReDoS kuralı: karesel iş YOK). En uzun ortak alt
// dizi `DIFF_TOKEN_CAP` ile sınırlı; belirteçleme tek geçişli; cümle silme ölçümü cümlenin kendi boyuyla sınırlı (11-13: önce her cümle için
// gönderilen metnin sayacı kopyalanıyordu — cümle sayısı × metin boyu). Kural "sınırın altında — ya da doğrusal ve 4 katının altında"
// (`tests/helpers/linear-cost.ts`).
// ---------------------------------------------------------------------------

describe("diffDraft süre pini", () => {
  it("çok cümleli uzun taslak + uzun gönderim (cümle başına iş sınırlı)", () => {
    const run = (x: { d: string; s: string }) => diffDraft(x.d, x.s);
    const family = scaled((r) => ({ d: r("Havlularınızı yarın değiştireceğiz. ", 4_000), s: r("Teşekkürler, iyi tatiller dileriz. ", 4_000) }));
    const v = measureCost(run, family, SCALED_FULL, 1_500);
    expect(v.ok, costMessage(v, 1_500)).toBe(true);
  });

  it("tek dev sözcük / boşluk dizisi / e-posta benzeri dizi", () => {
    const run = (x: { d: string; s: string }) => diffDraft(x.d, x.s);
    for (const unit of ["a", " ", "a.", "@", "1,"]) {
      const family = scaled((r) => ({ d: r(unit, 60_000), s: r(unit, 60_000) + " x" }));
      const v = measureCost(run, family, SCALED_FULL, 1_500);
      expect(v.ok, `${JSON.stringify(unit)}: ${costMessage(v, 1_500)}`).toBe(true);
    }
  });
});
