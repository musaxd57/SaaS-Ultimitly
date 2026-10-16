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

export function stripTopicAbsence(input: {
  reply: string;
  /** Cevap modelinin beyanı (`answeredRequests.refs`). */
  answeredRefs: readonly string[];
  /** Cevaplanabilir isteklerin konuları (plan verir, `ItemsGateInput.answerableTopics`). */
  answerableTopics: readonly { ref: string; topics: readonly string[] }[];
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
  const droppedTopics = new Set(input.answerableTopics.filter((r) => dropped.has(r.ref)).flatMap((r) => r.topics));
  if (droppedTopics.size > 0 && keptTopics.some((ts) => ts.some((t) => droppedTopics.has(t)))) {
    return { ok: false, reason: "dropped_topic_kept" };
  }
  if (admitsMissingKnowledge(reply)) return { ok: false, reason: "still_absent" };
  if (hedges(reply)) return { ok: false, reason: "hedged_kept" };

  const answeredRefs = input.answeredRefs.filter((r) => !dropped.has(r));
  if (answeredRefs.length === 0) return { ok: false, reason: "nothing_answered" };
  const topicsOfRef = new Map(input.answerableTopics.map((r) => [r.ref, r.topics]));
  const remaining = new Set(answeredRefs.flatMap((r) => topicsOfRef.get(r) ?? []));
  if (keptTopics.some((ts) => !ts.some((t) => remaining.has(t)))) return { ok: false, reason: "unanchored_kept" };
  for (const ref of answeredRefs) {
    const topics = topicsOfRef.get(ref) ?? [];
    if (topics.length === 0 || !keptTopics.some((ts) => ts.some((t) => topics.includes(t)))) return { ok: false, reason: "uncovered_answered" };
  }
  return { ok: true, reply: greeting + reply, answeredRefs, droppedRefs: [...dropped].sort(), droppedSentences };
}
