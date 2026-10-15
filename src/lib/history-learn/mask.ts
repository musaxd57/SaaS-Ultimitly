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

export function namePattern(name: string): RegExp {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const alts: string[] = [];
  const word = (w: string) => [...w].map(charClass).join("");
  if (parts.length > 1 && parts.join(" ").length >= 3) alts.push(parts.map(word).join("\\s+"));
  for (const p of parts) if ([...p].length >= 3) alts.push(word(p));
  if (!alts.length) return /(?!)/u;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})${ENDEARMENT}(?![\\p{L}\\p{N}])`, "gu");
}

export function maskName(text: string, guestName: string | null | undefined): string {
  if (!guestName?.trim()) return text;
  return text.replace(namePattern(guestName), "{isim}");
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/gu;
/** Telefon: + ya da 0 ile başlar, ayraçlı olabilir; 10–13 hane. Saat / tarih / fiyat / 8 haneli şifre bu biçime girmez. */
const PHONE_RE = /(?<![\d\p{L}])(?:\+\d|0)[\d\s().-]{8,20}\d(?![\d\p{L}])/gu;

function maskContacts(text: string): string {
  return text.replace(EMAIL_RE, "[EMAIL]").replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/gu, "").length;
    return digits >= 10 && digits <= 13 ? "[PHONE]" : m;
  });
}

const clip = (s: string) => (s.length > LEARN_SIDE_MAX_CHARS ? `${s.slice(0, LEARN_SIDE_MAX_CHARS)} …` : s);

export function maskForLearning(text: string, guestName: string | null | undefined): string {
  return clip(fenceSafe(maskContacts(redactDoorCodes(maskName(text, guestName)))));
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
  guestNameByConversation: Readonly<Record<string, string | null | undefined>>,
): MaskedPair[] {
  return pairs.map((p, i) => ({
    n: i + 1,
    conversationId: p.conversationId,
    month: p.answeredAt.toISOString().slice(0, 7),
    question: maskForLearning(p.question, guestNameByConversation[p.conversationId]),
    answer: maskForLearning(p.answer, guestNameByConversation[p.conversationId]),
  }));
}
