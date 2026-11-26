import { quoteSpanIn } from "./host-commitment-verdict";

// ---------------------------------------------------------------------------
// "BU CEVAP HANGİ İSTEĞE?" — MODELİN OKUMASININ HIZLI KOD DOĞRULAMASI (kurucu 11-18 akşam, H-1: "'yazdım' ile 'çözdüm' ayrılsın … 'Havlu
// getiriyoruz' havlu ihtiyacını cevaplandı yapar; klima arızasına hiç dokunmaz"; tasarım `docs/TASARIM-2026-11-18-yazdim-cozdum-ayrimi.md`).
//
// Bugün ev sahibi bir şey yazınca konuşmanın BÜTÜN açık istekleri "Yanıtladınız" görünür. Hangi isteğe değindiği sözcük eşleşmesiyle
// çıkarılmaz (kurucu: "kelime bazlı değil") — model okur (`reply-items-reader.ts`), bu dosya yalnız DOĞRULAR. Saf: model yok, veritabanı yok.
//
// Doğrulama yalnız TUTAR: bir isteği "karşılandı" sayan iddia kanıt ister; kanıtsız iddia "değinmiyor"a iner. Hiçbir zaman tersini yapmaz.
//  · kimlik verilen listeden olmalı (uydurma kimlik atılır, sayılır);
//  · "değinmiyor" dışındaki her ilişki için alıntı mesajda GERÇEKTEN geçmeli (geçmiyorsa ilişki "değinmiyor"a iner, sayılır);
//  · modelin hiç söz etmediği istek "değinmiyor" sayılır (eksik işaretiyle).
// ---------------------------------------------------------------------------

/** Cevabın bir istekle ilişkisi (kapalı küme). */
export const REPLY_ITEM_RELATIONS = [
  /** Bilgiyi veriyor / isteği şimdi karşılıyor. */
  "answers",
  /** O istek için somut bir iş üstleniyor (getireceğiz, teknisyen gelecek). */
  "undertakes",
  /** İsteği görüyor ama erteliyor / kontrol edecek / geri soru soruyor. */
  "defers",
  /** Mesaj o istekle hiç ilgilenmiyor. */
  "not_addressed",
] as const;
export type ReplyItemRelation = (typeof REPLY_ITEM_RELATIONS)[number];

/** Modele verilen açık istek: kısa kimlik + tür (misafir metni ve konu etiketi GİTMEZ). */
export interface ReplyItemRef {
  ref: string;
  kind: string;
}

/** Modelin bir istek için söylediği. */
export interface ReplyItemStatement {
  ref: string;
  relation: ReplyItemRelation;
  quote: string;
  why: string;
}

export interface VerifiedReplyItem {
  ref: string;
  kind: string;
  /** Doğrulamadan SONRAKİ ilişki. */
  relation: ReplyItemRelation;
  /** Modelin söylediği ilişki (doğrulama öncesi); model bu istekten söz etmediyse `null`. */
  raw: ReplyItemRelation | null;
  /** Alıntının modelin gördüğü metindeki konumu; yoksa `null`. */
  span: [number, number] | null;
  why: string;
}

/** Mesajın açık isteklerin ne kadarına değindiği — bugünkü kuralla ("hepsi yanıtlandı") kıyasın sözlüğü. */
export type ReplyCoverage = "all" | "some" | "none";

export interface ReplyItemsVerdict {
  items: VerifiedReplyItem[];
  coverage: ReplyCoverage;
  /** Listede olmayan kimlikle gelen ifade sayısı (okuma kalitesi). */
  invented: number;
  /** Alıntısı metinde bulunmadığı için "değinmiyor"a inen iddia sayısı. */
  ungrounded: number;
}

const addressed = (r: ReplyItemRelation): boolean => r !== "not_addressed";

/**
 * Okumayı doğrula. `seenText` = modele GİDEN metin (alıntı ona göre aranır); `given` = modele verilen açık istekler, sırasıyla.
 * Aynı kimlik iki kez geldiyse İLKİ geçerlidir.
 */
export function verifyReplyItemsReading(seenText: string, given: readonly ReplyItemRef[], statements: readonly ReplyItemStatement[]): ReplyItemsVerdict {
  const known = new Set(given.map((g) => g.ref));
  const byRef = new Map<string, ReplyItemStatement>();
  let invented = 0;
  for (const s of statements) {
    if (!known.has(s.ref)) {
      invented++;
      continue;
    }
    if (!byRef.has(s.ref)) byRef.set(s.ref, s);
  }
  let ungrounded = 0;
  const items = given.map((g): VerifiedReplyItem => {
    const s = byRef.get(g.ref);
    if (!s) return { ref: g.ref, kind: g.kind, relation: "not_addressed", raw: null, span: null, why: "" };
    if (!addressed(s.relation)) return { ref: g.ref, kind: g.kind, relation: "not_addressed", raw: s.relation, span: null, why: s.why };
    const span = quoteSpanIn(seenText, s.quote);
    if (!span) {
      ungrounded++;
      return { ref: g.ref, kind: g.kind, relation: "not_addressed", raw: s.relation, span: null, why: s.why };
    }
    return { ref: g.ref, kind: g.kind, relation: s.relation, raw: s.relation, span, why: s.why };
  });
  const hit = items.filter((i) => addressed(i.relation)).length;
  const coverage: ReplyCoverage = items.length > 0 && hit === items.length ? "all" : hit === 0 ? "none" : "some";
  return { items, coverage, invented, ungrounded };
}

/**
 * Bugünkü kuralın aynı sözlükteki kararı: ev sahibi bir şey yazdıysa konuşmanın bütün açık istekleri "Yanıtladınız" olur (kurucu 09-26
 * kuralı) → her zaman "all". Fonksiyon olarak durur ki kıyasın iki yanı aynı yerden okunsun.
 */
export function coverageOfConversationRule(): ReplyCoverage {
  return "all";
}

/** Kıyas: model bugünkü kuraldan daha AZ istek karşılandı diyorsa `model_holds` (açık kalması gereken iş var), aynıysa `agree`. */
export function compareReplyCoverage(model: ReplyCoverage): "agree" | "model_holds" {
  return model === coverageOfConversationRule() ? "agree" : "model_holds";
}
