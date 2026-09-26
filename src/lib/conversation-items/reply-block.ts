// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — CEVAP MODELİNİN BLOĞU (saf; 09-26, kurucu kararları). Yalnız öğe kipinde (bayrak açık + tur öğeye
// bölünebildi) cevap istemine EKLENİR; aksi hâlde istem bayt bayt eski. Kod kurar, model yalnız okur:
//  · CEVAPLANACAK istekler (kısa kimlik R1…Rn + tür + anlama katmanının kısa arama sorgusu);
//  · EV SAHİBİNE BIRAKILAN istekler (tür adı): model onlara CEVAP VERMEZ, DEĞİNMEZ, söz vermez — misafire otomatik
//    "kaydedildi" mesajı da GİTMEZ (kurucu kararı 09-26);
//  · beyan: `answeredRequests` = cevapladığı isteklerin kimlikleri. Eksik / bozuk / bırakılan ya da bilinmeyen kimlik →
//    kapı TUTAR (beyan yalnız sıkılaştırır; karar kodda).
// ---------------------------------------------------------------------------

import { ITEM_KIND_LABELS_TR, type ItemKind } from "./core";

export interface ReplyItemsInput {
  /** Cevaplanabilir istekler. `hint` anlama katmanının kısa Türkçe arama sorgusu (PII'siz; yoksa tür adı). */
  answerable: readonly { ref: string; kind: ItemKind; hint: string }[];
  /** Ev sahibine bırakılan istekler (bu tur + önceki turlar). */
  held: readonly { kind: ItemKind }[];
}

export type AnsweredRequestsDeclaration =
  | { ok: true; refs: string[] }
  | { ok: false; reason: "missing" | "unknown_ref" };

const HINT_MAX = 80;

function cleanHint(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}"<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, HINT_MAX);
}

/** Cevap istemine eklenen blok. Bırakılan tür adları tekilleşir (aynı tür iki mesajda olsa da bir satır). */
export function buildItemsPromptBlock(items: ReplyItemsInput): string {
  const answerable = items.answerable.map((a) => `  - ${a.ref} · ${ITEM_KIND_LABELS_TR[a.kind]}${a.hint ? ` · "${cleanHint(a.hint)}"` : ""}`);
  const held = [...new Set(items.held.map((h) => ITEM_KIND_LABELS_TR[h.kind]))].map((l) => `  - ${l}`);
  return `
KONUŞMA ÖĞELERİ (kod — misafirin cevapsız mesajlarındaki istekler):
CEVAPLANACAK istekler:
${answerable.length > 0 ? answerable.join("\n") : "  (yok)"}
EV SAHİBİNE BIRAKILAN istekler — bunlara CEVAP VERME, DEĞİNME, söz verme; "iletildi / kaydedildi / ev sahibiniz bakacak" da YAZMA:
${held.length > 0 ? held.join("\n") : "  (yok)"}
KURALLAR: reply YALNIZ cevaplanacak istekleri cevaplar; bırakılan bir isteği (ödeme yöntemi, şikâyet, iade, ev sahibiyle
görüşme vb.) onaylama, reddetme, özür dileme, ödeme yöntemi / hesap bilgisi yazma. intent, riskLevel ve riskType'ı her
zamanki gibi TÜM cevapsız mesajlara göre ver (bırakılanlar dahil — ayrımı kod yapar). JSON'a "answeredRequests" alanını
da EKLE (zorunlu): cevapladığın isteklerin kimlikleri, ör. ["R1"]; hiçbirini cevaplamadıysan [].`;
}

/**
 * STRICT çözüm: dizi olmalı, her eleman cevaplanabilir kimliklerden biri. Alan yok / dizi değil → `missing`; bilinmeyen
 * ya da bırakılan kimlik → `unknown_ref`. Tekrar eden kimlik tekilleşir.
 */
export function parseAnsweredRequests(raw: unknown, answerableRefs: readonly string[]): AnsweredRequestsDeclaration {
  if (!Array.isArray(raw)) return { ok: false, reason: "missing" };
  const refs: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string" || !answerableRefs.includes(r)) return { ok: false, reason: "unknown_ref" };
    if (!refs.includes(r)) refs.push(r);
  }
  return { ok: true, refs };
}
