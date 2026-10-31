import { describe, it, expect } from "vitest";
import { needTerms, stripTopicAbsence } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// Kurucu 10-22 Soru 1 ("önerin çok mantıklı"): cevaplanamayan sorunun hangisi olduğu SABİT konu sözlüğünden değil, anlama katmanının istek
// başına sorgularından (misafirin kendi sözcükleri) okunur. Önce: "What time is checkout, and is there a sauna?" → "sauna" sözlükte yok,
// "bilgim yok" cümlesi bir konuya eşlenemiyor → HİÇBİR ŞEY gitmiyordu. Sonra: "Checkout time is at 11:00." gider, sauna sorusu ev sahibinde açık.
// "Bilgim yok" cümlesi misafire YİNE gitmez; eşlenemeyen yokluk cümlesi bütün cevabı YİNE tutar.
// ---------------------------------------------------------------------------

const checkout = { ref: "R1", topics: topicsWithSymptomsOf("çıkış saati kaçta"), terms: needTerms(["çıkış saati kaçta", "What time is checkout"]) };
const sauna = { ref: "R2", topics: topicsWithSymptomsOf("sauna var mı"), terms: needTerms(["sauna var mı", "is there a sauna"]) };

describe("isteğin kendi sözcükleri — needTerms", () => {
  it("ön koşul: sözlük saunayı tanımıyor (eski hatanın sebebi), istek sözcüğü tanıyor", () => {
    expect(sauna.topics).toEqual([]);
    expect(sauna.terms).toContain("sauna");
  });

  it("genel / yokluk / saat sözcükleri istek sözcüğü sayılmaz", () => {
    expect(needTerms(["Bu konuda bilgi var mı, saat kaçta?"])).toEqual([]);
    expect(needTerms(["I don't have information about the hours"])).toEqual([]);
    expect(needTerms(["15:00'te açık mı"])).toEqual([]);
  });
});

