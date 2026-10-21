import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// "BİLGİM YOK" MİSAFİRE ASLA GİTMEZ (kurucu kuralı 09-11) — 15 ajan incelemesi A05 (10-01, ölçüldü): doğal itiraf biçimleri ve biçim
// (kalın yazı, çift boşluk, satır sonu) kapıdan geçiyordu. Aynı dilbilgisi: 1. şahıs / bilgi nesnesi / bilginin yeri çapalı; belirsizlik
// ("I'm unsure") ve savuşturma BİLEREK dışarıda. Külliyat (docs/olcum, 3.031 gerçek 5.1 / Luna cevabı): yeni tutuş 6 — hepsi gerçek
// "… hakkında bilgi veremiyorum" itirafı; düşen 0.
// ---------------------------------------------------------------------------

const ADMITS: readonly string[] = [
  // biçim
  "Unfortunately, I **don't have** that information.",
  "Unfortunately, I don't  have that information.",
  "Unfortunately I do not\nhave that information.",
  "Unfortunately, I don't have `that information`.",
  // EN
  "I don't know what time the pool opens.",
  "I'm afraid I don't know whether the building has a gym.",
  "I have no idea if there is a pharmacy nearby.",
  "I'm not aware of any parking options near the building.",
  "That's not something I have information on.",
  "I don't have that on file.",
  "There's nothing about parking in my notes.",
  "My notes don't mention a hairdryer.",
  "That detail isn't in the guide.",
  "The guide doesn't cover the dishwasher.",
  "I lack information about the jacuzzi.",
  "There aren't any details about parking.",
  "There isn't any information about the pool in my notes.",
  // TR
  "Bu bilgi maalesef elimde yok.",
  "Ne yazık ki bu konuda bir bilgi şu an elimde yok.",
  "Bu konuda bilgi verilmemiş.",
  "Kayıtlarda bu konuya değinilmemiş.",
  "Bu konuda maalesef bilgi sahibi değilim.",
  "Bunu bilemiyorum, ev sahibinize sorabilirsiniz.",
  "Bu konuda bir fikrim yok.",
  "Bundan haberim yok.",
  "Kayıtlarımda bu bilgiye rastlamadım.",
  "Rehberde bununla ilgili bir şey yok.",
  "Bilmiyoruz maalesef.",
  "Bu konuda kesin bilgi veremiyorum.",
  "Bu bilgi bende de yok.",
  // DE
  "Diese Information liegt mir leider nicht vor.",
  "Das ist mir leider nicht bekannt.",
  "Ich kenne die Öffnungszeiten nicht.",
  "Ich habe dazu keine Info.",
  "Dazu habe ich keine Auskunft.",
  "Leider kann ich Ihnen dazu nichts sagen.",
  "Dazu kann ich leider keine Auskunft geben.",
  // FR
  "Je n'ai aucune idée de l'horaire de la piscine.",
  "Cette information ne m'est pas connue.",
  "Je ne connais pas les horaires de la piscine.",
  "Je ne dispose d'aucune information à ce sujet.",
  "Je ne dispose d'aucune information sur la piscine.",
  "Malheureusement, pas d'information à ce sujet.",
  "Aucune information à ce sujet, désolé.",
  // ES
  "No me consta.",
  "No tengo constancia de ello.",
  "Desconozco el horario de la piscina.",
  // RU
  "Информации об этом нет.",
  "Информации нет.",
];

const LEGIT: readonly string[] = [
  "Let me know if you need anything else.",
  "Did you know the beach is only 5 minutes away?",
  "You don't know the door code? It's in the welcome message.",
  "We don't have a dishwasher, but there is a sink.",
  "There isn't any extra charge for parking.",
  "The guide covers parking on page 2.",
  "I'm sure you'll love the terrace.",
  "Bilgi için teşekkürler, giriş 15:00'te.",
  "Haberiniz olsun, havuz yarın kapalı.",
  "Fikriniz var mı, kahvaltıyı nerede yapmak istersiniz?",
  "Size bilgi vereyim, havuz 09:00'da açılıyor.",
  "Bu konuyla ilgili bir sorun yok, rahat olun.",
  "Ich weiß, dass Sie spät ankommen; der Code ist 1234.",
  "Ich kenne mich in der Gegend gut aus.",
  "Sie kennen den Code nicht? Er steht in der Nachricht.",
  "Je connais bien le quartier.",
  "Информация есть в папке на столе.",
  "Нет, курить нельзя.",
];

describe("A05 — 'bilgim yok' kapısı açıkları kapandı", () => {
  it.each(ADMITS)("🚨 itiraf tutulur: %j", (cevap) => {
    expect(admitsMissingKnowledge(cevap)).toBe(true);
  });

  it.each(LEGIT)("KONTROL — itiraf değil, gider: %j", (cevap) => {
    expect(admitsMissingKnowledge(cevap)).toBe(false);
  });
});

describe("Claude 2. dalga #69 (10-21): virgüller arasındaki yumuşatma sözcüğü 'bilgim yok'u gizlemez", () => {
  it.each(["Bu konuda bilgim, maalesef, yok.", "I don't have, unfortunately, any information about that."])("tutulur: %s", (m) => {
    expect(admitsMissingKnowledge(m)).toBe(true);
  });
  it.each(["Havuz, maalesef, 20:00'de kapanıyor.", "Unfortunately, the pool closes at 20:00, sadly, for everyone."])(
    "KONTROL — bilgi veren cümle tutulmaz: %s",
    (m) => {
      expect(admitsMissingKnowledge(m)).toBe(false);
    },
  );
  it("uzun virgül / boşluk dizisinde karesel iş yok", () => {
    const t0 = performance.now();
    admitsMissingKnowledge(`bilgim${", maalesef".repeat(5000)}, yok ${" ,".repeat(20000)}`);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
