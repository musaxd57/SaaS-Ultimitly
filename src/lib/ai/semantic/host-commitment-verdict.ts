// ---------------------------------------------------------------------------
// EV SAHİBİ SÖZÜ OKUMASI — KAPALI KÜMELER + HIZLI KOD DOĞRULAMASI + KARAR. SAF modül (ağ yok, veritabanı yok, `server-only` yok): okuyucu
// (`host-commitment-reader.ts`), gölge kaydı ve ölçer aynı kuralı buradan okur.
//
// İş bölümü (kurucu 11-18 akşam): ANLAMI model okur — kim üstleniyor, aktarıyor mu, reddediyor mu. Kod anlam kararı VERMEZ; yalnız modelin
// söylediğinin metne dayandığını hızlıca doğrular:
//   1. alıntı, modelin gördüğü metinde gerçekten geçiyor mu (uydurma alıntı → ifade geçersiz);
//   2. modelin verdiği saat alıntıdaki bir rakamdan mı geliyor (uydurma saat → otomatik görev açılamaz);
//   3. alıntı tırnak içinde ya da iletilmiş (">") satırda mı — ilk aşamada bu yapı otomatik görevi TUTAN bir işarettir (model "üstleniyor"
//      dese de önce ev sahibine sorulur). Sahipliği yapıdan ÇIKARMAZ; yalnız temkin payıdır, ölçümle gevşetilir.
// Doğrulama yalnız TUTAR (otomatik → kart); hiçbir zaman açmaz.
// ---------------------------------------------------------------------------

/** Modelin her söz adayı için seçtiği okuma (kapalı küme). */
export const HOST_COMMITMENT_READINGS = [
  /** Ev sahibi (ben / biz / ekibimiz) üstleniyor ya da olacağını teyit ediyor. */
  "host_commits",
  /** Ev sahibi başkasının (usta, firma) dediğini aktarıyor; kendi sözü olarak üstlendiği belli değil. */
  "host_relays_unconfirmed",
  /** Koşula bağlı / kararsız ("parça gelirse", "bakıp döneceğim"). */
  "host_conditional",
  /** Misafirin sözünü aktarıyor / anıyor — ev sahibinin sözü değil. */
  "guest_words",
  /** Planlanmadığını / olmayacağını söylüyor. */
  "denial",
  /** Soru, geçmiş olay, genel bilgi — gelecek bir iş sözü değil. */
  "question_or_other",
] as const;
export type HostCommitmentReading = (typeof HOST_COMMITMENT_READINGS)[number];

export const HOST_COMMITMENT_TOPICS = ["towels", "supplies", "cleaning", "maintenance", "other"] as const;
export type HostCommitmentTopic = (typeof HOST_COMMITMENT_TOPICS)[number];

export const HOST_COMMITMENT_DAYS = ["today", "tomorrow", "other", "unspecified"] as const;
export type HostCommitmentDay = (typeof HOST_COMMITMENT_DAYS)[number];

export interface HostCommitmentStatement {
  quote: string;
  reading: HostCommitmentReading;
  topic: HostCommitmentTopic;
  day: HostCommitmentDay;
  /** "HH:MM" ya da boş. */
  time: string;
  /** Modelin tek cümlelik nedeni (kayıt için; karar buna bakmaz). */
  why: string;
}

/**
 * Bir mesajın söz kararı (üç basamak — bugünkü akışın karşılıkları):
 *  · auto — kendiliğinden görev açılabilir (bugünkü "kesin söz");
 *  · card — ev sahibine sorulur (bugünkü "kesin değil" inceleme kartı);
 *  · none — söz yok (görev de kart da yok).
 */
export type HostCommitmentDecision = "auto" | "card" | "none";

/** Okuma → karar (doğrulamadan ÖNCE). Kurucu 11-18 örnekleri: aktarılan misafir sözü / ret → hiçbir şey; üstlenilmesi belirsiz aktarma → kart. */
export function decisionOfReading(reading: HostCommitmentReading): HostCommitmentDecision {
  switch (reading) {
    case "host_commits":
      return "auto";
    case "host_relays_unconfirmed":
    case "host_conditional":
      return "card";
    case "guest_words":
    case "denial":
    case "question_or_other":
      return "none";
  }
}

const RANK: Readonly<Record<HostCommitmentDecision, number>> = { none: 0, card: 1, auto: 2 };
const stronger = (a: HostCommitmentDecision, b: HostCommitmentDecision): HostCommitmentDecision => (RANK[a] >= RANK[b] ? a : b);

