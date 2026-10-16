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
// Kalan metin çağıranda BÜTÜN güvenlik kapılarından yeniden geçer (bırakılan cihaza değinme, çıktı vetosu, dil … aynen).
// Misafire yeni bir cümle EKLENMEZ (K10: devir / "ilettim" yok); yalnız cümle ÇIKARILIR.
// ---------------------------------------------------------------------------

import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { topicsWithSymptomsOf } from "./relation";

/** Anahtar: yalnız tam "1" açar (`scripts/env-check.mjs` STRICT_ONE_FLAGS). */
export function topicAbsenceEnabled(): boolean {
  return process.env.AI_TOPIC_ABSENCE_ENABLED === "1";
}

export type TopicAbsenceOutcome =
  | { ok: true; reply: string; answeredRefs: string[]; droppedRefs: string[]; droppedSentences: number }
  | {
      ok: false;
      reason: "no_absence" | "nothing_left" | "unattributed" | "nothing_answered" | "dropped_topic_kept" | "still_absent";
    };

/**
 * Cümle parçaları (ayraçlarıyla birlikte; birleştirince özgün metin). Sınır = nokta / ünlem / soru + BOŞLUK ya da satır sonu —
 * `ai/absence.ts` ile aynı ölçüt ("15.00" bölünmez). Doğrusal: tek karakterlik geriye bakış.
 */
function segmentsOf(text: string): string[] {
  return text.split(/(?<=[.!?])(?=\s)|(?<=\n)/u).filter((s) => s.length > 0);
}

export function stripTopicAbsence(input: {
  reply: string;
  /** Cevap modelinin beyanı (`answeredRequests.refs`). */
  answeredRefs: readonly string[];
  /** Cevaplanabilir isteklerin konuları (plan verir, `ItemsGateInput.answerableTopics`). */
  answerableTopics: readonly { ref: string; topics: readonly string[] }[];
  /** Ev sahibine bırakılan cihazlar (`ItemsGateInput.heldDeviceTopics`). */
  heldDeviceTopics: readonly string[];
}): TopicAbsenceOutcome {
  const segments = segmentsOf(input.reply);
  const absent = segments.map((s) => admitsMissingKnowledge(s));
  if (!absent.some(Boolean)) return { ok: false, reason: "no_absence" };

  const held = new Set(input.heldDeviceTopics);
  const dropped = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    if (!absent[i]) continue;
    const topics = topicsWithSymptomsOf(segments[i]);
    const touchesHeld = topics.some((t) => held.has(t));
    const refs = input.answerableTopics.filter((r) => r.topics.some((t) => topics.includes(t))).map((r) => r.ref);
    if (!touchesHeld && refs.length === 0) return { ok: false, reason: "unattributed" };
    for (const r of refs) dropped.add(r);
  }

  const kept = segments.filter((_, i) => !absent[i]);
  const reply = kept
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!reply) return { ok: false, reason: "nothing_left" };

  const droppedTopics = new Set(input.answerableTopics.filter((r) => dropped.has(r.ref)).flatMap((r) => r.topics));
  if (droppedTopics.size > 0 && kept.some((s) => topicsWithSymptomsOf(s).some((t) => droppedTopics.has(t)))) {
    return { ok: false, reason: "dropped_topic_kept" };
  }
  if (admitsMissingKnowledge(reply)) return { ok: false, reason: "still_absent" };

  const answeredRefs = input.answeredRefs.filter((r) => !dropped.has(r));
  if (answeredRefs.length === 0) return { ok: false, reason: "nothing_answered" };
  return { ok: true, reply, answeredRefs, droppedRefs: [...dropped].sort(), droppedSentences: absent.filter(Boolean).length };
}
