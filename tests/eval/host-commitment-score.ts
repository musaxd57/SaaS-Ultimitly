// ---------------------------------------------------------------------------
// EV SAHİBİ SÖZÜ ÖLÇÜMÜ — PUANLAMA ÇEKİRDEĞİ (saf; ağ / model / dosya yok). Ölçüm betiği (`host-commitment-report.ts`) ve birim testi aynı
// kuralı buradan okur. Üç basamaklı karar (auto · card · none) beklentiyle kıyaslanır; hatalar YÖNÜNE göre ayrılır — yönlerin bedeli farklı:
//  · wrong_task  — beklenti görev DEĞİLKEN "görev" dendi (yanlış görev açılır: en pahalı hata, kabul ölçütü 0);
//  · missed_task — beklenti görevken görev denmedi (söz kaçtı / gereksiz tutuldu);
//  · card_noise  — beklenti "hiçbir şey" iken kart çıktı (ev sahibine gereksiz soru);
//  · card_missed — beklenti kartken hiçbir şey denmedi (belirsiz söz sessizce düştü).
// ---------------------------------------------------------------------------

export type Decision = "auto" | "card" | "none";

export interface ScoredCase {
  id: string;
  expect: Decision;
  got: Decision;
}

export type ErrorKind = "wrong_task" | "missed_task" | "card_noise" | "card_missed";

/** Tek vakanın hata türü; doğruysa null. */
export function errorKindOf(expect: Decision, got: Decision): ErrorKind | null {
  if (expect === got) return null;
  if (got === "auto") return "wrong_task";
  if (expect === "auto") return "missed_task";
  return expect === "none" ? "card_noise" : "card_missed";
}

export interface ArmScore {
  total: number;
  correct: number;
  errors: Record<ErrorKind, string[]>;
}

/** Bir kolun (sözcük ağı / model / model + doğrulama) puanı: doğru sayısı + türüne göre hatalı vaka kimlikleri. */
export function scoreArm(cases: readonly ScoredCase[]): ArmScore {
  const errors: Record<ErrorKind, string[]> = { wrong_task: [], missed_task: [], card_noise: [], card_missed: [] };
  let correct = 0;
  for (const c of cases) {
    const kind = errorKindOf(c.expect, c.got);
    if (kind) errors[kind].push(c.id);
    else correct++;
  }
  return { total: cases.length, correct, errors };
}

/** Rapor satırı: "36 vakanın 22'si doğru · yanlış görev 7 · kaçan görev 3 · gereksiz kart 2 · kaçan kart 2". */
export function armSummaryTr(score: ArmScore): string {
  const n = (k: ErrorKind) => score.errors[k].length;
  return `${score.total} vakanın ${score.correct}'i doğru · yanlış görev ${n("wrong_task")} · kaçan görev ${n("missed_task")} · gereksiz kart ${n("card_noise")} · kaçan kart ${n("card_missed")}`;
}