/**
 * Boşluk dizileri teke iner (model alıntıda satır sonunu boşluğa çevirebilir). `map[k]` = sıkıştırılmış metnin k. karakterinin ÖZGÜN
 * metindeki konumu — alıntının yeri özgün metne geri taşınır (satır yapısı — iletilmiş ">" satırı — sıkıştırılmış metinde kaybolur).
 * Doğrusal; düzenli ifade yok (uzun girdide karesel iş olmasın).
 */
function squash(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let gapAt = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    // Boşluk sınıfı: ASCII boşluklar + bölünmez boşluk.
    const space = ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\u00a0";
    if (space) {
      if (out.length > 0 && gapAt < 0) gapAt = i;
      continue;
    }
    if (gapAt >= 0) {
      out += " ";
      map.push(gapAt);
      gapAt = -1;
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

const OPENERS: Readonly<Record<string, string>> = { "“": "”", "«": "»", "„": "“" };

/**
 * Metindeki ALINTI aralıkları (yarı açık [başlangıç, bitiş) — tırnakların içi) ve iletilmiş satırlar (">" ile başlayan satırın tamamı).
 * Kıvrık / köşeli tırnak eşiyle; düz tırnak (") sırayla açar-kapar. Kapanmayan açılış aralık DEĞİLDİR (inç işareti: 55" TV). Kesme (')
 * alıntı işareti sayılmaz ("10'da"). Doğrusal tek geçiş.
 */
export function quotedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let open: { at: number; close: string } | null = null;
  let lineStart = 0;
  let forwarded = false;
  let sawNonSpace = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i]! : "\n";
    if (ch === "\n") {
      if (forwarded) spans.push([lineStart, i]);
      // Satır sonunda kapanmamış düz tırnak taşınmaz (ölçü işareti bir sonraki satırın tırnağıyla eşleşmesin); kıvrık tırnak satır aşabilir.
      if (open && open.close === '"') open = null;
      lineStart = i + 1;
      forwarded = false;
      sawNonSpace = false;
      continue;
    }
    if (!sawNonSpace && ch !== " " && ch !== "\t") {
      sawNonSpace = true;
      if (ch === ">") forwarded = true;
    }
    if (open) {
      if (ch === open.close) {
        spans.push([open.at + 1, i]);
        open = null;
      }
      continue;
    }
    if (OPENERS[ch]) open = { at: i, close: OPENERS[ch]! };
    else if (ch === '"') open = { at: i, close: '"' };
  }
  return spans;
}

/** Alıntı metinde nerede (boşluklar teke inmiş metinde konum); yoksa -1. Çevreleyen tırnaklar sökülür. */
function locate(seenSquashed: string, quote: string): { at: number; needle: string } {
  let needle = squash(quote).text;
  while (needle.length > 0 && '"“”«»„'.includes(needle[0]!)) needle = needle.slice(1);
  while (needle.length > 0 && '"“”«»„'.includes(needle[needle.length - 1]!)) needle = needle.slice(0, -1);
  needle = needle.trim();
  if (needle.length === 0) return { at: -1, needle };
  return { at: seenSquashed.indexOf(needle), needle };
}

/**
 * Modelin saati alıntıdaki bir rakamdan mı geliyor. Saat ANLAMINI model verir ("akşam 6" → 18:00); kod yalnız "uydurulmadı"yı doğrular:
 * alıntıda saatin rakamı (12 saatlik karşılığı dahil) tek başına duran bir sayı olarak geçmeli; dakika 00 değilse o da geçmeli.
 * Boş saat her zaman geçerlidir (iddia yok).
 */
export function timeGroundedInQuote(time: string, quote: string): boolean {
  if (time === "") return true;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return false;
  // Alıntıdaki sayılar (doğrusal tarama).
  const numbers: number[] = [];
  let cur = "";
  for (let i = 0; i <= quote.length; i++) {
    const ch = i < quote.length ? quote[i]! : " ";
    if (ch >= "0" && ch <= "9") cur += ch;
    else {
      if (cur.length > 0 && cur.length <= 2) numbers.push(Number(cur));
      cur = "";
    }
  }
  const hourSeen = numbers.includes(hour) || numbers.includes(hour % 12) || (hour % 12 === 0 && numbers.includes(12));
  if (!hourSeen) return false;
  return minute === 0 || numbers.includes(minute);
}

