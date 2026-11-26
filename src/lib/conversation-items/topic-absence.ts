// ---------------------------------------------------------------------------
// KONU BAZLI "BİLGİM YOK" (H9, kurucu kararı 10-16; anahtar `AI_TOPIC_ABSENCE_ENABLED`, VARSAYILAN KAPALI; saf).
//
// Kurucu: "Cevabı yalnız bir ifade geçti diye bütünüyle tutma; anlamına ve konusuna bak … Televizyona çözüm bulunamadığında konu sessizce
// kaybolmasın; arıza açık kalsın, bağımsız çöp sorusu cevaplanabilsin." ("bilgim yok" cümlesi misafire ASLA gitmez — `ai/absence.ts` aynen.)
//
// Yalnız ÖĞE KİPİNDE (konuşma öğeleri açık + tur öğeye bölündü): orada her isteğin kimliği ve konusu var, cevap modelinin beyanı
// (`answeredRequests`) hangi isteğin cevaplandığını söyler ve cevaplanmayan istek ev sahibinde AÇIK kalır (`flow.settleItemsTurn`).
//
// Kural (hepsi şart; biri tutmazsa sonuç `ok: false` → çağıran bugünkü gibi bütün cevabı TUTAR):
//   1. Cevap cümlelere bölünür; "bilgim yok" diyen her cümle AYIKLANIR.
//   2. Ayıklanan her cümlenin konusu ya ev sahibine BIRAKILAN bir cihaza (tutulan arıza) ya da cevaplanabilir bir isteğin konusuna
//      eşlenmeli. Eşlenmeyen yokluk cümlesi ("Bu konuda bilgim yok.") → tutulur (hangi konunun açık kaldığı bilinmiyor).
//   3. Eşlenen cevaplanabilir istek beyandan DÜŞER (cevaplandı sayılmaz → ev sahibinde açık kalır).
//   4. Kalan metin boş değil, kalan beyan boş değil, kalan cümleler düşen isteğin konusuna DEĞİNMİYOR (yarım tarif kalmasın) ve kalan
//      metnin bütünü yine "bilgim yok" demiyor.
//   5. Kalan HER cümle kalan (cevaplanmış) bir isteğin konusuna değinir (Haiku 10-16): konusuz bir adım ("Kırmızı tuşa basın.") hangi
//      isteğe ait olduğu bilinmeden misafire gitmesin — "bilgim yok" diyen cevapta yarım kalmış tarifin parçası olabilir. Şüphede tut.
//      İstisna: kodun selam satırı (`AI_CODE_GREETING_ENABLED`, tablo selamıyla BİREBİR — `withoutCodeGreetingLine`) ayrılır, aynen geri eklenir.
//   6. KAPSAMA (Opus P1, 10-16): beyanda KALAN her isteğin konusu boş değil ve kalan metinde en az bir cümle o konuya değinir. Yoksa yokluk
//      cümlesi o isteği de anmış olabilir ("Spor salonu ve diğer sorunuz hakkında bilgim yok.") — istek sessizce "cevaplandı" kapanmasın.
//   7. Kalan metin belirsizlik söylemez ("emin değilim", "kesin söyleyemem", "not sure" — Opus P2-c): bugün aynı cevaptaki yakalanan
//      "bilgim yok" bütün cevabı tuttuğu için bu kardeş ifadeler de gitmiyordu; ayıklama onları serbest bırakmasın.
// Ayıklama SATIR SATIR yapılır (Opus P2-a): ayıklanan cümle satırın sonundaysa satır sonu korunur (iki satır yapışmaz), satırın tamamıysa
// satır düşer (boş satır bırakmaz).
// Kalan metin çağıranda BÜTÜN güvenlik kapılarından yeniden geçer (bırakılan cihaza değinme, çıktı vetosu, dil … aynen).
// Misafire yeni bir cümle EKLENMEZ (K10: devir / "ilettim" yok); yalnız cümle ÇIKARILIR.
// ---------------------------------------------------------------------------

import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { withoutCodeGreetingLine } from "@/lib/ai/code-greeting";
import { isStopword, tokenize } from "@/lib/ai/retrieval/text";
import { topicsWithSymptomsOf } from "./relation";

