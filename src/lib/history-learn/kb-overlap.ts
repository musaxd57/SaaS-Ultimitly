// ---------------------------------------------------------------------------
// L2 — GEÇMİŞTEN ÖĞREN TASLAĞI × MEVCUT BİLGİ TABANI (kurucu 10-17, AYNEN: "host 1 kez mesela cevapladı ya wifiyi daha güncel olanı doğru
// olarak seçti bu artık doğru olsun öyle model kendini de geliştirsin"). Onay öncesi aynı konudaki etkin kalem LLM'siz bulunur; ev sahibi
// "eskisinin yerine koy / ayrı ekle / vazgeç" der. Saf, veritabanısız, doğrusal (karesel iş yok — yalnız mevcut belirteç / kavram okuyucuları).
//
// "Aynı konu": aynı kategori VE — dar kategorilerde (wifi · parking · trash) kategori yeter; ötekilerde başlık + içerik kavramları kesişmeli
// ("Sigara içilmez" ile "Evcil hayvan kabul edilmez" ikisi de `rules` ama kavramları ayrı → aday DEĞİL).
// Sonuç türü: `differs` (taslağın bir değeri kalemde yok VE kalemin bir değeri taslakta yok — "lale2024 ↔ yeni2025"), `same` (taslağın değerleri
// kalemde zaten var — "bu bilgi zaten kayıtlı"), `topic` (değer yok, yalnız konu örtüşüyor).
// ---------------------------------------------------------------------------

import { topicsOf } from "@/lib/conversation-items/relation";
import { foldTurkishAscii } from "@/lib/ai/fallback";
import { valueTokens } from "./extract";

export type KbOverlapKind = "differs" | "same" | "topic";

export interface KbOverlapItem {
  id: string;
  category: string;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface KbOverlap {
  id: string;
  title: string;
  /** Ev sahibine gösterilen kısa önizleme (≤ 280 karakter). */
  preview: string;
  kind: KbOverlapKind;
  updatedAt: Date;
}

/** Kategori tek başına "aynı konu" sayılan dar kategoriler (bir mülkte genelde tek kalem olur). */
const NARROW_CATEGORIES: ReadonlySet<string> = new Set(["wifi", "parking", "trash"]);
export const KB_OVERLAP_MAX = 3;
const PREVIEW_MAX = 280;

function foldedValues(text: string): Set<string> {
  return new Set(valueTokens(text).map((t) => foldTurkishAscii(t)));
}

function preview(text: string): string {
  const t = text.trim();
  return t.length <= PREVIEW_MAX ? t : `${t.slice(0, PREVIEW_MAX - 1)}…`;
}

/** Taslağın aynı konudaki etkin bilgi tabanı kalemleri (en çok 3; en yeni önce, eşitlikte kimlik). Kalemler çağıranda süzülür (etkin, halefsiz). */
export function kbOverlaps(
  draft: { category: string; title: string; content: string },
  items: readonly KbOverlapItem[],
): KbOverlap[] {
  const narrow = NARROW_CATEGORIES.has(draft.category);
  const draftTopics = narrow ? null : new Set(topicsOf(`${draft.title}\n${draft.content}`));
  const draftValues = foldedValues(`${draft.title}\n${draft.content}`);
  const out: KbOverlap[] = [];
  for (const item of items) {
    if (item.category !== draft.category) continue;
    if (draftTopics) {
      const itemTopics = topicsOf(`${item.title}\n${item.content}`);
      if (!itemTopics.some((t) => draftTopics.has(t))) continue;
    }
    const itemValues = foldedValues(`${item.title}\n${item.content}`);
    let kind: KbOverlapKind = "topic";
    if (draftValues.size > 0) {
      const allKnown = [...draftValues].every((v) => itemValues.has(v));
      // Kalemde taslakta OLMAYAN bir değer var → değer değişmiş ("Ağ Lale_Ev şifre lale2024" ↔ "Ağ Lale_Ev şifre yeni2025": ağ aynı, şifre
      // farklı — en sık Wi-Fi değişikliği). Kalemde hiç değer yoksa karşılaştırılacak bir şey yok → yalnız konu.
      const itemHasOther = [...itemValues].some((v) => !draftValues.has(v));
      kind = allKnown ? "same" : itemHasOther ? "differs" : "topic";
    }
    out.push({ id: item.id, title: item.title, preview: preview(item.content), kind, updatedAt: item.updatedAt });
  }
  return out
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, KB_OVERLAP_MAX);
}

/**
 * "Model kendini geliştirsin" (L2, kod — LLM'siz): ev sahibinin YERİNE KOYDUĞU eski kalemin değerleriyle aynı olan yeni taslak, kanıtı
 * değişiklikten ÖNCEyse bir daha önerilmez (eski şifre geri gelmesin). Kanıt değişiklikten SONRAysa (ev sahibi eski değeri yeniden yazmış —
 * belki geri dönmüş) taslak gelir; çağıran `outdated` işareti ekler. Değersiz (yalnız metin) taslakta bu kural İŞLEMEZ (metin eşitliği
 * güvenilmez → ev sahibi görür). Ay anahtarları "YYYY-MM".
 */
export function retiredValueVerdict(
  draft: { category: string; title: string; content: string; newestMonth: string | null },
  retired: readonly { category: string; title: string; content: string; supersededAt: Date }[],
): "suppress" | "outdated" | null {
  const values = foldedValues(`${draft.title}\n${draft.content}`);
  if (values.size === 0) return null;
  let verdict: "suppress" | "outdated" | null = null;
  for (const item of retired) {
    if (item.category !== draft.category) continue;
    const itemValues = foldedValues(`${item.title}\n${item.content}`);
    if (itemValues.size === 0 || ![...values].every((v) => itemValues.has(v))) continue;
    const changedMonth = item.supersededAt.toISOString().slice(0, 7);
    if (draft.newestMonth !== null && draft.newestMonth > changedMonth) verdict = verdict ?? "outdated";
    else return "suppress";
  }
  return verdict;
}
