import { describe, it, expect } from "vitest";
import { personDangerOf } from "@/lib/ai/person-danger";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";
import { detectRiskType, isSafetyEmergencyText } from "@/lib/ai/fallback";
import { lifeSafetyOf } from "@/lib/ai/life-safety";
import { detectOperationalTask } from "@/lib/tasks/detect";

// ---------------------------------------------------------------------------
// DEVAM EDEN KİŞİSEL TEHLİKE (kurucu 10-31, `docs/TASARIM-2026-10-31-devam-eden-tehlike-uyarisi.md`). "Asansörde mahsur kaldık", "biri
// kapıyı zorluyor", "bizi tehdit ediyor" uyarı üretmeli; "tek başına kelime eklemek doğru çözüm olmaz" → varsayım / soru / önlem / olumsuz /
// birinci kişi ayrılır.
// ---------------------------------------------------------------------------

describe("kurucunun tablosu", () => {
  it.each([
    ["Asansörde kaldık, çıkamıyoruz.", "clear"],
    ["Biri kapıyı zorluyor!", "clear"],
    ["Hırsızlığa karşı kasa var mı?", "none"],
    ["Asansörde mahsur kalırsak kimi arayacağız?", "none"],
  ] as const)("%s → %s", (msg, level) => {
    expect(personDangerOf(msg).level).toBe(level);
  });
});

describe("yedi dilde açık bildirim (clear)", () => {
  it.each([
    ["Asansörde mahsur kaldık!", "trapped"],
    ["Bizi tehdit ediyor", "threat"],
    ["Biri içeri girdi!", "intrusion"],
    ["Hırsız girdi evimize", "intrusion"],
    ["Asansör durdu ve içindeyiz", "trapped"],
    ["We're stuck in the lift", "trapped"],
    ["Someone is trying to break in!", "intrusion"],
    ["Oh no, someone is breaking in!", "intrusion"],
    ["Wir stecken im Aufzug fest", "trapped"],
    ["Jemand bricht hier ein!", "intrusion"],
    ["Quelqu'un force la porte", "intrusion"],
    ["Alguien está forzando la puerta", "intrusion"],
    ["Nos están amenazando", "threat"],
    ["Застряли в лифте", "trapped"],
    ["Нам угрожают", "threat"],
    ["Мне угрожают соседи", "threat"],
    ["عالقون في المصعد", "trapped"],
    ["شخص يحاول كسر الباب", "intrusion"],
    ["Ne yapalım, biri kapıyı zorluyor", "intrusion"],
    ["Ne yapalım biri kapıyı zorluyor", "intrusion"],
    ["Someone is breaking in, please help if you can", "intrusion"],
  ] as const)("%s", (msg, kind) => {
    expect(personDangerOf(msg)).toEqual({ level: "clear", kinds: [kind] });
  });
});

describe("olası — kararı model verir, model yoksa uyarı", () => {
  it.each([
    "Kapıyı mı zorluyorlar?",
    "Is someone trying to break in?",
    "Dün gece biri kapıyı zorladı",
  ])("%s", (msg) => {
    expect(personDangerOf(msg).level).toBe("possible");
  });
});

describe("uyarı DEĞİL", () => {
  it.each([
    // varsayım / koşul
    "What if someone breaks in?",
    "Eğer biri içeri girerse ne yapmalıyız?",
    "Asansörde mahsur kaldıysak kimi arayalım?",
    // birinci kişi (kapıda kalan misafirin kendisi)
    "Kapıyı zorluyorum ama açılmıyor",
    "Kapıyı zorladık, anahtar kırıldı",
    "We had to force the door open",
    // olumsuz
    "Kimse kapıyı zorlamıyor",
    "Nobody is breaking in, relax",
    "He is not threatening us",
    // bilgi sorusu / önlem / isim
    "Asansör var mı?",
    "Bu bölgede hırsız var mı?",
    "Hırsızlığa karşı alarm var mı?",
    // mecaz / böcek / hava / başka anlam
    "Sivrisinekler bize saldırdı",
    "Mücken greifen uns an",
    "The weather looks threatening",
    "My friend is threatening to leave early",
    // ev sahibi talimatı ve alıntı
    "Kapıyı zorlamayın lütfen",
    '"someone is breaking in" yazmışlar yorumda',
    "",
  ])("%s", (msg) => {
    expect(personDangerOf(msg).level).toBe("none");
  });
});

describe("tehlike okuyucusuna ve acil yollarına bağlantı", () => {
  it("🚨 tehlike okuyucusu kişisel tehlikeyi taşır (QR hızlı yolu + kanal uyarı geçişi bunu okur)", () => {
    expect(hazardEvidenceOf("Biri kapıyı zorluyor!")).toEqual({
      level: "clear",
      kinds: ["intrusion"],
    });
    expect(hazardEvidenceOf("Kapıyı mı zorluyorlar?").level).toBe("possible");
    expect(
      hazardEvidenceOf("Asansörde mahsur kalırsak kimi arayacağız?").level,
    ).toBe("none");
    // Fiziksel tehlike ile birlikte: ikisi de
    expect(
      hazardEvidenceOf(
        "Biri kapıyı zorluyor! Mutfakta yangın çıktı!",
      ).kinds.sort(),
    ).toEqual(["fire", "intrusion"]);
  });
  it("🚨 kelime risk etiketi: açık bildirim acil (oto-yanıt durur, model geçersiz kılamaz); soru / varsayım değil", () => {
    expect(detectRiskType("Biri kapıyı zorluyor!")).toBe("safety_emergency");
    expect(detectRiskType("Asansörde kaldık, çıkamıyoruz.")).toBe(
      "safety_emergency",
    );
    expect(detectRiskType("Hırsızlığa karşı kasa var mı?")).not.toBe(
      "safety_emergency",
    );
    expect(
      detectRiskType("Asansörde mahsur kalırsak kimi arayacağız?"),
    ).not.toBe("safety_emergency");
    // Acil sözcük ağının KENDİSİ değişmedi (çağıranları çok — görev, ad maskesi, geçmişten öğren).
    expect(isSafetyEmergencyText("Biri kapıyı zorluyor!")).toBe(false);
  });
  it("🚨 can güvenliği: e-posta + WhatsApp hemen (kapıda kalma yan cümlesi kişisel tehlikeyi gizlemez)", () => {
    expect(lifeSafetyOf({ texts: ["Biri kapıyı zorluyor!"] }).lifeSafety).toBe(
      true,
    );
    expect(
      lifeSafetyOf({
        texts: ["Perdí la llave. Alguien está forzando la puerta"],
      }).lifeSafety,
    ).toBe(true);
  });
  it("kişisel tehlike bakım görevi AÇMAZ (bugünkü davranış — 'acil güvenlik' bakım görevi değil)", () => {
    expect(detectOperationalTask("Biri kapıyı zorluyor!", {})).toBeNull();
    expect(detectOperationalTask("Bizi tehdit ediyor", {})).toBeNull();
  });
});
