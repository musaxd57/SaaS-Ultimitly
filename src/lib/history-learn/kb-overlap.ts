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
export const KB_OVERLAP_MAX = 5;
const PREVIEW_MAX = 280;

/**
 * GÜÇLÜ değer belirteçleri (şifre, ağ adı, numara, ücret): `valueTokens` + en az 3 karakter ya da harf + rakam / alt çizgi. Saat parçaları
 * ("12:00" → "12", "00") ve 2 haneli sayılar (kat, daire) ELENİR — Haiku 10-17: "Çıkış saati 12:00" ile "Geç çıkış 12:00'ye kadar ücretli"
 * aynı değer sanılıp ikinci taslak sessizce gizleniyordu; ikinci turda: 4 karakter eşiği "Şifre: 555" gibi kısa şifreyi de düşürüyordu → eşik 3
 * (saatin her parçası en çok 2 hane olduğu için ayrı saat ayıklaması gerekmez).
 */
function foldedValues(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of valueTokens(text)) {
    if (t.length >= 3 || t.includes("_") || (/\p{L}/u.test(t) && /\d/u.test(t))) out.add(foldTurkishAscii(t));
  }
  return out;
}

function preview(text: string): string {
  const t = text.trim();
  return t.length <= PREVIEW_MAX ? t : `${t.slice(0, PREVIEW_MAX - 1)}…`;
}

/** Konu kümesi — yalnız GENİŞ kategoride gerekir (dar kategoride kategori yeter; Haiku 10-17: her kalem için boşuna hesaplanıyordu). */
function topicsFor(category: string, title: string, content: string): ReadonlySet<string> | null {
  return NARROW_CATEGORIES.has(category) ? null : new Set(topicsOf(`${title}\n${content}`));
}

/**
 * Kalemin konu / değer özeti — istek ya da koşu başına BİR kez (Haiku 10-17: 200 taslak × 500 kalemde her çift için yeniden hesaplanıyordu).
 * Eşleştiriciler YALNIZ hazırlanmış kalem alır (ham kalem `topics` taşırsa yanlış dala düşme riski — ikinci tur bulgu 11).
 */
export interface PreparedKbItem extends KbOverlapItem {
  readonly prepared: true;
  topics: ReadonlySet<string> | null;
  values: ReadonlySet<string>;
}
export function prepareKbItems(items: readonly KbOverlapItem[]): PreparedKbItem[] {
  return items.map((i) => ({
    id: i.id,
    category: i.category,
    title: i.title,
    content: i.content,
    updatedAt: i.updatedAt,
    prepared: true as const,
    topics: topicsFor(i.category, i.title, i.content),
    values: foldedValues(`${i.title}\n${i.content}`),
  }));
}

/** Aynı konu mu: aynı kategori VE (dar kategori ya da kavram kesişimi). */
function sameTopic(category: string, draftTopics: ReadonlySet<string> | null, item: { category: string; topics: ReadonlySet<string> | null }): boolean {
  if (item.category !== category) return false;
  if (!draftTopics || !item.topics) return true;
  for (const t of item.topics) if (draftTopics.has(t)) return true;
  return false;
}

/** Taslağın aynı konudaki etkin bilgi tabanı kalemleri (en çok 5; en yeni önce, eşitlikte kimlik). Kalemler çağıranda süzülür (etkin, halefsiz). */
export function kbOverlaps(draft: { category: string; title: string; content: string }, items: readonly PreparedKbItem[]): KbOverlap[] {
  const draftTopics = topicsFor(draft.category, draft.title, draft.content);
  const draftValues = foldedValues(`${draft.title}\n${draft.content}`);
  const out: KbOverlap[] = [];
  for (const item of items) {
    if (!sameTopic(draft.category, draftTopics, item)) continue;
    let kind: KbOverlapKind = "topic";
    if (draftValues.size > 0) {
      const allKnown = [...draftValues].every((v) => item.values.has(v));
      // Kalemde taslakta OLMAYAN bir değer var → değer değişmiş ("Ağ Lale_Ev şifre lale2024" ↔ "Ağ Lale_Ev şifre yeni2025": ağ aynı, şifre
      // farklı — en sık Wi-Fi değişikliği). Kalemde hiç değer yoksa karşılaştırılacak bir şey yok → yalnız konu.
      const itemHasOther = [...item.values].some((v) => !draftValues.has(v));
      kind = allKnown ? "same" : itemHasOther ? "differs" : "topic";
    }
    out.push({ id: item.id, title: item.title, preview: preview(item.content), kind, updatedAt: item.updatedAt });
  }
  return out
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, KB_OVERLAP_MAX);
}

/** Yerine konmuş (emekli) kalem — koşu başına bir kez hazırlanır. */
export interface PreparedRetiredItem {
  category: string;
  topics: ReadonlySet<string> | null;
  values: ReadonlySet<string>;
  supersededAt: Date;
}
export function prepareRetiredItems(items: readonly { category: string; title: string; content: string; supersededAt: Date }[]): PreparedRetiredItem[] {
  return items.map((r) => ({
    category: r.category,
    topics: topicsFor(r.category, r.title, r.content),
    values: foldedValues(`${r.title}\n${r.content}`),
    supersededAt: r.supersededAt,
  }));
}

/**
 * "Model kendini geliştirsin" (L2, kod — LLM'siz): ev sahibinin YERİNE KOYDUĞU eski kalemin değerleriyle aynı olan yeni taslak, kanıtı
 * değişiklikten ÖNCEki bir aydaysa bir daha önerilmez (eski şifre geri gelmesin). Kanıt değişiklik ayında ya da sonrasındaysa (ev sahibi eski
 * değeri yeniden yazmış olabilir) taslak gelir; çağıran `outdated` işareti ekler (Haiku 10-17: ay çözünürlüğünde aynı ay belirsizdir → gizlemek
 * yerine göster). Değersiz taslakta ya da konu farklıysa bu kural İŞLEMEZ (Haiku 10-17: konusuz değer eşitliği başka bilgiyi gizliyordu).
 * Ay anahtarları "YYYY-MM".
 */
export function retiredValueVerdict(
  draft: { category: string; title: string; content: string; newestMonth: string | null },
  retired: readonly PreparedRetiredItem[],
): "suppress" | "outdated" | null {
  const values = foldedValues(`${draft.title}\n${draft.content}`);
  if (values.size === 0) return null;
  const draftTopics = topicsFor(draft.category, draft.title, draft.content);
  let verdict: "suppress" | "outdated" | null = null;
  for (const item of retired) {
    if (!sameTopic(draft.category, draftTopics, item)) continue;
    if (item.values.size === 0 || ![...values].every((v) => item.values.has(v))) continue;
    const changedMonth = item.supersededAt.toISOString().slice(0, 7);
    if (draft.newestMonth !== null && draft.newestMonth >= changedMonth) verdict = verdict ?? "outdated";
    else return "suppress";
  }
  return verdict;
}
