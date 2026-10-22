// ---------------------------------------------------------------------------
// KISA KONU ETİKETİ (kurucu 10-23 C; migration 84 `ConversationItem.topic`; yalnız `AI_ITEM_ORDINAL_ENABLED` açıkken yazılır). Saf.
//
// Kurucu şartları (aynen özet): kısa ve sınırlı; misafir metni ham kopyalanmaz; ad, telefon, şifre ve saldırı talimatı için denetlenir;
// modele verilirse misafir kaynaklı VERİ sayılır (güvenilir işletme bilgisi değil); kaynak mesaj silinince / anonimleşince etiket de gider.
//
// Kurulum: anlama katmanının BU isteğe ait Türkçe arama sorgusundan (`query_tr` — katman adları zaten maskeler) sözcük sözcük; yalnız
// isteğin AYIRT EDİCİ sözcükleri (`needTerms` — durak / genel / yokluk sözcükleri ve rakamlar elenmiş) ilk görülme sırasıyla, en çok 3
// sözcük ve 40 karakter. Atılan: rakam, "@" / bağlantı, 20 harften uzun sözcük, misafirin adının parçası (ve onunla başlayan çekimli
// biçimi: "mehmetin"), unvanın komşusu ("Ahmet bey", "Mr Smith"), sır sözcüğü (şifre, kod, pin, kart, iban …) ve ARDINDAKİ sözcük
// (değerin kendisi olabilir: "şifre kelebek"), sözlükte konusu olmayan Büyük Harfle Başlayan sözcük (özel ad — sorgu küçük harfle
// yazılır; küçük harfle yazılmış, misafirin adı olmayan üçüncü kişi adı bu kuralla yakalanamaz — anlama katmanı ad yazmaz talimatlıdır,
// bilinen sınır). Sorguda talimat-ele-geçirme izi varsa etiket HİÇ yazılmaz. Modele GİTMEZ.
// ---------------------------------------------------------------------------

import { normalizeForRetrieval } from "@/lib/ai/retrieval/text";
import { topicsWithSymptomsOf } from "./relation";
import { needTerms } from "./topic-absence";

export const TOPIC_MAX_WORDS = 3;
export const TOPIC_MAX_CHARS = 40;

/** Sır / kimlik sözcükleri (katlanmış kök başlangıcı) — etikete GİRMEZ; ardındaki sözcük de girmez. */
const SECRET_ROOTS = ["sifre", "parola", "password", "passwort", "kod", "code", "pin", "kart", "card", "iban", "hesap", "hesab", "account", "telefon", "phone", "numara", "number", "mail", "pasaport", "passport", "kimlik"];
/** Unvanlar (katlanmış): ardından ("Mr Smith", "Bay Yılmaz") ya da önünden ("Ahmet bey", "Ayşe hanım") gelen sözcük kişi adıdır. */
// "bay / bayan" bilerek YOK: Türkçede "bayan tuvalet" (kadın tuvaleti) da demektir (Haiku 10-23).
const HONORIFIC_BEFORE = new Set(["mr", "mrs", "ms", "miss", "dr", "sayin", "herr", "frau", "monsieur", "madame"]);
const HONORIFIC_AFTER = new Set(["bey", "beyefendi", "hanim", "hanimefendi", "hoca", "hocam", "abi", "abla"]);
/**
 * Talimat-ele-geçirme izleri — biri varsa etiket hiç yazılmaz. Kesin izler tek başına ("ignore", "yoksay", "rol yap", emir "unut");
 * "talimat / komut / instructions" yalnız BİTİŞİK saldırı bağlamıyla: önünde niteleyici ("önceki / tüm / sistem talimatları", "previous
 * instructions") ya da ardında yürütme emri ("komutu çalıştır", "talimatları uygula"). "Çamaşır makinesi kullanım talimatı", "yeni kullanım
 * talimatı var mı", "uygulama talimatı" misafirin olağan sorusudur (Opus + Haiku 10-23). "unut" yalnız emir biçimi ("unuttum" olağan söz).
 * JS `\b` ASCII'dir → harf sınırı açıkça yazıldı.
 */
const INJECTION_STRONG =
  /\b(?:ignore|disregard|system\s*prompt|jailbreak|developer\s*mode|act\s+as)\b|(?:^|[^\p{L}])(?:yoksay|rol\s*yap|görmezden\s*gel|gormezden\s*gel)|(?:^|[^\p{L}])unut(?:un)?(?:[^\p{L}]|$)/iu;