/** Anahtar: yalnız tam "1" açar (`scripts/env-check.mjs` STRICT_ONE_FLAGS). */
export function topicAbsenceEnabled(): boolean {
  return process.env.AI_TOPIC_ABSENCE_ENABLED === "1";
}

export type TopicAbsenceOutcome =
  | { ok: true; reply: string; answeredRefs: string[]; droppedRefs: string[]; droppedSentences: number }
  | {
      ok: false;
      reason:
        | "no_absence"
        | "nothing_left"
        | "unattributed"
        | "nothing_answered"
        | "dropped_topic_kept"
        | "still_absent"
        | "hedged_kept"
        | "unanchored_kept"
        | "uncovered_answered";
    };

/**
 * Satır içi cümle parçaları (ayraçlarıyla; birleştirince satırın kendisi). Sınır = nokta / ünlem / soru + boşluk ("15.00" bölünmez).
 * `ai/absence.ts` boşlukları teke indirip satır sonunu sınır SAYMAZ; satıra bölünmüş yokluk cümlesinin parçası burada konusuz kalır
 * (`unattributed`) ya da kalan metin bütün olarak yeniden okunur (`still_absent`) — fazladan bölme yalnız tutma yönündedir. Doğrusal: tek
 * karakterlik geriye bakış.
 */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])(?=\s)/u).filter((s) => s.length > 0);
}

/**
 * Kalan metinde belirsizlik (kural 7). Kapalı liste, alt dize (doğrusal); ŞÜPHEDE TUT yönünde — "Emin değilseniz yazın" gibi olumsuz
 * olmayan kullanım da tutar (fayda kaybı, güvenlik kaybı değil). İki küçük harf biçimi: Türkçe ("İ"→"i") ve genel ("I"→"i"; Türkçe
 * yerelde "CONFIRM" "confırm" olurdu).
 */
const HEDGES = [
  "emin değil",
  "emin degil",
  "söyleyemem",
  "söyleyemiyorum",
  "söyleyemeyiz",
  "netleştiremiyorum",
  "netleştiremem",
  "bilgi veremem",
  "bilgi veremeyiz",
  "teyit edemiyorum",
  "teyit edemem",
  "doğrulayamıyorum",
  "doğrulayamam",
  "bilemiyorum",
  "not sure",
  "unsure",
  "not certain",
  "can't confirm",
  "cannot confirm",
  "can't say",
  "cannot say",
  "can't tell",
  "cannot tell",
  "don't know",
  "nicht sicher",
  "weiß nicht",
  "nicht sagen",
  "nicht bestätigen",
] as const;
function hedges(text: string): boolean {
  const plain = text.replace(/[’‘]/g, "'");
  const forms = [plain.toLocaleLowerCase("tr"), plain.toLowerCase()];
  return HEDGES.some((h) => forms.some((f) => f.includes(h)));
}

// ── İSTEĞİN KENDİ SÖZCÜKLERİ (kurucu 10-22 Soru 1: "önerin çok mantıklı") ────────────────────────────────────────────────────────────────
// Konu eşlemesi eskiden YALNIZ sabit konu sözlüğüyle yapılıyordu (`topicsWithSymptomsOf`): "What time is checkout, and is there a sauna?"
// cevabındaki "I don't have information about a sauna." cümlesi bir konuya eşlenemiyor ("sauna" sözlükte yok), cevabın TAMAMI tutuluyordu.
// Artık her isteğin anlama katmanındaki sorguları (Türkçe + özgün dil) içerik köklerine iner (`needTerms`); "bilgim yok" cümlesi ortak kökü
// en çok olan isteğe (eşitlikte HEPSİNE — fazla eşleme tutma yönündedir) bağlanır. Genel / yokluk sözcükleri ("bilgi, konu, kayıt, saat,
// information, host …") eşleşme sayılmaz: "Bu konuda bilgim yok." yine hiçbir isteğe bağlanmaz → bütün cevap tutulur (bugünkü gibi).
// Sözlük eşlemesi AYNEN durur; kök eşlemesi yalnız EKLER. Saf, doğrusal.

