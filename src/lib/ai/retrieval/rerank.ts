import type { KbChunk, KbChunkSource } from "./chunker";
import { timeSetsConflict, type FieldTimes } from "./time-fields";

// ---------------------------------------------------------------------------
// YENİDEN SIRALAMA + SÜRÜM/ÇELİŞKİ KURALLARI (RAG dilim 2+3, 09-09).
//
// Deterministik özellik toplamı — model yok. Bileşenler harness ile ÖLÇÜLEREK
// ayarlanır (politika değildir):
//   base      : birleşik puan / max (0..1)
//   hint      : kavram → kategori ipucu (0.35·güç)
//   title     : sorgu kökü başlıkta (0.15)
//   phrase    : sorgu bigramı parçada (0.10)
//   tazelik   : PUANA EKLENMEZ. Sıralamada puan 0.01 hassasiyetinde eşitse (yakın
//               eşitlik) YENİ kalem önde (`sortCandidates`). Codex 09-09: "puana
//               eklenen tazelik eşitlik bozucu değildir" — düzeltildi, test-pinli.
// Sürüm: `supersededById` halefi kümede olan kalem DÜŞER (eski sürüm modele
// gitmez). Halef kümede yoksa (pasif/silinmiş) eski kalem KORUNUR — bilgiyi
// sessizce kaybetmektense host'un görebildiği kalemi taşımak yeğdir.
// Çelişki: aynı SAAT ALANINDA (çıkış/giriş/havuz/…) FARKLI saat taşıyan parçalar
// birlikte gider (P4 iki kaynağı görsün) — kategoriye BAKILMAZ (Codex 09-09:
// kategori bazlı kontrol hem fazla geniş hem fazla dardı; alan bazlı yapıldı).
// ---------------------------------------------------------------------------

export const HINT_BONUS = 0.35;
/**
 * Parçanın TEK kanıtı kategori ipucuysa (sözcüksel/n-gram/anlamsal puanı 0) daha
 * düşük bonus: "rules" gibi geniş kategorilerde ipucu tek başına 4–5 ilgisiz
 * kalemi bloğa dolduruyordu (ölçüldü, ölçek harness'ı n=100: gürültü 4+).
 * Göreli eşik (0.25·en iyi) böylece yalnız-ipucu parçaları gerçek bir isabet
 * varken eler; isabet YOKKEN (host kategoriye bambaşka kelimelerle yazmış) tek
 * aday olarak yine geçer.
 */
export const HINT_ONLY_BONUS = 0.2;
export const TITLE_BONUS = 0.15;
/** Başlığın TAMAMI sorgu terimleriyle (kök ∪ genişletme) örtülüyorsa: "Havuz" başlığı,
 *  "havuz kaçta açılıyor" sorusunda "Havuz kuralı" başlığından öndedir (kısa çeldirici ölçüldü). */
export const TITLE_FULL_BONUS = 0.15;
/** Başlık eşleşmesi yalnız GENİŞLETME terimiyle ("lift" → "asansor") ise yarım bonus. */
export const TITLE_EXPANSION_FACTOR = 0.5;
export const PHRASE_BONUS = 0.1;
/** Yakın eşitlik hassasiyeti: bu adımda eşit puanlar tazelikle sıralanır. */
export const SCORE_TIE_STEP = 0.01;

export interface RerankContext {
  /** Sorgunun kendi kökleri (fuzzy çözümlü). */
  ownStems: ReadonlySet<string>;
  /** Sözlük genişletmesinden gelen kökler. */
  expansionStems: ReadonlySet<string>;
  bigrams: readonly (readonly [string, string])[];
  categoryHints: ReadonlyMap<string, number>;
}

export interface RerankDoc {
  stems: readonly string[];
  titleStems: ReadonlySet<string>;
}

export interface Candidate {
  idx: number;
  score: number;
}

