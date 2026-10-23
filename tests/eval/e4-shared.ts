import { retrievalQueries } from "@/lib/ai/retrieval/select";
import { chunkKey, type KbChunk } from "@/lib/ai/retrieval/chunker";
import { thresholdTransform } from "@/lib/ai/retrieval/semantic";
import type { SyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { PARAPHRASES, NEGATIVES } from "../helpers/kb-paraphrase-set";

// E4 ölçüm kümesinin ORTAK parçaları (E4 düzeneği ve #186 yeniden sıralayıcı ölçümleri paylaşır). Bir eval dosyasını
// başka bir eval dosyasından import etmek onun testlerini de KAYDEDER (ücretli ölçüm yan etkiyle koşar) → ortak kod burada.

export type E4Group = "scale" | "para" | "neg" | "multi";
export interface E4Query {
  id: string;
  group: E4Group;
  cls: string;
  text: string;
  goldIds: string[];
  needles: string[];
  /** Çok sorulu mesaj: HER grubun en az bir iğnesi blokta olmalı (iki cevap birden). */
  needleGroups?: string[][];
  /** `needleGroups` ile aynı sırada: her cevabın altın kalemleri (kaçan cevabın aday sırası için). */
  goldGroups?: string[][];
}

/** İki sorulu mesaj sayısı (parafraz + farklı konulu ölçek sorusu, " Ayrıca " ile). */
export const E4_MULTI_N = 40;

export function e4Queries(kb: SyntheticKb): E4Query[] {
  const out: E4Query[] = kb.questions.map((q) => ({ id: q.id, group: "scale", cls: q.kind, text: q.text, goldIds: q.goldIds, needles: q.needles }));
  for (const p of PARAPHRASES) {
    const ref = p.gold.startsWith("guide:")
      ? kb.questions.find((q) => q.id === `q_guide_${p.gold.slice(6)}`)
      : kb.questions.find((q) => q.topic === p.gold && q.kind === "tr");
    if (ref) out.push({ id: p.id, group: "para", cls: `para_${p.lang}`, text: p.text, goldIds: ref.goldIds, needles: ref.needles });
  }
  for (const n of NEGATIVES) out.push({ id: n.id, group: "neg", cls: `neg_${n.lang}`, text: n.text, goldIds: [], needles: [] });
  // ÇOK SORULU (09-23, alt sorgu başına anlamsal puanın ölçüsü): Türkçe parafraz + FARKLI konulu
  // doğrudan soru. Tek bir mesaj vektörü iki konunun karışımıdır; ölçülen şey İKİ cevabın da blokta
  // olması.
  const paraTr = out.filter((q) => q.group === "para" && q.cls === "para_tr");
  const direct = kb.questions.filter((q) => q.kind === "tr");
  for (let i = 0; i < Math.min(E4_MULTI_N, paraTr.length); i++) {
    const a = paraTr[i];
    const b = direct.find((q, j) => j >= i % direct.length && !q.goldIds.some((g) => a.goldIds.includes(g)));
    if (!b) continue;
    out.push({
      id: `multi_${i}`,
      group: "multi",
      cls: "multi_tr",
      text: `${a.text} Ayrıca ${b.text}`,
      goldIds: [...a.goldIds, ...b.goldIds],
      needles: [...a.needles, ...b.needles],
      needleGroups: [a.needles, b.needles],
      goldGroups: [a.goldIds, b.goldIds],
    });
  }
  return out;
}

/**
 * ÜRETİMİN alt sorgu başına haritası (`embeddings/semantic-retrieval.ts` ile aynı kural): her alt
 * sorgunun gömme metinlerinden EN YÜKSEK kosinüs, üretim eşik dönüşümüyle.
 */
export function semanticBySubquery(
  guestMessage: string,
  chunks: readonly KbChunk[],
  cosOf: (text: string, c: KbChunk) => number | null,
  t: number,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const q of retrievalQueries(guestMessage, undefined, { embedTexts: true }).queries) {
    const m = new Map<string, number>();
    for (const c of chunks) {
      let best: number | null = null;
      for (const text of q.embedTexts) {
        const cos = cosOf(text, c);
        if (cos !== null && (best === null || cos > best)) best = cos;
      }
      if (best === null) continue;
      const v = thresholdTransform(best, t);
      if (v > 0) m.set(chunkKey(c), v);
    }
    out.set(q.subquery, m);
  }
  return out;
}