/**
 * Eşleşme sayılmayan genel / yokluk sözcükleri — katlanmış (ASCII) KÖK BAŞLANGIÇLARI: belirteç ya bunlardan birine eşittir ya da (kök en az 4
 * harfse) onunla başlar ("bilgim", "bilgiler", "information", "hours" …). Kök bulucu (`retrieval/text.stem`) BİLEREK kullanılmaz: yabancı
 * kökenli sözcüğü ek sanıp kırpıyor ("sauna" → "sa", ölçüldü).
 */
const GENERIC_NEED_ROOTS = (
  "bilgi konu kayit not notlar detay ayrinti maalesef yok var mevcut elim sahib sor iste ulas iletisim paylas belirt yaz kesin emin " +
  "soyle simdi sistem veri daire saat zaman gun acik kapali kapan ilgili durum olan nedir kac " +
  "inform info detail record note notes unfortunate host ask contact know sure have don doesn isn aren can cannot provid share " +
  "availab current time hour open clos day apartment propert system data regard mention list specific any some what when there " +
  "keine leider gastgeber malheureuse lamentable informaci anfitri " +
  // Haiku 10-22: yaygın işlev / yokluk sözcükleri — "Dazu gibt es keine Information" "gibt" ile sauna isteğine bağlanıyordu.
  "gibt der die das dem den ist eine einen wann dazu also check guest pas sais heure est quelle sur une des les " +
  "sahip cevap verem dair eldeki bilmiyor bunu buna degil ama please"
).split(" ");

function isGenericToken(t: string): boolean {
  return GENERIC_NEED_ROOTS.some((g) => t === g || (g.length >= 4 && t.startsWith(g)));
}

/** Metnin ayırt edici sözcükleri: katlanmış belirteç, en az 3 harf, durak / genel / yokluk sözcüğü ve rakam DEĞİL. */
export function distinctiveTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length >= 3 && !/\d/.test(t) && !isStopword(t) && !isGenericToken(t));
}

/** İsteğin sorgularının (Türkçe + özgün dil) ayırt edici sözcükleri — plan kurar, kapı okur. */
export function needTerms(queries: readonly string[]): string[] {
  return [...new Set(queries.flatMap((q) => distinctiveTokens(q)))].sort();
}

/**
 * Katlanmış Türkçe ÇEKİM ekleri (hâl / iyelik / çoğul — türetme eki YOK: "-cı, -lık, -lı, -sız" yeni sözcük kurar: "kapı" ≠ "kapıcı",
 * "temiz" ≠ "temizlik") + İngilizce çoğul. Sıkı eşleşme yalnız bunları kabul eder (Haiku 10-22: "check" ~ "checkout", "kapı" ~ "kapıcı").
 */
const INFLECTIONS = new Set(
  (
    "a e i u ya ye yi yu da de ta te dan den tan ten in un nin nun yla yle la le na ne ni nu nda nde ndan nden " +
    "lar ler lari leri larin lerin larda lerde lardan lerden lara lere si su sin sun sini sina sine sinda sinde sindan sinden " +
    "im um imiz umuz iniz unuz mi mu miz muz niz nuz s es"
  ).split(" "),
);

/** Sözcük sonu ünsüz yumuşaması (katlanmış): dolap → dolab(ı), kitap → kitab(ı), yatak → yatag(ı), renk → reng(i), sokak → sokag(ı). */
function softened(w: string): string | null {
  const last = w[w.length - 1];
  const soft = last === "p" ? "b" : last === "t" ? "d" : last === "k" ? "g" : last === "c" ? "c" : null;
  return soft && soft !== last ? w.slice(0, -1) + soft : null;
}

/**
 * Sözcüğün olası çekimsiz biçimleri: kendisi + (en az 4 harf kalıyorsa) bir çekim eki sökülmüş hâli + sözcük sonu yumuşamış hâli.
 * "saunanın" → {saunanin, sauna}; "saunada" → {saunada, sauna}; "dolap" → {dolap, dolab}; "dolabın" → {dolabin, dolab}.
 * Cevap parçası doğrulayıcısı da gün adlarını bununla okur ("cumartesileri" → "cumartesi").
 */
export function baseForms(w: string): Set<string> {
  const out = new Set([w]);
  const soft = softened(w);
  if (soft && soft.length >= 4) out.add(soft);
  for (let k = 1; k <= 6 && w.length - k >= 4; k++) if (INFLECTIONS.has(w.slice(-k))) out.add(w.slice(0, -k));
  return out;
}