const INSTRUCTION_ATTACK =
  /\b(?:previous|prior|above|all|system|your|new)\s+instructions?\b|\b(?:follow|run|execute|obey)\s+(?:(?:these|those|the|my|this|following)\s+)?instructions?\b|(?:^|[^\p{L}])(?:önceki|onceki|tüm|tum|bütün|butun|yukarıdaki|yukaridaki|sistem|senin|yeni)\s+(?:talimat|komut)|(?:^|[^\p{L}])(?:talimat|komut)\p{L}{0,8}\s+(?:çalıştır|calistir|uygula|unut|yoksay)(?:ın|in|un|ınız|iniz)?(?:[^\p{L}]|$)/iu;
/** Ad ardından gelen hâl / iyelik eki (katlanmış): "ali" + "nin", "can" + "a", "ece" + "yle". */
const CASE_SUFFIX = /^(?:n?[iu]n|y?[iu]|y?[ae]|n?d[ae]n?|n?t[ae]n?|y?l[ae]|l[ae]r|n?[iu]m|n?[iu]z)$/;
/** Bağlantı / adres izi: "@", "http", "www." ve şemasız alan adı ("lixusai.com"). */
const LINK = /@|https?:|www\.|[\p{L}\p{N}]\.\p{L}{2,}/iu;

const fold = (s: string): string => normalizeForRetrieval(s).toLowerCase();

const hasInjection = (q: string): boolean => INJECTION_STRONG.test(q) || INSTRUCTION_ATTACK.test(q);

/** Baş harfi büyük, gerisi küçük ("Ahmet", "Netflix") — "TV" / "WiFi" gibi kısaltmalar değil. */
const titleCase = (raw: string): boolean => {
  const first = raw.charAt(0);
  const rest = raw.slice(1);
  return first !== first.toLocaleLowerCase("tr") && rest === rest.toLocaleLowerCase("tr") && rest.length > 0;
};

/**
 * İsteğin kısa konu etiketi ya da `null`. `query` anlama katmanının Türkçe sorgusu; `names` misafirin bilinen adları (parçaları ve
 * onlarla başlayan çekimli biçimler etikete giremez).
 */
export function itemTopicLabel(query: string | null | undefined, names: readonly (string | null | undefined)[] = []): string | null {
  if (!query || hasInjection(query) || LINK.test(query)) return null;
  const distinct = new Set(needTerms([query]));
  if (distinct.size === 0) return null;
  const nameParts = [...new Set(names.flatMap((n) => (n ? fold(n).split(/[^\p{L}]+/u).filter((p: string) => p.length >= 2) : [])))];
  // Ad + çekim eki ("mehmetin", "alinin"); 4+ harfli adda her uzantı (kesmesiz yazım), kısa adda yalnız hâl eki — "Ali" "alışveriş"i,
  // "Can" "canlı"yı düşürmez (Haiku 10-23). Kısaltılmış ad ("alex" ← Alexander) da atılır.
  const isName = (f: string) =>
    nameParts.some(
      (p) =>
        p === f ||
        (p.length >= 4 && f.startsWith(p)) ||
        (f.startsWith(p) && CASE_SUFFIX.test(f.slice(p.length))) ||
        (f.length >= 4 && p.startsWith(f)),
    );
  const isSecret = (f: string) => SECRET_ROOTS.some((r) => f.startsWith(r));
  const raws = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const folded = raws.map(fold);
  const out: string[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const f = folded[i];
    // Rakam taşıyan belirteç `needTerms`te zaten yok ("5g", "lale2025" — ölçüldü) → `distinct` onu eler.
    if (!distinct.has(f) || raw.length > 20) continue;
    if (isName(f) || isSecret(f)) continue;
    const prev = folded[i - 1] ?? "";
    const next = folded[i + 1] ?? "";
    // Sır sözcüğünün ardındaki sözcük değerin kendisi olabilir; unvanın komşusu kişi adıdır.
    if ((prev && isSecret(prev)) || HONORIFIC_BEFORE.has(prev) || HONORIFIC_AFTER.has(next)) continue;
    if (HONORIFIC_BEFORE.has(f) || HONORIFIC_AFTER.has(f)) continue;
    // Sorgu küçük harfle yazılır; sözlükte konusu olmayan Büyük Harfli sözcük özel addır ("Ahmet", "Netflix").
    if (titleCase(raw) && topicsWithSymptomsOf(raw).length === 0) continue;
    const word = raw.toLocaleLowerCase("tr");
    if (out.includes(word)) continue;
    out.push(word);
    if (out.length >= TOPIC_MAX_WORDS) break;
  }
  const label = out.join(" ").slice(0, TOPIC_MAX_CHARS).trim();
  return label.length >= 2 ? label : null;
}
