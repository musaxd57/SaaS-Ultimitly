import "server-only";

import { redactDoorCodes } from "@/lib/guest-chat";
import { fenceSafe } from "@/lib/ai/semantic/fence";
import type { LearnPair } from "./pairs";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — MODELE GİDEN ÇİFTİN MASKESİ (tasarım §2.2: "misafir adı / telefon / e-posta / kapı kodu modele gitmeden").
//
// 🚨 GENEL REDAKSİYON (`redactSensitive` / `redactForSemanticModel`) BURADA KULLANILMAZ (Opus incelemesi 10-15, ölçüldü): günlük
// redaksiyonu "name: … / password: …" alanını satır sonuna kadar `[REDACTED]`, 6+ haneyi `[NUM]` yapıyor → "WiFi name: Lale_5G
// password: sunny2024" ve "Wi-Fi şifresi 12345678" modele bilgisiz gidiyordu; bu özelliğin İŞİ tam olarak o bilgiyi öğrenmek.
// Bunun yerine HEDEFLİ maske, sıra bilinçli:
//  ① misafir adı → `{isim}` — Türkçe harf aileleri BİR sınıf (i/İ/ı/I, ş/s, ç/c, ğ/g, ö/o, ü/u: "İlker" ↔ "ilker" ↔ "Ilker"); tam ad
//     + ≥3 harfli her parça; yalnız kesme ile ek ("Ayşe'ye") ve sevgi eki ("Ayşeciğim") tanınır — "Deniz" adı "denize" sözcüğünü
//     silmesin diye çıplak ek tanınmaz (kalan risk ↓taslak kapısında ad taraması ile işaretlenir).
//  ② kapı / kutu / giriş kodu DEĞERİ → "(kod gizlendi)" (`redactDoorCodes`, kurucu 10-11). Wi-Fi şifresi GİZLENMEZ.
//  ③ e-posta → `[EMAIL]`; telefon (+ ya da 0 ile başlayan, 10–13 hane) → `[PHONE]`. Tarih / saat / fiyat / 8 haneli şifre dokunulmaz.
//  ④ veri ayracı taklidi silinir (`fenceSafe`) — misafir metni VERİDİR (K10-s).
//  ⑤ EN SON kırpma (maske önce: kırpılan telefon / ad yarısı maskeden kaçmasın).
// ---------------------------------------------------------------------------

/** Çiftte tek tarafın modele giden üst sınırı (karakter). */
export const LEARN_SIDE_MAX_CHARS = 1_500;

const FAMILIES = ["iİıI", "şŞsS", "çÇcC", "ğĞgG", "öÖoO", "üÜuU"];
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\-]/gu, "\\$&");

/** Bir harf için Türkçe aile + büyük/küçük sınıfı. */
function charClass(c: string): string {
  const fam = FAMILIES.find((f) => f.includes(c));
  if (fam) return `[${fam}]`;
  const lo = c.toLocaleLowerCase("tr");
  const up = c.toLocaleUpperCase("tr");
  const set = new Set([c, lo, up, c.toLowerCase(), c.toUpperCase()]);
  return set.size === 1 ? esc(c) : `[${[...set].map(esc).join("")}]`;
}

/** Sevgi / hitap ekleri (bitişik): Ayşeciğim, Mehmetcim. Çıplak çekim eki bilerek YOK (↑①). */
const ENDEARMENT = "(?:c[iıuü]ğ[iıuü]m|ç[iıuü]ğ[iıuü]m|c[iıuü]m|ç[iıuü]m)?";

/** Derlenmiş ad kalıbı önbelleği (Opus 10-15: kapı her çağrıda yeniden derliyordu — 1000 ad × 300 taslak ≈ 26 sn CPU). */
const NAME_RE_CACHE = new Map<string, RegExp>();
const NAME_RE_CACHE_MAX = 5_000;

/**
 * Adın derlenmiş kalıbı (GLOBAL bayraklı) — yalnız `replace` / `search` ile kullanılır (ikisi de `lastIndex`'i yok sayar / sıfırlar;
 * `test` / `exec` DURUMLUDUR, kullanılmaz).
 */