function hasBigram(docStems: readonly string[], a: string, b: string): boolean {
  for (let i = 0; i + 1 < docStems.length; i++) {
    if (docStems[i] === a && docStems[i + 1] === b) return true;
  }
  return false;
}

/**
 * `base` (0..1) üstüne özellik bonusları. Yalnız `qualified` parçalar aday
 * olur; puan > 0 olanlar döner (sıralanmamış — seçici sıralar).
 */
export function rerank(
  chunks: readonly KbChunk[],
  docs: readonly RerankDoc[],
  base: Float64Array,
  qualified: (i: number) => boolean,
  ctx: RerankContext,
  /**
   * Parçanın kategori ipucu DIŞINDA gerçek kanıtı var mı (güçlü kök isabeti /
   * n-gram eşiği / anlamsal puan)? Verilmezse `base > 0` kullanılır. Ölçüldü:
   * n-gram kosinüsü hemen her parçaya sıfırdan büyük ama anlamsız bir puan
   * verdiği için `base > 0` tek başına "yalnız-ipucu"yu ayıramıyordu.
   */
  hasEvidence: (i: number) => boolean = (i) => base[i] > 0,
): Candidate[] {
  const out: Candidate[] = [];
  chunks.forEach((chunk, i) => {
    if (!qualified(i)) return;
    let s = base[i];
    const hint = ctx.categoryHints.get(chunk.category) ?? 0;
    if (hint > 0) s += (hasEvidence(i) ? HINT_BONUS : HINT_ONLY_BONUS) * Math.min(1, hint);
    let titleOwn = false;
    let titleExp = false;
    let titleCovered = docs[i].titleStems.size > 0;
    for (const t of docs[i].titleStems) {
      if (ctx.ownStems.has(t)) titleOwn = true;
      else if (ctx.expansionStems.has(t)) titleExp = true;
      else titleCovered = false;
    }
    if (titleOwn) s += TITLE_BONUS;
    else if (titleExp) s += TITLE_BONUS * TITLE_EXPANSION_FACTOR;
    if (titleCovered && (titleOwn || titleExp)) s += TITLE_FULL_BONUS;
    if (ctx.bigrams.some(([a, b]) => hasBigram(docs[i].stems, a, b))) s += PHRASE_BONUS;
    if (s > 0) out.push({ idx: i, score: s });
  });
  return out;
}

/** Deterministik sıra: puan (0.01 adımına yuvarlanmış) ↓, updatedAt ↓ (tazelik = yakın-eşitlik bozucu), id ↑, parça ↑. */
export function sortCandidates(cands: Candidate[], chunks: readonly KbChunk[]): Candidate[] {
  const q = (x: number) => Math.round(x / SCORE_TIE_STEP);
  return cands.sort((a, b) => {
    if (q(b.score) !== q(a.score)) return q(b.score) - q(a.score);
    const ca = chunks[a.idx];
    const cb = chunks[b.idx];
    const ta = ca.updatedAt.getTime();
    const tb = cb.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    if (ca.id !== cb.id) return ca.id < cb.id ? -1 : 1;
    return ca.chunkIndex - cb.chunkIndex;
  });
}

export interface Supersedable extends KbChunkSource {
  supersededById?: string | null;
}

/** Halefi kümede olan kalemleri düşür (sürüm kuralı). */
export function dropSuperseded<T extends Supersedable>(items: readonly T[]): { kept: T[]; dropped: number } {
  const ids = new Set(items.map((i) => i.id));
  const kept = items.filter((i) => !(i.supersededById && ids.has(i.supersededById)));
  return { kept, dropped: items.length - kept.length };
}

// Saat okuma + alan atfı + çelişki kuralı TEK KAYNAKTA (`time-fields.ts`, 09-23): retrieval,
// istemin KB↔mülk bloğu ve host raporu aynı kuralı kullanır. Eski kopya ölçülmüş yanlış alarm
// üretiyordu (erken/geç giriş-çıkış, "bina girişi", "acil çıkış", "12:00. Çıkış" nokta bölmesi,
// aralık inceltmesi, am/pm). Buradaki adlar geriye uyumluluk için yeniden dışa aktarılır.
export { timesIn, extractFieldTimes, type FieldTimes } from "./time-fields";

