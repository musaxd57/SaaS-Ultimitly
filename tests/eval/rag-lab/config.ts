import { SEMANTIC_COSINE_THRESHOLD } from "@/lib/ai/retrieval/semantic";
import { RERANK_HOT_PATH_DEADLINE_MS, RERANK_MAX_CANDIDATES, RERANK_TEXT_CHARS } from "@/lib/ai/semantic/rerank";
import { KB_RETRIEVAL_FETCH_CAP, KB_RETRIEVAL_WIDE_CHAR_BUDGET, KB_RETRIEVAL_WIDE_MAX_CHUNKS } from "@/lib/ai/limits";
import type { LabConfig } from "./core";

// RAG LAB — yapılandırma adı çözücüsü (tek kaynak; `rag-lab.eval.test.ts` ve `rag-answer.eval.test.ts` paylaşır).

export const T_PROD = SEMANTIC_COSINE_THRESHOLD;
export const RR = { k: RERANK_MAX_CANDIDATES, crop: RERANK_TEXT_CHARS };
export const CAP = KB_RETRIEVAL_FETCH_CAP;

/**
 * Yapılandırma adı = "+" ile ayrılmış belirteçler (tek kaynak, deney eklemek kod değişikliği istemez):
 * `lex` (anlamsal yok) · `s0.3` (anlamsal, ham kosinüs eşiği) · `und` (anlama katmanı sorguları) · `rr20/600` (yeniden sıralayıcı: ilk
 * K aday / kırpma) · `fb` (geri çekilmede de sırala) · `fused` (pencere listeler arası RRF) · `mixed6` (önce özgün soru başına 6,
 * sonra RRF) · `pq` (soru başına etiket) · `dry` (modelsiz pencere tavanı) · `dl2500` (üretimin zaman aşımı tavanı) · `cap400`
 * (okuma tavanı) · `b9000` / `mc16` (seçim bütçesi karakter / parça) · `skip` (sığmayan parçayı atla) · `pi5` (kalem başına parça) ·
 * `demote` (modelin görüp işaretlemediği aday görülmemişlerin arkasına) · `xs0.5` (anlama sorgularının bütçe payı; varsayılan 1/3) · `prl` (ayrı çağrıda soru başına etiket) · `wper50` / `wown20` / `wownrrf` / `wfloor10` (üretim penceresi kuruluş deneyleri) ·
 * `wide` (üretimin geniş blok bütçesi `KB_RETRIEVAL_WIDE_BUDGET` — değerler üretim sabitlerinden, tek kaynak) · `ansfirst`
 * (yeniden sıralayıcının "cevaplıyor" dediği parçalar önce) · `qcap` / `mcap` (kalem parça tavanı soru başına — 09-27'den beri üretim varsayılanı — / eski mesaj geneli) · `rrm:<model>` / `rre:<çaba>` (yalnız yeniden sıralayıcının modeli / düşünme
 * çabası; ör. `rrm:gpt-6-luna+rre:low`).
 * `prod` = canlının kendisi (s{canlı eşik}+und+rr20/600, 2,5 sn tavan, okuma 200; üretim penceresi, soru başına ayrı çağrı).
 * `prod` / `base0926` İLK belirteç olarak taban da olur, ardından gelen belirteçler üstüne uygulanır (`prod+wide`, `prod+e3l`).
 */
const BASES: Record<string, () => Omit<LabConfig, "name">> = {
  prod: () => ({ semantic: { t: T_PROD }, understanding: true, rerank: { ...RR, window: "prod", deadlineMs: RERANK_HOT_PATH_DEADLINE_MS }, fetchCap: CAP }),
  // 09-26 gece öncesi CANLI hâl (sabitler değişse de kıyas tabanı sabit kalsın): small gömme · eşik 0,4 · ilk 20 · 600 · 2,5 sn · okuma 200.
  // Kalem parça tavanı 09-27'de soru başına oldu (üretim varsayılanı) → taban eski mesaj geneli tavanda SABİT kalır.
  base0926: () => ({ semantic: { t: 0.4, model: "text-embedding-3-small" }, understanding: true, rerank: { k: 20, crop: 600, deadlineMs: 2_500 }, fetchCap: 200, select: { strategy: { itemCapScope: "message" } } }),
};

