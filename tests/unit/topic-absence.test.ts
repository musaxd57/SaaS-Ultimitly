import { describe, it, expect, afterEach, vi } from "vitest";
import { stripTopicAbsence, topicAbsenceEnabled } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";
import { buildKbEvidence } from "@/lib/ai/grounding";

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
      reply: `Size yardımcı olmaktan memnuniyet duyarım. ${TV_ABSENT}`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: tv }],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "nothing_answered" });
  });

  it("🚨 konusuz adım cümlesi (hangi isteğe ait olduğu bilinmiyor; yarım TV tarifi olabilir) → TUTULUR (Haiku 10-16)", () => {
    const out = stripTopicAbsence({
      reply: `${TRASH} Kırmızı tuşa basmanız yeterli. ${TV_ABSENT}`,
      answeredRefs: ["R1", "R2"],
      answerableTopics: [
        { ref: "R1", topics: tv },
        { ref: "R2", topics: trash },
      ],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "unanchored_kept" });
  });

  it("kalan metin satıra bölünmüş 'bilgim yok' taşıyorsa (parçalar tek tek yokluk değil) → TUTULUR", () => {
    const out = stripTopicAbsence({
      reply: `${TRASH} Çöp hakkında başka bilgim\nmaalesef yok. ${TV_ABSENT}`,
      answeredRefs: ["R1"],
      answerableTopics: [{ ref: "R1", topics: trash }],
      heldDeviceTopics: ["tv"],
    });
    expect(out).toEqual({ ok: false, reason: "still_absent" });
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

  it("kendi satırındaki yokluk cümlesi boş satır bırakmaz (başta / ortada)", () => {
    const base = { answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: trash }], heldDeviceTopics: ["tv"] };
    expect(stripTopicAbsence({ ...base, reply: `${TRASH}\n${TV_ABSENT}\nÇöp günü salıdır.` })).toMatchObject({
      ok: true,
      reply: `${TRASH}\nÇöp günü salıdır.`,
    });
    expect(stripTopicAbsence({ ...base, reply: `${TV_ABSENT}\n${TRASH}` })).toMatchObject({ ok: true, reply: TRASH });
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

  it("🚨 KAPSAMA (Opus P1): yokluk cümlesi ikinci bir isteği de anıyorsa o istek sessizce 'cevaplandı' kapanmaz → TUTULUR", () => {
    const two = (absentSentence: string, other: readonly string[]) =>
      stripTopicAbsence({
        reply: `${TRASH} ${absentSentence}`,
        answeredRefs: ["R1", "R2"],
        answerableTopics: [
          { ref: "R1", topics: other },
          { ref: "R2", topics: trash },
        ],
        heldDeviceTopics: ["tv"],
      });
    const pool = topicsWithSymptomsOf("havuz");
    expect(two("Televizyon ve diğer sorunuzla ilgili bir bilgim yok.", pool)).toEqual({ ok: false, reason: "uncovered_answered" });
    expect(two("Televizyon ve beşik konusunda bir bilgim yok.", topicsWithSymptomsOf("bebek yatağı"))).toEqual({
      ok: false,
      reason: "uncovered_answered",
    });
    expect(two("I don't have any information about the TV or your other question.", pool)).toEqual({ ok: false, reason: "uncovered_answered" });
    // Bırakılan cihaz şart değil: üç bağımsız soru, biri adıyla, biri "diğer sorunuz" diye anılıyor.
    expect(
      stripTopicAbsence({
        reply: `${TRASH} Spor salonu ve diğer sorunuz hakkında bir bilgim yok.`,
        answeredRefs: ["R1", "R2", "R3"],
        answerableTopics: [
          { ref: "R1", topics: trash },
          { ref: "R2", topics: topicsWithSymptomsOf("spor salonu") },
          { ref: "R3", topics: pool },
        ],
        heldDeviceTopics: [],
      }),
    ).toEqual({ ok: false, reason: "uncovered_answered" });
  });

  it("🚨 satır sonundaki yokluk cümlesi ayıklanınca satırlar YAPIŞMAZ (Opus P2-a; misafire giden metin)", () => {
    const base = { answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: trash }], heldDeviceTopics: ["tv"] };
    expect(stripTopicAbsence({ ...base, reply: "Çöpleri arkadaki konteynere bırakın. Televizyonla ilgili bir bilgim yok.\nÇöp günü salıdır." })).toMatchObject({
      ok: true,
      reply: "Çöpleri arkadaki konteynere bırakın.\nÇöp günü salıdır.",
    });
    expect(stripTopicAbsence({ ...base, reply: "- Çöpler: arkadaki konteyner. Televizyonla ilgili bir bilgim yok.\n- Çöp günü: salı." })).toMatchObject({
      ok: true,
      reply: "- Çöpler: arkadaki konteyner.\n- Çöp günü: salı.",
    });
    expect(stripTopicAbsence({ ...base, reply: `${TRASH}\n\n${TV_ABSENT}\n\nÇöp günü salıdır.` })).toMatchObject({
      ok: true,
      reply: `${TRASH}\n\nÇöp günü salıdır.`,
    });
  });

  it("kodun selam satırı (tablo selamıyla BİREBİR) konu denetiminden muaf, AYNEN kalır; tanınmayan selam muaf değil (Opus P2-b)", () => {
    const base = { answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: trash }], heldDeviceTopics: ["tv"] };
    expect(stripTopicAbsence({ ...base, greetingName: "Alex", reply: `Merhaba Alex,\n\n${TRASH} ${TV_ABSENT}` })).toMatchObject({
      ok: true,
      reply: `Merhaba Alex,\n\n${TRASH}`,
    });
    expect(stripTopicAbsence({ ...base, reply: `Hello,\n\n${TRASH} ${TV_ABSENT}` })).toMatchObject({ ok: true, reply: `Hello,\n\n${TRASH}` });
    // Ad tutmuyor → kodun satırı değil → konusuz satır → bugünkü gibi tutulur.
    expect(stripTopicAbsence({ ...base, greetingName: "Bob", reply: `Merhaba Alex,\n\n${TRASH} ${TV_ABSENT}` })).toEqual({
      ok: false,
      reason: "unanchored_kept",
    });
  });

  it("🚨 kalan metin belirsizlik söylüyorsa TUTULUR (Opus P2-c: bugün yakalanan 'bilgim yok' bu kardeş ifadeleri de tutuyordu)", () => {
    const base = { answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: trash }], heldDeviceTopics: ["tv"] };
    for (const tail of ["toplama gününden ise emin değilim", "toplama gününü kesin olarak söyleyemem", "I CAN'T CONFIRM the pickup day"]) {
      expect(stripTopicAbsence({ ...base, reply: `Çöpleri konteynere bırakabilirsiniz; ${tail}. ${TV_ABSENT}` })).toEqual({
        ok: false,
        reason: "hedged_kept",
      });
    }
  });

  it("kanıt izi `ta` yalnız ayıklama olduysa ve yalnız SAYI (metin yok); verilmezse kanıt biçimi aynı", () => {
    const base = { retrieved: [], usedLabels: ["kb:trash"] };
    expect(JSON.parse(buildKbEvidence({ ...base, topicAbsence: { s: 1, r: 0 } }) ?? "{}").ta).toEqual({ s: 1, r: 0 });
    expect(JSON.parse(buildKbEvidence(base) ?? "{}")).not.toHaveProperty("ta");
    expect(JSON.parse(buildKbEvidence({ ...base, topicAbsence: { s: 0, r: 0 } }) ?? "{}")).not.toHaveProperty("ta");
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
