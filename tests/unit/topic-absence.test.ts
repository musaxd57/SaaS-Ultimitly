import { describe, it, expect, afterEach, vi } from "vitest";
import { stripTopicAbsence, topicAbsenceEnabled } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// KONU BAZLI "BİLGİM YOK" (H9, kurucu kararı 10-16; `AI_TOPIC_ABSENCE_ENABLED` kapalı doğar). Kurucu tablosu
// (`docs/TASARIM-2026-10-16-faz3-konu-bazli-cevap.md` §3): "bilgim yok" cümlesi misafire ASLA gitmez; konusu ev sahibinde açık kalır,
// bağımsız soru cevaplanır. Eşlenemeyen / boş kalan / yarım tarifli cevap bugünkü gibi bütünüyle tutulur.
// ---------------------------------------------------------------------------

const TRASH = "Çöpleri binanın arkasındaki konteynere bırakabilirsiniz.";
const TV_ABSENT = "Televizyonla ilgili bir bilgim yok.";
const tv = topicsWithSymptomsOf("televizyon siyah ekran");
const trash = topicsWithSymptomsOf("çöp nereye atılır");

describe("konu bazlı bilgim yok — saf kural", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ön koşul: sözlük TV'yi ve çöpü ayrı konu olarak okuyor (testin anlamı buna dayanır)", () => {
    expect(tv).toContain("tv");
    expect(trash.length).toBeGreaterThan(0);
    expect(trash).not.toContain("tv");
    expect(topicsWithSymptomsOf(TV_ABSENT)).toContain("tv");
  });

  it("🚨 KURUCU ÖRNEĞİ: TV ev sahibinde (tutulan arıza), çöp cevaplanabilir → yalnız çöp cevabı kalır, beyan aynen", () => {
    const out = stripTopicAbsence({
      reply: `${TRASH} ${TV_ABSENT}`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: trash }],
      heldDeviceTopics: ["tv"],
    });
    expect(out).toEqual({ ok: true, reply: TRASH, answeredRefs: ["R1"], droppedRefs: [], droppedSentences: 1 });
  });

  it("cevaplanabilir TV isteği (kullanım sorusu) bilgisiz kaldı → beyandan DÜŞER (ev sahibinde açık), çöp cevabı gider", () => {
    const out = stripTopicAbsence({
      reply: `${TRASH} ${TV_ABSENT}`,
      answeredRefs: ["R1", "R2"],
      answerableTopics: [
        { ref: "R1", topics: tv },
        { ref: "R2", topics: trash },
      ],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: true, reply: TRASH, answeredRefs: ["R2"], droppedRefs: ["R1"], droppedSentences: 1 });
  });

  it("konusu belirsiz yokluk cümlesi ('Bu konuda bilgim yok.') → TUTULUR (hangi konunun açık kaldığı bilinmiyor)", () => {
    const out = stripTopicAbsence({
      reply: `${TRASH} Bu konuda bir bilgim yok.`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: trash }],
      heldDeviceTopics: ["tv"],
    });
    expect(out).toEqual({ ok: false, reason: "unattributed" });
  });

  it("cevabın tamamı yokluk → TUTULUR (misafire boş ya da yalnız 'bilgim yok' gitmez)", () => {
    const out = stripTopicAbsence({ reply: TV_ABSENT, answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: tv }], heldDeviceTopics: [] });
    expect(out).toEqual({ ok: false, reason: "nothing_left" });
  });

  it("düşen istekten sonra cevaplanmış istek kalmıyor → TUTULUR", () => {
    const out = stripTopicAbsence({
      reply: `Kumandayı kontrol ettiniz mi diye sormak isterim. ${TV_ABSENT}`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: tv }],
      heldDeviceTopics: [],
    });
    expect(out.ok).toBe(false);
  });

  it("kalan cümle düşen isteğin konusuna değiniyor (yarım tarif) → TUTULUR", () => {
    const out = stripTopicAbsence({
      reply: `Televizyonu kumandadaki kırmızı tuşla açabilirsiniz. ${TRASH} Televizyonun arızasıyla ilgili bir bilgim yok.`,
      answeredRefs: ["R1", "R2"],
      answerableTopics: [
        { ref: "R1", topics: tv },
        { ref: "R2", topics: trash },
      ],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "dropped_topic_kept" });
  });

  it("yokluk cümlesi yoksa dokunulmaz ('Başka ayar yapmanıza gerek yok.' olumlu yönergedir)", () => {
    const out = stripTopicAbsence({
      reply: "Kumandadaki ON/OFF tuşuna basmanız yeterli, başka ayar yapmanıza gerek yok.",
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: tv }],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "no_absence" });
  });

  it("satır satır cevap da ayrılır; '15.00' bölünmez", () => {
    const out = stripTopicAbsence({
      reply: `Çöp günü salı, toplama 15.00'te.\n${TV_ABSENT}`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: trash }],
      heldDeviceTopics: ["tv"],
    });
    expect(out).toMatchObject({ ok: true, reply: "Çöp günü salı, toplama 15.00'te." });
  });

  it("anahtar yalnız tam '1' ile açılır", () => {
    vi.stubEnv("AI_TOPIC_ABSENCE_ENABLED", "");
    expect(topicAbsenceEnabled()).toBe(false);
    vi.stubEnv("AI_TOPIC_ABSENCE_ENABLED", "true");
    expect(topicAbsenceEnabled()).toBe(false);
    vi.stubEnv("AI_TOPIC_ABSENCE_ENABLED", "1");
    expect(topicAbsenceEnabled()).toBe(true);
  });
});
