import { isReasoningModel } from "@/lib/ai/model-family";
import { digest } from "./cache";

// ---------------------------------------------------------------------------
// ÖLÇER ÖNBELLEK ANAHTARLARI (Codex 09-27): anahtar, modele GİDEN isteği birebir tanımlamalı — model / düşünme çabası / istem
// değişince ISKA, aynı istek İSABET. İki açık vardı:
//   · cevap (`rag-answer`) anahtarı yalnız `{ v: 1, input }` idi: model (OPENAI_MODEL) ya da istem kurucusu (ör. saat çelişki
//     bloğu) değişse de eski cevap okunuyordu;
//   · yeniden sıralama / anlama anahtarına yalnız AÇIK belirteç (`rre:`) giriyordu; çağrı ise env varsayılanını
//     (`AI_SEMANTIC_REASONING_EFFORT`) da gönderiyordu → env ile koşu varsayılanın çıktısını okuyordu.
// Geriye uyum: çaba yalnız GÖNDERİLDİĞİNDE (ayarlı + reasoning modeli) anahtara girer — bugünkü önbellek (çabasız koşular)
// aynı anahtarla okunur. Cevap önbelleğinin eski (v1) girdileri istem parmak izi TAŞIMAZ; yeni anahtara yalnız eski istemle
// BİREBİR aynı istem üreten girdiler taşınır (`docs/TASARIM-2026-09-26-rag-300-olcek.md` §6d).
// ---------------------------------------------------------------------------

/** Çağrının GÖNDERDİĞİ düşünme çabası (`structured-call.ts`: yalnız ayarlıysa ve reasoning modelinde). */
export function sentEffort(model: string, effort: string | undefined | null): string | undefined {
  return effort && isReasoningModel(model) ? effort : undefined;
}

/** Yeniden sıralayıcı (tek çağrı ve soru başına): model + sistem istemi + kullanıcı istemi + gönderilen çaba. */
export function rerankCacheKey(p: { model: string; system: string; user: string; effort?: string | null }): Record<string, unknown> {
  const e = sentEffort(p.model, p.effort);
  return { m: p.model, s: p.system, u: p.user, ...(e ? { e } : {}) };
}

/** Anlama katmanı: istem sürümü + model + mesaj + geçmiş + kip + gönderilen çaba. */
export function understandCacheKey(p: {
  version: string;
  model: string;
  text: string;
  history: unknown;
  mode: unknown;
  effort?: string | null;
}): Record<string, unknown> {
  const e = sentEffort(p.model, p.effort);
  return { v: p.version, m: p.model, t: p.text, h: p.history ?? null, mode: p.mode, ...(e ? { e } : {}) };
}

/** Cevap modeli (v2): model + gönderilen çaba + sistem ve kullanıcı isteminin özeti (üretimin `replyRequestIdentity`si). */
export function replyCacheKey(id: { model: string; effort: string | null; system: string; user: string }): Record<string, unknown> {
  return { v: 2, m: id.model, ...(id.effort ? { e: id.effort } : {}), s: digest(id.system), u: digest(id.user) };
}
