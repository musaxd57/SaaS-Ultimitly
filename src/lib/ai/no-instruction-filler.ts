// ---------------------------------------------------------------------------
// "TALİMAT YOK" YAN CÜMLESİ MİSAFİRE YAZILMAZ (kurucu 10-17, H9 cevabı, aynen):
//   "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. Bunun ilk cümlesini yazmasına gerek yok, zaten yeterli … 'Çıkış
//    için özel talimatımız yok' bunu yazmasın." · "Televizyonla ilgili ayrı bir talimatım bulunmuyor — böyle bir şey yazamaz kesinlikle."
//
// Kural (saf; `suggestReply` cevabın SON adımında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo hepsi aynı):
//   · Cümle "talimat yok" yan cümlesi taşıyorsa (`matchesNoInstructionClause`, yedi dil) ve AYNI cümlede yönerge varsa ("…, anahtarı masaya
//     bırakmanız yeterli") yalnız o yan cümle silinir: "Anahtarı masaya bırakmanız yeterli."
//   · Cümlenin TAMAMI "talimat yok" ise ve cevabın geri kalanı yönerge taşıyorsa ("Çıkış için özel talimatımız yok. Anahtarı masaya
//     bırakmanız yeterli.") o cümle düşer (Opus 10-17 B3: noktalı hâli bütün cevabı tutuyordu).
//   · "Talimat yok" ifadesi, ardından gelen adımın bilgi tabanından GELMEDİĞİNİN kanıtıdır (Opus 10-17 B1: "Özel bir talimatımız yok, kombiyi
//     sıfırlamak için reset tuşuna basın" silinince uydurma cihaz adımı kanıtsız gidiyordu). Bu yüzden silme İZİN LİSTESİYLE yapılır:
//       – silinen kısım bir CİHAZDAN söz etmez ve göndergesel değildir ("bu konuda", "for that" — konu gizli; B1);
//       – kalan metin anahtar DIŞINDA cihazdan söz etmez (yönerge bir cihaz adımıysa kanıtı silinmez);
//       – kalan metnin KENDİ bilinen konusu vardır (çıkış, giriş, çöp, otopark… — bilinmeyen konu = silme yok; B2: "Jakuzi için özel
//         talimatımız yok, keyfini çıkarın" tutulur). Yalnız selam / nezaket kalırsa da konu yoktur → tutulur (B5: "Merhaba Ayşe Hanım,
//         çıkış için özel talimatımız yok." → "Merhaba Ayşe Hanım." olmaz; gece-4 S4-05: "…, keyifli bir konaklama dileriz" / "…, enjoy the
//         rest of your stay" de tutulur — kapalı nezaket listesi her selamı tanımıyordu);
//       – silinen kısmın konusu varsa kalan yönerge AYNI konudadır (giriş / çıkış ↔ anahtar / kapı eşleşir — kurucunun örneği). Gece-4 S4-09
//         (P1): "Yakında bir market var. Sigara için özel talimatımız yok." başka konudaki cevap yüzünden sigara sorusunu SESSİZCE siliyordu
//         (soru "cevaplanmış" görünür, ev sahibi hiç görmezdi) — artık tutulur, ev sahibi yanıtlar;
//       – kalan metin yine "bilgim yok" demez.
//     Şartlardan biri tutmazsa metne dokunulmaz → "bilgim yok" kuralı bütün cevabı tutar (misafire gitmez, ev sahibi yanıtlar).
// Misafire yeni söz EKLENMEZ; yalnız yan cümle / cümle ÇIKARILIR. Kalan metin bütün kapılardan yine geçer.
// Haiku 10-17 sınırları (pinli): yan cümle sınırı ayraç + BOŞLUK ("15:00", "1,5 TL" bölünmez); silinen yan cümle YALNIZ "talimat yok" + kısa
// konu olmalı ("…yok ve kahvaltı 08.00-10.00 arasıdır" silinmez — bilgi kaybı); madde işareti ("- ") korunur; "yok ve …" / "yok ama …" de
// yan cümle sınırıdır. Bütün taramalar doğrusal (cevap 4.000 karakterle sınırlı; süre pini `absence-cost.test.ts`).
// ---------------------------------------------------------------------------