export interface VerifiedStatement extends HostCommitmentStatement {
  /** Alıntı modelin gördüğü metinde geçiyor mu. Geçmiyorsa ifade karara GİRMEZ. */
  grounded: boolean;
  /** Alıntı tırnak içinde ya da iletilmiş satırda mı. */
  inQuotedSpan: boolean;
  /** Saat alıntıdan mı. */
  timeGrounded: boolean;
  /** Okumanın kararı (doğrulama öncesi). */
  raw: HostCommitmentDecision;
  /** Doğrulamadan sonraki karar (yalnız tutar: auto → card). Dayanaksız ifadede "none". */
  decision: HostCommitmentDecision;
  /** Kararı tutan doğrulama(lar). */
  held: Array<"quoted_span" | "time_ungrounded">;
}

export interface HostCommitmentVerdict {
  /** Mesajın kararı: dayanağı olan ifadelerin en güçlüsü. */
  decision: HostCommitmentDecision;
  statements: VerifiedStatement[];
  /** Dayanaksız (alıntısı metinde olmayan) ifade sayısı — okuma kalitesinin ölçüsü. */
  ungrounded: number;
}

/**
 * Okumayı doğrula ve karara çevir. `seenText` = modele GİDEN metin (maskeli hâli — alıntı ona göre aranır). Saf, doğrusal.
 */
export function verifyHostCommitmentReading(seenText: string, statements: readonly HostCommitmentStatement[]): HostCommitmentVerdict {
  const seen = squash(seenText);
  // Alıntı aralıkları ÖZGÜN metinde aranır (satır yapısı orada); alıntının yeri eşlemeyle özgün konuma taşınır.
  const spans = quotedSpans(seenText);
  let decision: HostCommitmentDecision = "none";
  let ungrounded = 0;
  const verified = statements.map((s): VerifiedStatement => {
    const raw = decisionOfReading(s.reading);
    const { at, needle } = locate(seen.text, s.quote);
    if (at < 0) {
      ungrounded++;
      return { ...s, grounded: false, inQuotedSpan: false, timeGrounded: false, raw, decision: "none", held: [] };
    }
    const from = seen.map[at]!;
    const to = seen.map[at + needle.length - 1]! + 1;
    const inQuotedSpan = spans.some(([a, b]) => from >= a && to <= b);
    const timeGrounded = timeGroundedInQuote(s.time, needle);
    const held: VerifiedStatement["held"] = [];
    let out = raw;
    if (raw === "auto") {
      if (inQuotedSpan) held.push("quoted_span");
      if (!timeGrounded) held.push("time_ungrounded");
      if (held.length > 0) out = "card";
    }
    decision = stronger(decision, out);
    return { ...s, grounded: true, inQuotedSpan, timeGrounded, raw, decision: out, held };
  });
  return { decision, statements: verified, ungrounded };
}

/**
 * Sözcük ağının (bugünkü algılayıcı) aynı üç basamaktaki kararı — gölge kıyası için. Söz yok → none; en az bir söz kendiliğinden kaydedilebilir
 * durumdaysa → auto; sözlerin hepsi "kesin değil / saat belirsiz / gün belirsiz" ise → card. (Günlük sınır, teslim durumu gibi mesajın
 * anlamıyla ilgisiz atlamalar kıyasa girmez.)
 */
export function decisionOfLexicalPromises(
  promises: ReadonlyArray<{ tentative: boolean; timeAmbiguous: boolean; dayUnclear: boolean }>,
): HostCommitmentDecision {
  if (promises.length === 0) return "none";
  return promises.some((p) => !p.tentative && !p.timeAmbiguous && !p.dayUnclear) ? "auto" : "card";
}

/** İki kararın ilişkisi (gölge ölçümünün tek sözlüğü). */
export type HostCommitmentAgreement =
  /** Aynı karar. */
  | "agree"
  /** Model daha TEMKİNLİ: sözcük ağı görev açardı / kart çıkarırdı, model daha azını söylüyor (aktarma, ret, alıntı). */
  | "model_holds"
  /** Model daha İLERİ: sözcük ağının görmediği / kararsız bulduğu sözü model kesin okuyor. */
  | "model_opens";

export function compareHostCommitmentDecisions(lexical: HostCommitmentDecision, model: HostCommitmentDecision): HostCommitmentAgreement {
  if (lexical === model) return "agree";
  return RANK[model] < RANK[lexical] ? "model_holds" : "model_opens";
}
