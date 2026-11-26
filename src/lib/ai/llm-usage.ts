import type { LlmUsage } from "./types";

/**
 * İki model çağrısının sayısal kullanımı toplanır (model adı / çaba ilk çağrıdan; biri yoksa öteki). YAPRAK modül (parça yeniden yazma ve kıdemli
 * okuyucunun yeniden yazması aynı kuralla sayar — ölçüm maliyeti eksik görünmesin). Saf.
 */
export function addLlmUsage(a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined {
  if (!a || !b) return a ?? b;
  const out: LlmUsage = { ...a };
  for (const k of ["pt", "ct", "cpt", "rt"] as const) {
    if (a[k] === undefined && b[k] === undefined) continue;
    out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  }
  return out;
}
