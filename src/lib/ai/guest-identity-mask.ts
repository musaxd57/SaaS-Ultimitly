// ---------------------------------------------------------------------------
// MİSAFİR ADI MASKESİ — ANLAMLI SÖZCÜK SİLİNMEZ (kurucu kararı 09-30). Eski kural adın (tam ad + ilk sözcüğü) metindeki HER
// geçişini "[Misafir]" yapıyordu: adı Deniz olan misafirin "Deniz manzarası var mı?" sorusu "[Misafir] manzarası var mı?",
// adı Nisan olanın "15 Nisan'da gelebilir miyiz?" sorusu "15 [Misafir]'da …" oluyordu — anlama katmanı ve bekçi (canlı) tarihi /
// konuyu yitiriyordu. Yeni kural:
//   · Çok sözcüklü TAM ad her yerde maskelenir (tam ad kendisi bir kimliktir; anlamlı sözcük olarak rastlaşması neredeyse yok).
//   · Tek sözcüklük ad (ilk ad / hitap adı) YALNIZ açık kimlik ifadesinde: misafir metninde "adım Deniz", "ismim …", cümle başında
//     "Ben Deniz", "my name is / I'm / this is / call me …", DE/FR/ES/RU/AR karşılıkları ve yalnız addan oluşan imza (son satır
//     "Deniz" / "- Deniz" ya da "Teşekkürler, Deniz"); BİZİM metnimizde yalnız hitap konumu ("Merhaba Deniz,", "Sayın Deniz",
//     "Deniz Hanım").
// 🚨 TAM GİZLİLİK İDDİASI YOKTUR: ad, kimlik ifadesi dışında ad olarak geçerse ("Deniz'in eşi yarın gelecek") modele gider. Kural
// bilinçli olarak anlam kaybı ile gizlilik arasında ANLAM tarafını seçer (kurucu kararı). Ad eşleşmesi `redactNameFromBody` ile
// aynı: Unicode sınırı, büyük-küçük harf duyarsız, Türkçe harf aileleri, esnek boşluk (`nameSource`).
// Doğrusal: her kalıp sabit bir sözcükle ya da satır başıyla çapalı; ad başına birkaç düzenli ifade.
// ---------------------------------------------------------------------------

import { ANON_ID, ANON_NAME } from "@/lib/anon-sentinels";
import { nameSource } from "@/lib/name-source";

export const GUEST_NAME_MASK = "[Misafir]";

export type TextAuthor = "guest" | "ours";

/** Misafirin kendini tanıttığı ifadeler — adın HEMEN önünde (sonrasında ad gelir). */
const GUEST_IDENTITY_LEADS = [
  String.raw`(?:benim\s+)?ad[ıi]m(?:\s*[:\-–]\s*|\s+)`,
  String.raw`(?:benim\s+)?[iİı]smim(?:\s*[:\-–]\s*|\s+)`,
  String.raw`my\s+name\s+is\s+`,
  String.raw`(?:i['’]?m|i\s+am|this\s+is|it['’]?s|call\s+me)\s+`,
  String.raw`(?:ich\s+bin|mein\s+name\s+ist|ich\s+hei(?:ß|ss)e)\s+`,
  String.raw`(?:je\s+m['’]appelle|je\s+suis|c['’]est)\s+`,
  String.raw`(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+`,
  String.raw`(?:меня\s+зовут)\s+`,
  String.raw`(?:اسمي|أنا)\s+`,
  // Form / imza biçimi ve "Hier ist …" (inceleme 09-30: tam kapı "Hi, Alex here." ile yakaladı).
  String.raw`(?:(?:full\s+|guest\s+)?name|ad[ıi]?|isim|ad\s+soyad)\s*[:\-–]\s*`,
  String.raw`hier\s+ist\s+`,
];
/** Adın ARDINDAN gelen tanıtma sözü — cümle / cümlecik başında "Alex here", "Alex hier", "Alex ici". */
const GUEST_IDENTITY_TRAILS = String.raw`(?:here|hier|ici)`;
/**
 * Cümle / cümlecik başında "Ben Deniz" (Türkçe) — metin başı, satır başı ya da . ! ? , ardı ("Merhaba, ben Deniz"). Satır başı yalnız satır
 * İÇİ boşluk yutar: `[.!?,\n]\s*` her "\n"den başlayıp kalan bütün satır sonu dizisini geri izliyordu (Claude kod incelemesi 10-21, ölçüldü:
 * 50.000 satır sonunda 3,5–5,7 sn — kanal mesajında uzunluk tavanı yok).
 */
const SENTENCE_START = String.raw`(?:^|[.!?,]\s*|\n[ \t]*)`;
/** İmza öncesi kapanış sözcükleri ("Teşekkürler, Deniz"). */
const SIGN_OFF = String.raw`(?:teşekkürler|tesekkurler|teşekkür\s+ederim|saygılarımla|saygilarimla|sevgiler|iyi\s+günler|thanks|thank\s+you|best|regards|best\s+regards|kind\s+regards|cheers|danke|merci|gracias|спасибо|شكرا)`;
/** Bizim metnimizde hitap: satır başında selam / saygı sözcüğü + ad. */
const OUR_SALUTATION = String.raw`(?:merhaba|selam|sayın|sayin|sevgili|değerli|degerli|hello|hi|hey|dear|hallo|bonjour|hola|здравствуйте|مرحبا|مرحباً)`;
/** Addan sonra gelen saygı sözcüğü ("Deniz Hanım", "Deniz Bey"). */
const HONORIFIC_AFTER = String.raw`(?:hanım(?:efendi)?|hanim(?:efendi)?|bey(?:efendi)?|hn\.)`;