/**
 * SIKI eşleşme — yalnız GÖNDERİME izin veren kararlarda (kalan cümle kalan isteğe bağlı mı, kalan istek kalan metinde karşılık buluyor mu):
 * iki sözcüğün çekimsiz biçimleri ortak (yalnız ÇEKİM eki sökülür). "sauna" ~ "saunada" ~ "saunanın" ✓, "dolap" ~ "dolabın" ✓,
 * "check" ~ "checkout" ✗, "kapı" ~ "kapıcı" ✗, "park" ~ "parking" ✗ (şüphede tut).
 */
function sameWordStrict(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const fa = baseForms(a);
  for (const f of baseForms(b)) if (fa.has(f)) return true;
  return false;
}

/**
 * GEVŞEK eşleşme — yalnız TUTMA yönündeki kararlarda ("bilgim yok" cümlesini isteğe bağlama, kalan metinde düşen konuyu arama): kısası
 * (ya da yumuşamış hâli) en az 3 harf ve uzunun başı ("oda" ~ "odasında", "dolap" ~ "dolabın"). Fazla eşleşme daha çok tutar.
 */
function sameWordLoose(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3) return false;
  const soft = softened(s);
  return l.startsWith(s) || (soft !== null && l.startsWith(soft));
}

/** `a`daki kaç sözcüğün `b`de karşılığı var (`same` kararın yönüne göre sıkı ya da gevşek). */
const overlapWith =
  (same: (x: string, y: string) => boolean) =>
  (a: readonly string[], b: readonly string[]): number =>
    a.filter((t) => b.some((u) => same(t, u))).length;
export const overlapLoose = overlapWith(sameWordLoose);
export const overlapStrict = overlapWith(sameWordStrict);

/**
 * İsteğin sözcüklerinden kaçı metinde SIKI eşleşmeyle geçiyor (yalnız çekim eki — "havuz" ~ "havuzumuz", "kapı" ≁ "kapıcı"). Cevap parçası
 * doğrulayıcısı (`ai/answer-binding.ts`) değerin yanındaki konuyu bununla okur — gönderime izin veren karar olduğu için SIKI.
 */
export function needTermsInStrict(terms: readonly string[], text: string): number {
  return overlapStrict(terms, distinctiveTokens(text));
}