describe("konu bazlı bilgim yok — misafirin sözcükleriyle eşleme", () => {
  it("🚨 KURUCU ÖRNEĞİ (İngilizce): çıkış saati gider, sauna sorusu beyandan düşer (ev sahibinde açık)", () => {
    const out = stripTopicAbsence({
      reply: "Checkout time is at 11:00. I don't have any information about a sauna.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: true, reply: "Checkout time is at 11:00.", answeredRefs: ["R1"], droppedRefs: ["R2"], droppedSentences: 1 });
  });

  it("🚨 KURUCU ÖRNEĞİ (Türkçe): \"Çıkış saati 11:00.\" gider, sauna ev sahibinde", () => {
    const out = stripTopicAbsence({
      reply: "Çıkış saati 11:00. Sauna hakkında bilgim yok.",
      answeredRefs: ["R1"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(out.ok && out.reply).toBe("Çıkış saati 11:00.");
    expect(out.ok && out.answeredRefs).toEqual(["R1"]);
  });

  it("KONTROL: konusu söylenmeyen yokluk cümlesi YİNE hiçbir isteğe bağlanmaz → bütün cevap tutulur (bugünkü gibi)", () => {
    const out = stripTopicAbsence({
      reply: "Checkout time is at 11:00. Unfortunately I don't have that information.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "unattributed" });
  });

  it("KONTROL: düşen isteğin sözcüğü kalan metinde geçiyorsa (yarım cevap) tutulur", () => {
    const out = stripTopicAbsence({
      reply: "Checkout time is at 11:00 and the sauna is next to the pool. I don't have information about sauna prices.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(out.ok).toBe(false);
  });

  it("KONTROL: kalan cümle hiçbir kalan isteğe bağlanmıyorsa (konusuz adım) tutulur", () => {
    const out = stripTopicAbsence({
      reply: "Checkout time is at 11:00. Press the red button twice. I don't have information about a sauna.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "unanchored_kept" });
  });

  it("sözlükte konusu olmayan İKİ istek: cevaplanan (hamam) kendi sözcüğüyle karşılık bulur, bilinmeyen (sauna) düşer", () => {
    const hamam = { ref: "R1", topics: topicsWithSymptomsOf("hamam kaçta kapanıyor"), terms: needTerms(["hamam kaçta kapanıyor"]) };
    const out = stripTopicAbsence({
      reply: "Hamam 22:00'de kapanıyor. Sauna hakkında bilgim yok.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [hamam, sauna],
      heldDeviceTopics: [],
    });
    expect(out.ok && out.reply).toBe("Hamam 22:00'de kapanıyor.");
    expect(out.ok && out.droppedRefs).toEqual(["R2"]);
  });

  it("eski girdi (sözcük alanı yok) davranışı aynen: sözlükte olmayan konu eşlenmez", () => {
    const out = stripTopicAbsence({
      reply: "Checkout time is at 11:00. I don't have any information about a sauna.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [
        { ref: "R1", topics: checkout.topics },
        { ref: "R2", topics: sauna.topics },
      ],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "unattributed" });
  });

  it("Haiku 10-22: gönderime izin veren eşleşme SIKI — 'check' ~ 'checkout' ve 'kapı' ~ 'kapıcı' karşılık sayılmaz", () => {
    const en = stripTopicAbsence({
      reply: "I don't have information about a sauna. Please check with your host.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, sauna],
      heldDeviceTopics: [],
    });
    expect(en.ok).toBe(false);
    const kapici = { ref: "R1", topics: topicsWithSymptomsOf("kapıcı kaçta geliyor"), terms: needTerms(["kapıcı kaçta geliyor"]) };
    const tr = stripTopicAbsence({
      reply: "Kapı şifreniz 4411'dir. Sauna hakkında bilgim yok.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [kapici, sauna],
      heldDeviceTopics: [],
    });
    expect(tr.ok).toBe(false);
  });

  it("Haiku 10-22: Almanca işlev sözcüğü ('gibt') yokluk cümlesini bir isteğe BAĞLAMAZ → tutulur", () => {
    const de = stripTopicAbsence({
      reply: "Der Check-in ist ab 15 Uhr. Dazu gibt es keine Information.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [checkout, { ...sauna, terms: needTerms(["sauna var mı", "gibt es eine Sauna"]) }],
      heldDeviceTopics: [],
    });
    expect(de.ok).toBe(false);
  });

  it("Haiku 10-22: düşen konu kalan metinde ÇEKİMLİ / yumuşamış geçiyorsa (dolap → dolabın, oda → odasında) tutulur", () => {
    const dolap = { ref: "R2", topics: topicsWithSymptomsOf("dolap ölçüleri"), terms: needTerms(["dolap ölçüleri ne"]) };
    const wifi = { ref: "R1", topics: topicsWithSymptomsOf("wifi şifresi"), terms: needTerms(["wifi şifresi"]) };
    const out = stripTopicAbsence({
      reply: "Wi-Fi şifresi Lale2025, modem dolabın içinde. Dolap ölçüleri hakkında bilgim yok.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [wifi, dolap],
      heldDeviceTopics: [],
    });
    expect(out).toEqual({ ok: false, reason: "dropped_topic_kept" });
  });

  it("sıkı eşleşme çekimi tanır: 'sauna' ~ 'saunada' (kalan istek kendi sözcüğüyle karşılık bulur)", () => {
    const hamam = { ref: "R1", topics: [], terms: needTerms(["saunanın saatleri"]) };
    const out = stripTopicAbsence({
      reply: "Saunada havlu var. Jakuzi hakkında bilgim yok.",
      answeredRefs: ["R1", "R2"],
      answerableTopics: [hamam, { ref: "R2", topics: [], terms: needTerms(["jakuzi var mı"]) }],
      heldDeviceTopics: [],
    });
    expect(out.ok && out.reply).toBe("Saunada havlu var.");
  });

  it("uzun girdide doğrusal (karesel iş yok)", () => {
    const long = "sauna ".repeat(20_000);
    const t0 = performance.now();
    needTerms([long, " ".repeat(50_000)]);
    stripTopicAbsence({ reply: `Checkout is at 11:00. ${long} I don't have information.`, answeredRefs: ["R1"], answerableTopics: [checkout], heldDeviceTopics: [] });
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
