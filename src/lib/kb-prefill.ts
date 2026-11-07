import { KB_CATEGORY } from "@/lib/constants";

// ---------------------------------------------------------------------------
// BİLGİ TABANI ÖN DOLDURMA (B1, kurucu 10-11: "Ev sahibi döngüsü olsun"; tasarım `docs/TASARIM-2026-10-11-acil-numara-ve-yer-onerisi.md` §6).
// Gelen kutusundaki taslakta "Eksik bilgi" satırı çıkınca ev sahibi tek tıkla bilgi tabanı formuna gelir: mülk, kategori (yer sorusuysa
// "Yerel Tavsiye") ve başlık önceden dolu; içeriği ev sahibi yazıp KENDİSİ kaydeder (otomatik kalem YOK). Misafire giden metne dokunmaz.
// Saf modül: adres kurma + adresten gelen değerin doğrulanması (yabancı mülk yok sayılır, otomatik gönderilen mesaj kategorileri
// önerilmez, başlık temizlenip kısaltılır). İstemci bileşeni de kullanır → ağır sınıflandırıcı modülü (`ai/fallback`) içe aktarılmaz.
// ---------------------------------------------------------------------------

export const KB_PREFILL_TITLE_MAX = 120;

/** Otomatik gönderilen mesaj kategorileri (karşılama / giriş / çıkış) — ön doldurmayla ÖNERİLMEZ, ev sahibi formda kendisi seçer. */
const TRIGGER_CATEGORIES = new Set(["welcome", "checkin", "checkout"]);

/** Yer / çevre sorusu sözcükleri (Türkçe ASCII katlanmış + İngilizce). "park" bilinçli YOK (otopark ile karışır). */
const PLACE_WORDS =
  /(?<![a-z])(restoran|restaurant|lokanta|kafe|cafe|kahvalti|breakfast|yemek yer|market|supermarket|grocery|bakkal|eczane|pharmacy|hastane|hospital|plaj|beach|sahil|gezilecek|gorulecek|sightseeing|cevre|civar|yakin|nearby|alisveris|shopping|muze|museum)/;

const TR_ASCII: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u" };
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/[ışğçöü]/g, (c) => TR_ASCII[c] ?? c);

/** "Eksik bilgi" metninden önerilen kategori: yer / çevre sorusu → "Yerel Tavsiye", değilse "Genel" (ev sahibi formda değiştirir). */
export function kbCategoryForMissingInfo(text: string): "local_tips" | "general" {
  return PLACE_WORDS.test(fold(text)) ? "local_tips" : "general";
}

/** Kontrol / görünmez karakterler atılır, boşluklar teke iner, tavana kısaltılır. */
export function cleanPrefillTitle(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\u2800]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KB_PREFILL_TITLE_MAX)
    .trim();
}

/**
 * Gelen kutusu → bilgi tabanı formu adresi: YALNIZ mülk + kategori. Modelin "eksik bilgi" özeti misafir adı ya da alıntısı taşıyabilir
 * (Haiku 2. tur, 10-11) → adrese (tarayıcı geçmişi, sunucu kayıtları) GİRMEZ; başlık `rememberKbPrefillTitle` ile yalnız bu sekmenin
 * oturum belleğinde taşınır ve form açılınca bir kez okunup silinir.
 */
export function kbPrefillHref(propertyId: string, missingInfo: string): string {
  const params = new URLSearchParams({ property: propertyId, category: kbCategoryForMissingInfo(missingInfo) });
  return `/knowledge?${params.toString()}`;
}

const TITLE_KEY = "lixus.kbPrefillTitle";
const TITLE_TTL_MS = 10 * 60_000;

/** Bağlantıya tıklanınca: başlık bu sekmenin oturum belleğine (10 dk; okununca silinir). Depolama yoksa sessizce atlanır. */
export function rememberKbPrefillTitle(propertyId: string, missingInfo: string, now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(TITLE_KEY, JSON.stringify({ propertyId, title: cleanPrefillTitle(missingInfo), at: now }));
  } catch {
    /* özel pencere / engelli depolama: form başlıksız açılır */
  }
}

/** Form açılınca: aynı mülk için 10 dakika içinde bırakılmış başlık (bir kez; okunur okunmaz silinir). */
export function takeKbPrefillTitle(propertyId: string, now: number = Date.now()): string {
  try {
    const raw = window.sessionStorage.getItem(TITLE_KEY);
    window.sessionStorage.removeItem(TITLE_KEY);
    if (!raw) return "";
    const v = JSON.parse(raw) as { propertyId?: unknown; title?: unknown; at?: unknown };
    if (v.propertyId !== propertyId || typeof v.title !== "string" || typeof v.at !== "number") return "";
    if (now - v.at < 0 || now - v.at > TITLE_TTL_MS) return "";
    return cleanPrefillTitle(v.title);
  } catch {
    return "";
  }
}

/** Mülk sayfasındaki "Yerel Tavsiye ekleyin" hatırlatmasının adresi. */
export function localTipsPrefillHref(propertyId: string): string {
  return `/knowledge?${new URLSearchParams({ property: propertyId, category: "local_tips", title: "Yakındaki yerler" }).toString()}`;
}

export interface KbPrefill {
  propertyId: string;
  category: string;
  title: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Adresten gelen ön doldurma — yalnız oturumun kendi mülklerinden biri için (yabancı / bilinmeyen mülk → hiç ön doldurma yok).
 * Kategori bilinen bir bilgi kategorisi değilse ya da otomatik gönderilen mesaj kategorisiyse "Genel".
 */
export function parseKbPrefill(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  ownPropertyIds: readonly string[],
): KbPrefill | null {
  if (!searchParams) return null;
  const propertyId = first(searchParams.property);
  if (typeof propertyId !== "string" || !ownPropertyIds.includes(propertyId)) return null;
  const rawCategory = first(searchParams.category) ?? "";
  const category =
    KB_CATEGORY.options.some((o) => o.value === rawCategory) && !TRIGGER_CATEGORIES.has(rawCategory) ? rawCategory : "general";
  const title = cleanPrefillTitle(first(searchParams.title) ?? "");
  return { propertyId, category, title };
}