import { admitsMissingKnowledge, matchesNoInstructionClause, noInstructionClauseResidue, noInstructionClauseRest } from "./absence";
import { deviceTopicsOf, topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

/** Cümle parçaları (ayraçlarıyla; birleştirince satırın kendisi). Sınır = nokta / ünlem / soru + boşluk ("15.00" bölünmez). Doğrusal. */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])(?=\s)/u).filter((s) => s.length > 0);
}

/**
 * Yan cümleler (ayraç sonda kalır): ardından BOŞLUK gelen virgül / noktalı virgül / iki nokta / Arapça virgül ("15:00", "1,5" bölünmez), ve
 * Türkçe "talimat yok" yükleminden sonra gelen "ve / ama / fakat / ancak" (bağlaç kalan yan cümlenin başında kalır, ↓atılır).
 * Mutasyon notu (10-17): "boşluk şartı" kaldırılınca hiçbir test kırmızıya dönmüyor — EŞDEĞER: sayı içinde bölünen parça ("15:" + "00")
 * yeniden birleşir ve sayı taşıyan kalan zaten silinemez (`topicOnly`). Şart, "15:00" / "1,5" içinde bölmeyi kaynağında önlemek için durur.
 */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(
      /(?<=[,;:،])(?=\s)|(?<=(?<![\p{L}])(?:yok|yoktur|bulunmuyor|bulunmamaktadır|gerekmiyor))(?=\s+(?:ve|ama|fakat|ancak)\s)/u,
    )
    .filter((c) => c.length > 0);
}