export function parseConfig(name: string): LabConfig {
  const [first, ...rest] = name.split("+");
  const base = Object.hasOwn(BASES, first) ? BASES[first]() : null;
  const cfg: LabConfig = { name, ...(base ?? { semantic: null, understanding: false, rerank: null, fetchCap: CAP }) };
  for (const tok of base ? rest : [first, ...rest]) {
    let m: RegExpMatchArray | null;
    if (tok === "lex") cfg.semantic = null;
    else if ((m = tok.match(/^s(0\.\d+)$/))) cfg.semantic = { t: Number(m[1]) };
    else if (tok === "und") cfg.understanding = true;
    else if ((m = tok.match(/^rr(\d+)\/(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? {}), k: Number(m[1]), crop: Number(m[2]) };
    else if (tok === "fb") cfg.rerank = { ...(cfg.rerank ?? RR), onFallback: true };
    else if (tok === "fused") cfg.rerank = { ...(cfg.rerank ?? RR), window: "fused" };
    else if (tok === "qfused") cfg.rerank = { ...(cfg.rerank ?? RR), window: "qfused" };
    else if (tok === "req") cfg.rerank = { ...(cfg.rerank ?? RR), window: "req" };
    else if (tok === "reqsplit") cfg.rerank = { ...(cfg.rerank ?? RR), window: "reqsplit" };
    else if (tok === "reqx") cfg.rerank = { ...(cfg.rerank ?? RR), window: "reqx" };
    else if (tok === "prodwin") cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod" };
    else if (tok === "onecall") cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", split: false };
    else if (tok === "prl") cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", perRequestLabels: true };
    else if ((m = tok.match(/^wper(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", windowOpts: { ...(cfg.rerank?.windowOpts ?? {}), perRequest: Number(m[1]) } };
    else if ((m = tok.match(/^wown(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", windowOpts: { ...(cfg.rerank?.windowOpts ?? {}), own: Number(m[1]) } };
    else if (tok === "wownrrf") cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", windowOpts: { ...(cfg.rerank?.windowOpts ?? {}), ownFusion: "rrf" } };
    else if ((m = tok.match(/^wfloor(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), window: "prod", windowOpts: { ...(cfg.rerank?.windowOpts ?? {}), listFloor: Number(m[1]) } };
    else if ((m = tok.match(/^own(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), ownQuota: Number(m[1]) };
    else if ((m = tok.match(/^mixed(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), window: "mixed", ownQuota: Number(m[1]) };
    else if (tok === "dry") cfg.rerank = { ...(cfg.rerank ?? RR), dry: true };
    else if (tok === "pq") cfg.rerank = { ...(cfg.rerank ?? RR), perQuestion: true };
    else if ((m = tok.match(/^cap(\d+)$/))) cfg.fetchCap = Number(m[1]);
    else if (tok === "e3l") cfg.semantic = { ...(cfg.semantic ?? { t: T_PROD }), model: "text-embedding-3-large" };
    else if (tok === "e3s") cfg.semantic = { ...(cfg.semantic ?? { t: T_PROD }), model: "text-embedding-3-small" };
    else if ((m = tok.match(/^b(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), budgetChars: Number(m[1]) };
    else if ((m = tok.match(/^mc(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), maxChunks: Number(m[1]) };
    else if (tok === "skip") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), packing: "skip" } };
    else if ((m = tok.match(/^pi(\d+)$/))) cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), maxChunksPerItem: Number(m[1]) } };
    else if ((m = tok.match(/^xs(0(?:\.\d+)?|1)$/))) cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), extraShare: Number(m[1]) } };
    else if ((m = tok.match(/^dl(\d+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), deadlineMs: Number(m[1]) };
    else if (tok === "demote") cfg.rerank = { ...(cfg.rerank ?? RR), demote: true };
    else if (tok === "ansfirst") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), answersFirst: true } };
    else if (tok === "qcap") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), itemCapScope: "question" } };
    else if (tok === "mcap") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), itemCapScope: "message" } };
    else if (tok === "nhf") cfg.select = { ...(cfg.select ?? {}), strategy: { ...(cfg.select?.strategy ?? {}), noHitFill: true } };
    else if (tok === "wide") cfg.select = { ...(cfg.select ?? {}), budgetChars: KB_RETRIEVAL_WIDE_CHAR_BUDGET, maxChunks: KB_RETRIEVAL_WIDE_MAX_CHUNKS };
    else if ((m = tok.match(/^rrm:([a-z0-9.-]+)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), model: m[1] };
    else if ((m = tok.match(/^rre:(none|minimal|low|medium|high)$/))) cfg.rerank = { ...(cfg.rerank ?? RR), effort: m[1] };
    else throw new Error(`bilinmeyen yapılandırma belirteci ${tok} (${name})`);
  }
  return cfg;
}

