// ---------------------------------------------------------------------------
// KISA KONU ETİKETİ (kurucu 10-23 C; migration 84 `ConversationItem.topic`; yalnız `AI_ITEM_ORDINAL_ENABLED` açıkken yazılır). Saf.
//
// Kurucu şartları (aynen özet): kısa ve sınırlı; misafir metni ham kopyalanmaz; ad, telefon, şifre ve saldırı talimatı için denetlenir;
// modele verilirse misafir kaynaklı VERİ sayılır (güvenilir işletme bilgisi değil); kaynak mesaj silinince / anonimleşince etiket de gider.
//
// Kurulum: anlama katmanının BU isteğe ait Türkçe arama sorgusundan (`query_tr` — katman adları zaten maskeler) sözcük sözcük; yalnız
// isteğin AYIRT EDİCİ sözcükleri (`needTerms` — durak / genel / yokluk sözcükleri ve rakamlar elenmiş) ilk görülme sırasıyla, en çok 3
// sözcük ve 40 karakter. Atılan: rakam, "@" / bağlantı, 20 harften uzun sözcük, misafirin adının parçası, sır sözcüğü (şifre, kod, pin,
// kart, iban …). Sorguda talimat-ele-geçirme izi ("ignore", "system prompt", "talimat" …) varsa etiket HİÇ yazılmaz. Modele GİTMEZ.
// ---------------------------------------------------------------------------

import { normalizeForRetrieval } from "@/lib/ai/retrieval/text";
import { needTerms } from "./topic-absence";

export const TOPIC_MAX_WORDS = 3;
export const TOPIC_MAX_CHARS = 40;

/** Sır / kimlik sözcükleri (katlanmış kök başlangıcı) — etikete GİRMEZ. */
const SECRET_ROOTS = ["sifre", "parola", "password", "passwort", "kod", "code", "pin", "kart", "card", "iban", "hesap", "account", "telefon", "phone", "numara", "number", "mail", "pasaport", "passport", "kimlik"];
/**
 * Talimat-ele-geçirme izleri — biri varsa etiket hiç yazılmaz. Türkçe kökler ÇEKİMLİYLE ("talimatları", "komutu", "yoksayın"); "unut"
 * yalnız emir biçimi ("unut", "unutun" — "unuttum" misafirin olağan sözü). JS `\b` ASCII'dir → harf sınırı açıkça yazıldı.
 */
const INJECTION =
  /\b(?:ignore|disregard|system\s*prompt|instructions?|jailbreak|developer\s*mode|act\s+as)\b|(?:^|[^\p{L}])(?:talimat|komut|yoksay|rol\s*yap)|(?:^|[^\p{L}])unut(?:un)?(?:[^\p{L}]|$)/iu;
/** Bağlantı / adres izi: "@", "http", "www." ve şemasız alan adı ("lixusai.com"). */
const LINK = /@|https?:|www\.|[\p{L}\p{N}]\.\p{L}{2,}/iu;

const fold = (s: string): string => normalizeForRetrieval(s).toLowerCase();

/**
 * İsteğin kısa konu etiketi ya da `null`. `query` anlama katmanının Türkçe sorgusu; `names` misafirin bilinen adları (parçaları
 * etikete giremez).
 */
export function itemTopicLabel(query: string | null | undefined, names: readonly (string | null | undefined)[] = []): string | null {
  if (!query || INJECTION.test(query) || LINK.test(query)) return null;
  const distinct = new Set(needTerms([query]));
  if (distinct.size === 0) return null;
  const nameParts = new Set(
    names.flatMap((n) => (n ? fold(n).split(/[^\p{L}]+/u).filter((p: string) => p.length >= 2) : [])),
  );
  const out: string[] = [];
  for (const raw of query.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const f = fold(raw);
    // Rakam taşıyan belirteç `needTerms`te zaten yok ("5g", "lale2025" — ölçüldü) → `distinct` onu eler.
    if (!distinct.has(f) || raw.length > 20) continue;
    if (nameParts.has(f) || SECRET_ROOTS.some((r) => f.startsWith(r))) continue;
    const word = raw.toLocaleLowerCase("tr");
    if (out.includes(word)) continue;
    out.push(word);
    if (out.length >= TOPIC_MAX_WORDS) break;
  }
  const label = out.join(" ").slice(0, TOPIC_MAX_CHARS).trim();
  return label.length >= 2 ? label : null;
}