export interface TimeConflict {
  /** Saat alanı (`lexicon.timeField`). */
  field: string;
  /** Alandaki farklı değerler (çapa + partnerler), sıralı. */
  values: string[];
  /** Çapa parçası ve çelişen partner parçaları (indeks). */
  anchorIdx: number;
  partnerIdx: number[];
}

/**
 * ÇELİŞKİ KORUMA — ALAN BAZLI (Codex 09-09: kategori bazlı kontrol fazla genişti:
 * aynı kategoride farklı alanların saatleri çelişki sayılıyor, farklı kategorideki
 * aynı çıkış bilgisi karşılaştırılmıyordu).
 *
 * Aynı SAAT ALANINDAKİ saatler karşılaştırılır (`fieldTimes[i]`, alan atfı
 * `extractFieldTimes`); kategori önemsizdir. ÇAPA = alanda saat taşıyan İLK
 * seçilen parça; çapadan FARKLI saat taşıyan aynı alan parçaları (seçilmiş ya da
 * değil) çapanın hemen arkasına TAŞINIR. Bütçe yine de kesebilir — o durumda
 * seçici çelişkiyi AÇIKÇA bildirir (`notes` + `confDropped`), sessizce yutmaz.
 */
export function preserveTimeConflicts(
  chunks: readonly KbChunk[],
  picked: readonly number[],
  fieldTimes: readonly FieldTimes[],
): { order: number[]; conflicts: TimeConflict[] } {
  const anchors = new Map<string, { idx: number; times: ReadonlySet<string> }>();
  for (const idx of picked) {
    for (const [field, times] of fieldTimes[idx]) {
      if (times.size === 0 || anchors.has(field)) continue;
      anchors.set(field, { idx, times });
    }
  }
  if (anchors.size === 0) return { order: [...picked], conflicts: [] };
  const partnersByField = new Map<string, number[]>();
  const valuesByField = new Map<string, Set<string>>();
  for (let i = 0; i < chunks.length; i++) {
    for (const [field, times] of fieldTimes[i]) {
      const a = anchors.get(field);
      if (!a || a.idx === i) continue;
      // Simetrik küme kuralı (`timeSetsConflict`): biri ötekini kapsıyorsa (aralık inceltmesi,
      // "22:00-08:00" ↔ "22:00") çelişki DEĞİL; eski tek yönlü kural çapa sırasına göre farklı
      // hüküm veriyordu.
      if (!timeSetsConflict(a.times, times)) continue;
      partnersByField.set(field, [...(partnersByField.get(field) ?? []), i]);
      const vals = valuesByField.get(field) ?? new Set(a.times);
      for (const t of times) vals.add(t);
      valuesByField.set(field, vals);
    }
  }
  if (partnersByField.size === 0) return { order: [...picked], conflicts: [] };
  const moved = new Set([...partnersByField.values()].flat());
  const order: number[] = [];
  const emitted = new Set<number>();
  const emit = (idx: number): void => {
    if (emitted.has(idx)) return;
    emitted.add(idx);
    order.push(idx);
    // Bu parça bir alanın çapasıysa o alanın partnerleri hemen arkasına gelir
    // (partner başka bir alanın çapasıysa onun partnerleri de zincirlenir).
    for (const [field, a] of anchors) {
      if (a.idx !== idx) continue;
      for (const p of partnersByField.get(field) ?? []) emit(p);
    }
  };
  for (const idx of picked) if (!moved.has(idx)) emit(idx);
  const conflicts: TimeConflict[] = [...partnersByField.entries()].map(([field, partnerIdx]) => ({
    field,
    values: [...(valuesByField.get(field) ?? [])].sort(),
    anchorIdx: anchors.get(field)!.idx,
    partnerIdx,
  }));
  return { order, conflicts };
}