const NOT_LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`;
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`;

/**
 * Maskelenebilir adlar: sentinel / boş değil; sözcükler en az 2 harf. `full` = çok sözcüklü tam adlar (her yerde), `first` = her adın
 * ilk sözcüğü (kimlik konumunun İLK sözcüğü olabilir), `words` = adların TÜM sözcükleri (kimlik konumunda ilk sözcüğü İZLEYEBİLİR:
 * "ben Zqxwvu Kanaryaoglu" — kanal tam adı soyad önde yazsa da). Uzun olan önce.
 */
function keysOf(names: readonly (string | null | undefined)[]): { full: string[]; first: string[]; words: string[] } {
  const full = new Set<string>();
  const first = new Set<string>();
  const words = new Set<string>();
  for (const raw of names) {
    const n = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    if (!n || n === ANON_NAME || n === ANON_ID) continue;
    const parts = n.split(" ");
    if (parts.length > 1) {
      full.add(n);
      // Tam ad iki DOĞAL sırada da tam addır: kanal adı önde saklıyorsa soyad önde yazılışı ("Mehmet Ali Kaya" → "Kaya Mehmet Ali"),
      // soyad önde saklıyorsa ad önde yazılışı ("Kaya Mehmet Ali" → "Mehmet Ali Kaya"); ad bloğu kendi sırasını korur. Tek başına
      // soyad maskelenmez (anlamlı sözcük olabilir: "kaya", "young"). Tam ters sıra ("Kaya Ali Mehmet") doğal bir yazılış değil —
      // eski satır iki sözcükte ilk dönüşümün aynısıydı, üç sözcükte yanlış sırayı üretiyordu (mutasyon 09-30).
      full.add([parts[parts.length - 1], ...parts.slice(0, -1)].join(" "));
      full.add([...parts.slice(1), parts[0]].join(" "));
    }
    const long = parts.filter((w) => Array.from(w).length >= 2);
    if (long.length > 0 && long[0] === parts[0]) first.add(parts[0]);
    for (const w of long) words.add(w);
  }
  const byLen = (a: string, b: string) => b.length - a.length;
  return { full: [...full].sort(byLen), first: [...first].sort(byLen), words: [...words].sort(byLen) };
}

/**
 * Metindeki misafir adını kimlik konumlarında `[Misafir]` yapar (↑kural). Ad yoksa ya da hiçbir kimlik konumunda geçmiyorsa metin
 * BAYT BAYT aynı döner.
 */
export function maskGuestIdentity(text: string, names: readonly (string | null | undefined)[], author: TextAuthor): string {
  if (!text) return text;
  const { full, first, words } = keysOf(names);
  let out = text;
  for (const f of full) {
    out = out.replace(new RegExp(`${NOT_LETTER_BEFORE}${nameSource(f)}${NOT_LETTER_AFTER}`, "giu"), GUEST_NAME_MASK);
  }
  if (first.length === 0) return out;
  // Önek (1. grup) korunur, ad maskelenir, sonek (varsa 2. grup) korunur. Bitişik iki boşluk yıldızı YOK (ReDoS kuralı).
  const keepPrefix = (src: string) => {
    out = out.replace(new RegExp(src, "giu"), (_m, pre: string) => `${pre}${GUEST_NAME_MASK}`);
  };
  const keepBoth = (src: string) => {
    out = out.replace(new RegExp(src, "giu"), (_m, pre: string, post: string) => `${pre}${GUEST_NAME_MASK}${post}`);
  };
  // Kimlik konumundaki ad: ilk sözcük bir adın ilk sözcüğü, ardından en çok iki ad sözcüğü daha ("Zqxwvu Kanaryaoglu" hangi sırada
  // yazılırsa). Sınırlı tekrar, sözcükler arası yalnız satır içi boşluk — doğrusal.
  const alt = (ws: readonly string[]) => ws.map((w) => `${nameSource(w)}${NOT_LETTER_AFTER}`).join("|");
  const name = `(?:${alt(first)})(?:[ \\t]+(?:${alt(words)})){0,2}`;
  if (author === "guest") {
    for (const lead of GUEST_IDENTITY_LEADS) keepPrefix(`${NOT_LETTER_BEFORE}(${lead})${name}`);
    keepPrefix(`(${SENTENCE_START}ben\\s+)${name}`);
    keepBoth(`(${SENTENCE_START})${name}(\\s+${GUEST_IDENTITY_TRAILS}${NOT_LETTER_AFTER})`);
    // İmza: son satır yalnız ad ("Deniz", "- Deniz") ya da metin sonunda kapanış sözcüğü + ad ("Teşekkürler, Deniz").
    keepBoth(`((?:^|\\n)[ \\t]*(?:[-–—~][ \\t]*)?)${name}([ \\t]*(?:[.!][ \\t]*)?)$`);
    keepBoth(`(${NOT_LETTER_BEFORE}${SIGN_OFF}[,.!]?(?:[ \\t]+|[ \\t]*\\n[ \\t]*)(?:[-–—~][ \\t]*)?)${name}([ \\t]*(?:[.!][ \\t]*)?)$`);
  } else {
    keepPrefix(`((?:^|\\n)[ \\t]*${OUR_SALUTATION}[ \\t]*(?:,[ \\t]*)?)${name}`);
    out = out.replace(
      new RegExp(`${NOT_LETTER_BEFORE}${name}(\\s+${HONORIFIC_AFTER})${NOT_LETTER_AFTER}`, "giu"),
      (_m, post: string) => `${GUEST_NAME_MASK}${post}`,
    );
  }
  return out;
}