/** Silinen yan cümlenin "talimat yok" dışında kalanı yalnız KONU mu ("çıkış için", "for checkout")? Sayı, bağlaç, uzun kalan → bilgi var. */
const REST_CONJUNCTIONS: ReadonlySet<string> = new Set([
  "ve", "veya", "ile", "ama", "fakat", "ancak", "ayrıca", "and", "or", "but", "also", "y", "o", "pero", "et", "ou", "mais", "und", "oder",
  "aber", "и", "или", "но",
]);
const MAX_TOPIC_WORDS = 6;
function topicOnly(rest: string): boolean {
  if (/\p{N}/u.test(rest)) return false;
  const words = rest.split(/[^\p{L}'-]+/u).filter((w) => /\p{L}/u.test(w));
  return words.length <= MAX_TOPIC_WORDS && !words.some((w) => REST_CONJUNCTIONS.has(w));
}

/** Silinebilir yan cümle: "talimat yok" kalıbı + geriye yalnız konu. */
function removableClause(clause: string): boolean {
  const rest = noInstructionClauseRest(clause);
  return rest !== null && topicOnly(rest);
}

/** Sondaki boşluk / ayraçlar (doğrusal; düzenli ifadedeki `[…]+$` uzun dizide karesel geri izleme yapar — Haiku 10-17). */
function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s,;:،]/u.test(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/** Sondaki cümle sonu noktalaması (doğrusal; `/[.!?]+$/` uzun ünlem dizisinde karesel — Opus 10-17 B7). Yoksa "". */
function trailingTerminal(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/u.test(text[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && /[.!?]/u.test(text[start - 1]!)) start -= 1;
  return text.slice(start, end);
}

/**
 * Asılı konu öbeği: yüklemsiz kısa yan cümle, konu edatıyla biter ("Kombi için", "Televizyonla ilgili") ya da başlar ("for the TV", "para la
 * tele"). Kapalı küme; en çok 4 sözcük.
 */
const DANGLING_TAIL = /(?<![\p{L}])(?:için|icin|ilgili|hakkında|konusunda|dair)$/iu;
const DANGLING_HEAD = /^(?:for|about|regarding|para|sobre|pour|concernant|für|zu|по|для|عن|بخصوص)(?![\p{L}])/iu;
function danglingTopic(clause: string): boolean {
  const core = trimTrailingSeparators(clause.trim());
  const bare = core.slice(0, core.length - trailingTerminal(core).length);
  if (bare.split(/\s+/u).filter(Boolean).length > 4) return false;
  return DANGLING_TAIL.test(bare) || DANGLING_HEAD.test(bare);
}

/**
 * Göndergesel konu ("bu konuda", "bununla ilgili", "for that", "à ce sujet"…): konu metinde YOK, önceki cümleye / misafirin sorusuna işaret
 * eder → hangi cihaz olduğu bilinemez, silinmez (Opus 10-17 B1: "Bu konuda özel bir talimatımız yok, sigortayı kapatıp açabilirsiniz").
 */
const REFERENTIAL =
  /(?<![\p{L}])(?:bu|şu|o) (?:konuda|konuyla|konu hakkında)|(?<![\p{L}])bununla|(?<![\p{L}])bunun için|(?<![\p{L}])(?:for|on|about|regarding) (?:that|this|it)(?![\p{L}])|(?<![\p{L}])(?:à ce sujet|pour cela|dazu|hierzu|dafür|al respecto|para eso|para esto|по этому поводу|для этого|بهذا الشأن|لذلك)(?![\p{L}])/iu;

/** Kalan metinde izin verilen tek "cihaz" konusu: anahtar (çıkış / giriş yönergesinin doğal parçası — "anahtarı masaya bırakın"). */
const ALLOWED_DEVICE_IN_REST: ReadonlySet<string> = new Set(["keys"]);

function topicsOf(text: string): { all: string[]; devices: string[] } {
  const all = topicsWithSymptomsOf(text);
  return { all, devices: deviceTopicsOf(all) };
}

/**
 * Kapı yönergesi ("kapıyı çekin", "kapı açık", "close the door") — konu okuyucusunda konu değil; yalnız giriş / çıkış "talimat yok"unun
 * eşi olarak sayılır. Dar küme (Haiku 10-17 gece-4 F2): yalnız kapının kendisi + hâl ekleri — "kapıcı", "kapı zili / kodu", "bahçe kapısı",
 * Fransızca "porter" kapı DEĞİL. Almanca / İspanyolca / Fransızca tanımlıkla ("die Tür", "la puerta", "la porte" — Türkçe "tür" karışmasın).
 */
const DOOR_WORD =
  /(?<![\p{L}])(?:kap[ıi](?:y[ıi]|y[ae]|d[ae]|d[ae]n|n[ıi]n)?(?!\s+(?:zil|kod|şifre|sifre|numara|kart|kilid|kilit))|doors?(?!\s+(?:code|codes|bell|lock|keypad))|(?:la|las)\s+puertas?|(?:la|les)\s+portes?|(?:die|der)\s+tür(?:e|en)?|двер(?:ь|и|ью)|الباب)(?![\p{L}])/iu;
/** Silinen "talimat yok" konusu → kalan metinde onu karşılayan konular (kendisi + eşleri). */
const PAIRED_TOPICS: Readonly<Record<string, readonly string[]>> = { checkin: ["keys", "door"], checkout: ["keys", "door"] };
/**
 * Giriş / çıkış konusu kalan metinde AÇIKÇA anılmalı (Haiku 10-17 gece-4 F3): konu okuyucusu "çık-" / "gir-" köklerini de giriş / çıkış
 * sayar → "Balkona çıkabilirsiniz" çıkış sorusunu "cevaplamış" görünüyordu.
 */
const LIFECYCLE_TOPICS: ReadonlySet<string> = new Set(["checkin", "checkout"]);
const LIFECYCLE_MARK =
  /(?<![\p{L}])(?:çıkış\p{L}{0,8}|cikis\p{L}{0,8}|giriş\p{L}{0,8}|giris\p{L}{0,8}|check[- ]?(?:in|out)\p{L}{0,3}|ayrılış\p{L}{0,6}|varış\p{L}{0,6}|departure|arrival|salida|llegada|abreise|anreise|départ|arrivée|выезд\p{L}{0,2}|заезд\p{L}{0,2}|المغادرة|الوصول)(?![\p{L}])/iu;
/**
 * Konusu adlandırılmış "talimat yok"ta ("Jakuzi için özel talimatımız yok") konu tanınmıyorsa silinmez (Haiku 10-17 gece-4 F1: "…, anahtarı
 * masaya bırakın" jakuzi sorusunu sessizce "cevaplanmış" yapıyordu). Konusuz genel biçim ("Özel bir talimatımız yok", "There are no other
 * instructions in my notes") silinebilir kalır — kalan sözcükler yalnız bu kapalı kümedense konu adlandırılmamıştır (ASCII katlanmış).
 */
// Opus gece-4 F11: durak sözcükleri "talimat yok" kalıbının DİLİNE göre — tek küme "şu"yu "su" (su), İspanyolca "para"yı (para), İngilizce "is"i
// (iş) Türkçe konu sözcüklerinde de durak sayıyordu ("Su için özel bir talimatımız yok, …" su sorusu sessizce düşüyordu).
const TR_STOPWORDS: ReadonlySet<string> = new Set([
  "ozel", "ek", "baska", "farkli", "ilave", "ekstra", "ayri", "belirli", "belli", "spesifik", "icin", "ilgili", "hakkinda", "konusunda",
  "dair", "de", "da", "ise", "an", "simdilik", "herhangi", "bir", "maalesef", "elimizde", "elimde", "notlarimda", "notlarimizda", "kayitlarimda",
  "kayitlarimizda", "burada",
]);
/** Türkçe durak sözcüğü katlamadan ÖNCE ("şu an" ≠ "su"). */
const TR_RAW_STOPWORDS: ReadonlySet<string> = new Set(["şu"]);
const FOREIGN_STOPWORDS: ReadonlySet<string> = new Set([
  // en
  "there", "are", "is", "no", "not", "any", "other", "in", "my", "our", "notes", "records", "for", "the", "your", "about", "regarding", "we",
  "i", "don", "t", "have", "really", "at", "this", "time", "currently", "unfortunately",
  // es
  "hay", "para", "el", "la", "los", "las", "del", "tenemos", "ninguna", "en", "nuestras", "notas", "sobre",
  // fr
  "il", "n", "y", "a", "pas", "pour", "le", "l", "les", "du", "des", "aucune", "sur", "nos", "concernant",
  // de
  "es", "gibt", "keine", "fur", "den", "die", "das", "der", "zum", "zur", "wir", "haben", "ich", "habe", "unseren", "notizen", "leider",
  // ru / ar
  "нет", "для", "у", "нас", "по", "в", "наших", "заметках", "к", "сожалению", "لا", "توجد", "يوجد", "ليس", "لدينا",
]);
const ASCII_FOLD: Readonly<Record<string, string>> = { ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u", â: "a", î: "i", û: "u" };
function namesSubject(removed: string): boolean {
  const residue = noInstructionClauseResidue(removed);
  if (residue === null) return true;
  // Kalıbın dili: Türkçe "talimat" kalıbı → yalnız Türkçe durak sözcükleri; aksi hâlde yabancı diller.
  const turkish = /talimat/u.test(residue) || /talimat/u.test(removed.toLocaleLowerCase("tr"));
  return residue
    .split(/[^\p{L}]+/u)
    .some((w) => {
      if (w.length === 0) return false;
      if (turkish && TR_RAW_STOPWORDS.has(w)) return false;
      const folded = w.replace(/[ışğçöüâîû]/gu, (c) => ASCII_FOLD[c] ?? c);
      return turkish ? !TR_STOPWORDS.has(folded) : !FOREIGN_STOPWORDS.has(folded);
    });
}

/**
 * Silme izin listesi (↑kural). `parts`: çıkarılacak parçalar (her biri bir "talimat yok" yan cümlesi / cümlesi, + bitişik asılı konu);
 * `kept`: geriye kalan yönerge metni.
 */
function removalAllowed(parts: readonly string[], kept: string): boolean {
  const removed = parts.join(" ");
  if (REFERENTIAL.test(removed)) return false;
  // Konusu adlandırılmış ama tanınmayan "talimat yok" silinmez (↑`namesSubject`) — parça parça: başka parçanın tanınan konusu onu örtmez.
  if (parts.some((p) => topicsOf(p).all.length === 0 && namesSubject(p))) return false;
  const r = topicsOf(removed);
  if (r.devices.length > 0) return false;
  const k = topicsOf(kept);
  if (k.devices.some((d) => !ALLOWED_DEVICE_IN_REST.has(d))) return false;
  const lifecycleNamed = LIFECYCLE_MARK.test(kept);
  const keptTopics = [...k.all.filter((t) => !LIFECYCLE_TOPICS.has(t) || lifecycleNamed), ...(DOOR_WORD.test(kept) ? ["door"] : [])];
  // Kalan yönergenin KENDİ konusu olmalı (yalnız selam / nezaket / "bize yazın" kalırsa soru kaybolurdu — S4-05).
  if (keptTopics.length === 0) return false;
  // Silinen "talimat yok"un HER konusu kalan yönergede karşılanmalı (başka konudaki cevap onu "cevaplanmış" yapmaz — S4-09).
  if (!r.all.every((t) => keptTopics.includes(t) || (PAIRED_TOPICS[t] ?? []).some((p) => keptTopics.includes(p)))) return false;
  if (admitsMissingKnowledge(kept) || matchesNoInstructionClause(kept)) return false;
  return true;
}

/** Baştaki bağlaç ("ama anahtarı…", "so just leave…") ve noktalama atılır: silinen yan cümleye bağlanıyordu, tek başına anlamsız. */
const LEADING_CONNECTIVE =
  /^[\s,;:،-]*(?:ama|fakat|ancak|lakin|ve|bu yüzden|o yüzden|dolayısıyla|but|however|and|so|therefore|aber|und|also|daher|mais|et|donc|alors|pero|y|así que|entonces|но|и|поэтому|так что|لذا|لكن)(?=[\s,])[\s,]*/iu;
/** Türkçe metin ipucu (dil bilinmezse): büyük harfe çevirirken "i" → "İ" yalnız Türkçede. */
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/u;

/**
 * İlk harfi büyütür. Cevabın dili biliniyorsa ("tr", "de"…) Türkçe kuralı ("i" → "İ") YALNIZ Türkçede (gece-4 S4-01: Almanca / İngilizce
 * cevapta ö / ü / ç ya da misafir adı "Ayşe" geçince "İhr könnt…", "İn case…" gidiyordu). Dil bilinmezse eski ipucu.
 */
function capitalizeFirst(text: string, language?: string | null): string {
  const first = text.charAt(0);
  if (!first) return text;
  const turkish = language && language !== "und" ? /^tr(?:-|$)/iu.test(language) : TURKISH_LETTERS.test(text);
  const upper = turkish ? first.toLocaleUpperCase("tr") : first.toUpperCase();
  return upper + text.slice(1);
}

/** Baştaki boşluk ve madde işareti ("- ", "• ", "2) ") — korunur (Haiku 10-17: "- " ilk yan cümleyle birlikte siliniyordu). */
const LIST_MARKER = /^[-*•–]\s+|^\d{1,3}[.)]\s+/u;
function leadOf(sentence: string): string {
  const ws = sentence.match(/^\s*/u)?.[0] ?? "";
  return ws + (sentence.slice(ws.length).match(LIST_MARKER)?.[0] ?? "");
}

/** Tek cümle, yan cümle düzeyi: silinebiliyorsa yeni hâli, değilse `null` (cümle aynen kalır). */
function stripClauses(sentence: string, language?: string | null): string | null {
  const lead = leadOf(sentence);
  const body = sentence.slice(lead.length);
  const clauses = clausesOf(body);
  if (clauses.length < 2) return null;
  const flagged = clauses.map((c) => removableClause(c));
  if (!flagged.some(Boolean) || flagged.every(Boolean)) return null;
  // Konu ayrı yan cümleye düşmüş olabilir ("Kombi için, özel talimatımız yok, …" — Haiku 10-17): BİTİŞİK asılı konu öbeği silinenle
  // birlikte denetlenir (cihazsa cümle tutulur).
  // Asılı konu, bitişik silinen yan cümleyle AYNI parçada denetlenir.
  const parts: string[] = [];
  let pending = "";
  clauses.forEach((c, i) => {
    if (flagged[i]) {
      parts.push(`${pending}${c}`);
      pending = "";
    } else if (flagged[i + 1] && danglingTopic(c)) pending = `${c} `;
    else if (flagged[i - 1] && danglingTopic(c)) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""} ${c}`;
  });
  const terminal = trailingTerminal(body) || ".";
  // Silinen yan cümlenin ARDINDAKİ bağlaç da atılır ("Anahtar masada, [özel talimatımız yok] ve kahvaltı …" → "Anahtar masada, kahvaltı …");
  // tek boşlukla birleşir (Opus 10-17 B4: bağlaçsız orta yan cümlede çift boşluk kalıyordu).
  let rest = trimTrailingSeparators(
    clauses
      .map((c, i) => (flagged[i] ? "" : i > 0 && flagged[i - 1] ? ` ${c.replace(LEADING_CONNECTIVE, "").trimStart()}` : c))
      .join("")
      .replace(LEADING_CONNECTIVE, "")
      .trim(),
  );
  if (!/[\p{L}\p{N}]/u.test(rest)) return null;
  if (!trailingTerminal(rest)) rest += terminal;
  rest = capitalizeFirst(rest, language);
  if (!removalAllowed(parts, rest)) return null;
  return lead + rest;
}

type Part = { text: string; whole: boolean };

/**
 * Cevaptaki silinebilir "talimat yok" yan cümlelerini / cümlelerini çıkarır (↑kural). Değişiklik yoksa AYNI dizeyi döner. Satır yapısı
 * korunur; tamamen boşalan satır düşer.
 */
export function stripNoInstructionFiller(reply: string, language?: string | null): string {
  if (!reply || !matchesNoInstructionClause(reply)) return reply;
  const sourceLines = reply.split("\n");
  // 1. tur: yan cümle düzeyi; bütünüyle "talimat yok" olan cümleler aday olarak işaretlenir.
  const lines: Part[][] = sourceLines.map((line) =>
    sentencesOf(line).map((s) => {
      if (!matchesNoInstructionClause(s)) return { text: s, whole: false };
      const stripped = stripClauses(s, language);
      if (stripped !== null) return { text: stripped, whole: false };
      return { text: s, whole: removableClause(s.slice(leadOf(s).length)) };
    }),
  );
  // 2. tur: bütün cümle düşürme — cevabın GERİ KALANI yönerge taşımalı (aynı izin listesi; Opus 10-17 B3).
  const all = lines.flat();
  const candidates = all.filter((p) => p.whole);
  if (candidates.length > 0) {
    const kept = all
      .filter((p) => !p.whole)
      .map((p) => p.text)
      .join(" ");
    if (!/[\p{L}\p{N}]/u.test(kept) || !removalAllowed(candidates.map((p) => p.text), kept)) for (const p of candidates) p.whole = false;
  }
  const out: string[] = [];
  lines.forEach((parts, i) => {
    const kept = parts.filter((p) => !p.whole);
    if (kept.length === parts.length) {
      out.push(parts.map((p) => p.text).join(""));
      return;
    }
    const joined = kept.map((p) => p.text).join("").trim();
    // Tamamen boşalan satır düşer; kısmen kalan satırın baştaki boşluğu / madde işareti korunur.
    if (!/[\p{L}\p{N}]/u.test(joined)) return;
    out.push(leadOf(sourceLines[i] ?? "") + capitalizeFirst(joined.replace(LIST_MARKER, ""), language));
  });
  // Düşen satırın bıraktığı ardışık boş satırlar teke iner; baştaki / sondaki boş satır atılır.
  const collapsed: string[] = [];
  for (const line of out) {
    if (line.trim() === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1]!.trim() === "")) continue;
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1]!.trim() === "") collapsed.pop();
  // Hiçbir şey değişmediyse AYNI dize (boş satır normalleştirmesi yalnız değişiklik olduğunda).
  const source = sourceLines.flatMap((l) => sentencesOf(l));
  return all.every((p, idx) => !p.whole && p.text === source[idx]) ? reply : collapsed.join("\n");
}

// ---------------------------------------------------------------------------
// KURUCU T1 (10-21, aynen): "'Bilgimiz yok' cümlesini silmek, arkasındaki kanıtsız talimatı veya izni gönderilebilir hâle getirmeyecek."
// Yapısal izin listesi (↑) kalan metnin KONUSUNA bakıyordu, DAYANAĞINA değil: "Çıkış için özel talimatımız yok, kapıyı çekip çıkmanız yeterli"
// bilgi tabanında hiç yazmasa da siliniyor, uydurma yönerge misafire gidiyordu. Artık silme yapıldıysa kalan HER içerik cümlesi modele verilen
// bilgi tabanının TEK bir kaleminde dayanak taşımalı (içerik sözcüklerinin en az %75'i — 5 harflik gövde — ve cümledeki HER sayı aynen);
// taşımıyorsa cevaba dokunulmaz → "bilgim yok" kuralı bütün cevabı tutar, ev sahibi yanıtlar. Yalnız selam / nezaket cümlesi muaf. Bilgi
// tabanı verilmezse silme YOK (dayanak doğrulanamaz).
// ---------------------------------------------------------------------------

const GROUND_STOPWORDS: ReadonlySet<string> = new Set([
  "için", "icin", "olarak", "ancak", "fakat", "sadece", "yalnız", "yalniz", "lütfen", "lutfen", "bunu", "şunu", "sunu", "bizim", "sizin",
  "yeterli", "olur", "olabilir", "edebilirsiniz", "yapabilirsiniz", "please", "just", "simply", "your", "with", "that", "this", "there",
  "have", "will", "from", "into", "when", "then", "also", "only",
]);
const COURTESY_SENTENCE =
  /^(?:merhaba|selam|sevgili|değerli|degerli|hello|hi|dear|hola|bonjour|hallo|здравствуйте)\b[^.!?]{0,40}[,.!]?$|iyi (?:yolculuklar|tatiller|günler|gunler|akşamlar|aksamlar|konaklamalar)|keyifli|teşekkür|tesekkur|thank|have a (?:nice|great|safe|good|lovely)|enjoy your|safe travels/iu;

function groundTokens(text: string): string[] {
  const folded = text
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");
  return folded
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !GROUND_STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => w.slice(0, 5));
}

/** Cümle bilgi tabanının tek bir kaleminde dayanak taşıyor mu (↑ ölçüt). */
export function sentenceGroundedInKb(sentence: string, kbTexts: readonly string[]): boolean {
  const tokens = groundTokens(sentence);
  const numbers = sentence.match(/\d+/g) ?? [];
  if (tokens.length === 0 && numbers.length === 0) return true;
  return kbTexts.some((kb) => {
    const kbTokens = new Set(groundTokens(kb));
    const hit = tokens.filter((t) => kbTokens.has(t)).length;
    return (tokens.length === 0 || hit / tokens.length >= 0.75) && numbers.every((n) => kb.includes(n));
  });
}

/**
 * Cevap yolunun kullandığı silici (`suggestReply`): yapısal silme (↑) + dayanak şartı. Silme yapılmadıysa ya da kalan içerik dayanaksızsa
 * cevap AYNEN döner.
 */
export function stripNoInstructionFillerGrounded(reply: string, language: string | null | undefined, kbTexts: readonly string[] | undefined): string {
  const out = stripNoInstructionFiller(reply, language);
  if (out === reply) return reply;
  if (!kbTexts || kbTexts.length === 0) return reply;
  const sentences = out
    .split("\n")
    .flatMap((l) => sentencesOf(l))
    .map((s) => s.replace(/^[\s\-•*]+/u, "").trim())
    .filter((s) => /\p{L}/u.test(s) && !COURTESY_SENTENCE.test(s.toLocaleLowerCase("tr")));
  return sentences.every((s) => sentenceGroundedInKb(s, kbTexts)) ? out : reply;
}