export function stripTopicAbsence(input: {
  reply: string;
  /** Cevap modelinin beyanı (`answeredRequests.refs`). */
  answeredRefs: readonly string[];
  /** Cevaplanabilir isteklerin konuları + kendi sözcükleri (plan verir, `ItemsGateInput.answerableTopics`; `terms` yoksa yalnız sözlük). */
  answerableTopics: readonly { ref: string; topics: readonly string[]; terms?: readonly string[] }[];
  /** Ev sahibine bırakılan cihazlar (`ItemsGateInput.heldDeviceTopics`). */
  heldDeviceTopics: readonly string[];
  /** Kodun selam satırını tanımak için hitap adı (`reservation.guestGivenName`; yoksa yalnız adsız selam tanınır). */
  greetingName?: string | null;
}): TopicAbsenceOutcome {
  // Kodun selam satırı konu denetiminden muaf: ayrılır, sonuca AYNEN geri eklenir (kural 5 istisnası).
  const body = withoutCodeGreetingLine(input.reply, input.greetingName ?? null);
  const greeting = input.reply.slice(0, input.reply.length - body.length);
  const lines = body.split("\n");
  const segs = lines.map(sentencesOf);
  const absent = segs.map((ss) => ss.map((s) => admitsMissingKnowledge(s)));
  if (!absent.some((a) => a.some(Boolean))) return { ok: false, reason: "no_absence" };

  const held = new Set(input.heldDeviceTopics);
  const dropped = new Set<string>();
  let droppedSentences = 0;
  const kept: string[] = [];
  const outLines: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    let touched = false;
    let text = "";
    for (let k = 0; k < segs[li].length; k++) {
      const seg = segs[li][k];
      if (!absent[li][k]) {
        text += seg;
        if (seg.trim()) kept.push(seg);
        continue;
      }
      touched = true;
      droppedSentences += 1;
      const topics = topicsWithSymptomsOf(seg);
      const touchesHeld = topics.some((t) => held.has(t));
      const refs = input.answerableTopics.filter((r) => r.topics.some((t) => topics.includes(t))).map((r) => r.ref);
      // Kurucu 10-22 Soru 1: sözlük eşlemesine EK olarak isteğin kendi sözcükleri — en çok ortak kökü olan istek(ler).
      const segStems = distinctiveTokens(seg);
      const scores = input.answerableTopics.map((r) => ({ ref: r.ref, n: overlapLoose(r.terms ?? [], segStems) }));
      const best = Math.max(0, ...scores.map((x) => x.n));
      if (best > 0) for (const x of scores) if (x.n === best && !refs.includes(x.ref)) refs.push(x.ref);
      if (!touchesHeld && refs.length === 0) return { ok: false, reason: "unattributed" };
      for (const r of refs) dropped.add(r);
    }
    // Ayıklama olmayan satır AYNEN; olan satır iki uçtan kırpılır, boş kaldıysa TAMAMEN düşer. Satır satır kırpma doğrusal
    // (`[ \t]+\n` kalıbı uzun boşluk dizisinde karesel — CLAUDE.md ReDoS dersi).
    if (!touched) outLines.push(lines[li]);
    else if (text.trim()) outLines.push(text.trim());
  }
  const reply = outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!reply) return { ok: false, reason: "nothing_left" };

  const keptTopics = kept.map((s) => topicsWithSymptomsOf(s));
  const keptStems = kept.map((s) => distinctiveTokens(s));
  const answeredRefs = input.answeredRefs.filter((r) => !dropped.has(r));
  const termsOfRef = new Map(input.answerableTopics.map((r) => [r.ref, r.terms ?? []]));
  const remainingTerms = [...new Set(answeredRefs.flatMap((r) => termsOfRef.get(r) ?? []))];
  const droppedTopics = new Set(input.answerableTopics.filter((r) => dropped.has(r.ref)).flatMap((r) => r.topics));
  // Düşen isteğin KENDİNE ÖZGÜ sözcükleri (cevaplanan bir istekle ortak sözcük düşen konunun kanıtı sayılmaz).
  const droppedTerms = [...new Set([...dropped].flatMap((r) => termsOfRef.get(r) ?? []))].filter((t) => overlapStrict([t], remainingTerms) === 0);
  if (
    (droppedTopics.size > 0 && keptTopics.some((ts) => ts.some((t) => droppedTopics.has(t)))) ||
    (droppedTerms.length > 0 && keptStems.some((ss) => overlapLoose(droppedTerms, ss) > 0))
  ) {
    return { ok: false, reason: "dropped_topic_kept" };
  }
  if (admitsMissingKnowledge(reply)) return { ok: false, reason: "still_absent" };
  if (hedges(reply)) return { ok: false, reason: "hedged_kept" };

  if (answeredRefs.length === 0) return { ok: false, reason: "nothing_answered" };
  const topicsOfRef = new Map(input.answerableTopics.map((r) => [r.ref, r.topics]));
  const remaining = new Set(answeredRefs.flatMap((r) => topicsOfRef.get(r) ?? []));
  // Kalan her cümle kalan bir isteğe sözlük konusuyla YA DA isteğin kendi sözcüğüyle bağlanır (kural 5); kalan her istek kalan metinde
  // sözlük konusuyla ya da kendi sözcüğüyle karşılık bulur (kural 6).
  if (kept.some((_, i) => !keptTopics[i].some((t) => remaining.has(t)) && overlapStrict(keptStems[i], remainingTerms) === 0)) {
    return { ok: false, reason: "unanchored_kept" };
  }
  for (const ref of answeredRefs) {
    const topics = topicsOfRef.get(ref) ?? [];
    const terms = termsOfRef.get(ref) ?? [];
    const byTopic = topics.length > 0 && keptTopics.some((ts) => ts.some((t) => topics.includes(t)));
    const byTerm = terms.length > 0 && keptStems.some((ss) => overlapStrict(terms, ss) > 0);
    if (!byTopic && !byTerm) return { ok: false, reason: "uncovered_answered" };
  }
  return { ok: true, reply: greeting + reply, answeredRefs, droppedRefs: [...dropped].sort(), droppedSentences };
}