export function namePattern(name: string): RegExp {
  const hit = NAME_RE_CACHE.get(name);
  if (hit) return hit;
  const re = buildNamePattern(name);
  if (NAME_RE_CACHE.size >= NAME_RE_CACHE_MAX) NAME_RE_CACHE.clear();
  NAME_RE_CACHE.set(name, re);
  return re;
}

function buildNamePattern(name: string): RegExp {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const alts: string[] = [];
  const word = (w: string) => [...w].map(charClass).join("");
  if (parts.length > 1 && parts.join(" ").length >= 3) alts.push(parts.map(word).join("\\s+"));
  for (const p of parts) if ([...p].length >= 3) alts.push(word(p));
  if (!alts.length) return /(?!)/u;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})${ENDEARMENT}(?![\\p{L}\\p{N}])`, "gu");
}

/** Bir ya da birden çok ad (rezervasyon adı + görünen misafir kimliği + gönderen adı — Opus 10-15 B2). */
export type GuestNames = string | readonly string[] | null | undefined;

export function maskName(text: string, guestNames: GuestNames): string {
  const list = (typeof guestNames === "string" ? [guestNames] : (guestNames ?? [])).filter((n) => n?.trim());
  // Uzun ad önce ("Ayşe Yılmaz" tam ad, sonra "Ayşe") — kısa ad uzunun parçasını yarım bırakmasın.
  return [...list].sort((a, b) => b.length - a.length).reduce((t, n) => t.replace(namePattern(n), "{isim}"), text);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/gu;
/** Telefon: + ya da 0 ile başlar, ayraçlı olabilir; 10–13 hane. Saat / tarih / fiyat / 8 haneli şifre bu biçime girmez. */
const PHONE_RE = /(?<![\d\p{L}])(?:\+\d|0)[\d\s().-]{8,20}\d(?![\d\p{L}])/gu;
/**
 * Başında 0 / + OLMAYAN Türkiye cep telefonu (Opus 10-15 B1: "numaram 532 123 45 67", "90 532 123 45 67" açıkta gidiyordu):
 * isteğe bağlı 90 + 5xx + 7 hane, ayraçlı. 10 haneli ve 5 ile başlayan sayısal Wi-Fi şifresi de maskelenir — taslak `needs_edit`
 * işaretiyle ev sahibine gider (fazla maske güvenli yön).
 */
const TR_MOBILE_RE = /(?<![\d\p{L}])(?:90[\s.-]?)?(?:5\d{2}|\(5\d{2}\))[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?![\d\p{L}])/gu;

function maskContacts(text: string): string {
  return text
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, (m) => {
      const digits = m.replace(/\D/gu, "").length;
      return digits >= 10 && digits <= 13 ? "[PHONE]" : m;
    })
    .replace(TR_MOBILE_RE, "[PHONE]");
}

const clip = (s: string) => (s.length > LEARN_SIDE_MAX_CHARS ? `${s.slice(0, LEARN_SIDE_MAX_CHARS)} …` : s);

export function maskForLearning(text: string, guestNames: GuestNames): string {
  return clip(fenceSafe(maskContacts(redactDoorCodes(maskName(text, guestNames)))));
}

export interface MaskedPair {
  /** Çift numarası (1'den; yeni → eski) — modelin kanıt göstermesi bu numarayla. */
  n: number;
  conversationId: string;
  /** Cevap ayı (YYYY-MM) — "en yeni bilgi" kararı için; gün / saat taşınmaz. */
  month: string;
  question: string;
  answer: string;
}

export function maskPairs(
  pairs: readonly LearnPair[],
  guestNameByConversation: Readonly<Record<string, GuestNames>>,
): MaskedPair[] {
  return pairs.map((p, i) => ({
    n: i + 1,
    conversationId: p.conversationId,
    month: p.answeredAt.toISOString().slice(0, 7),
    question: maskForLearning(p.question, guestNameByConversation[p.conversationId]),
    answer: maskForLearning(p.answer, guestNameByConversation[p.conversationId]),
  }));
}
