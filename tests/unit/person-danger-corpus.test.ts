import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { personDangerOf } from "@/lib/ai/person-danger";

// ---------------------------------------------------------------------------
// Kişisel tehlike GELİŞTİRME seti (Sonnet incelemesi 10-31: ilk sürüm 174 gerçek mesajdan 73'ünü kaçırıyor, 9 sınıf yanlış alarm veriyordu).
// AÇIK bildirim (açık düzey) ve açık OLMAMASI gerekenler (varsayım, olumsuz, birinci kişi, aktarım, iş gereği zorlama, ceza "tehdidi", bitmiş
// olay, bilgi sorusu). Kör set ayrı yazarla: `person-danger-blind.test.ts`.
// ---------------------------------------------------------------------------

const SHOULD_CLEAR: string[] = [
 "Asansörde kaldık, çıkamıyoruz.","Biri kapıyı zorluyor!","Bizi tehdit ediyor","Asansörde mahsur kaldık!","Biri içeri girdi!","Hırsız girdi evimize","Asansör durdu ve içindeyiz",
 "We're stuck in the lift","Someone is trying to break in!","Oh no, someone is breaking in!","Wir stecken im Aufzug fest","Jemand bricht hier ein!","Quelqu'un force la porte",
 "Alguien está forzando la puerta","Nos están amenazando","Застряли в лифте","Нам угрожают","Мне угрожают соседи","عالقون في المصعد","شخص يحاول كسر الباب",
 "Ne yapalım, biri kapıyı zorluyor","Ne yapalım biri kapıyı zorluyor","Someone is breaking in, please help if you can",
 "biri kapiyi zorluyor hemen gelmezseniz polisi arayacağım","Asansörde kaldık yardım etmezseniz şikayet ederim","Not sure if you read this — someone is trying to break in!",
 "I don't know if you are there - someone is breaking in","içeride yabancı biri var","Odamızda yabancı biri var","adam bizi bıçakla tehdit ediyor","bıçakla tehdit etti","silahla tehdit ediyor",
 "biri kapıyı zorluyo","biri kapıyı zorlamaya çalışıyor","kapıyı zorlayan biri var","kapımızı zorluyorlar","kapımızı kırmaya çalışıyorlar","kapıyı tekmeliyor biri","biri kapıyı kırdı",
 "asansör arızalandı içindeyiz","Asansör takıldı biz içindeyiz","Asansör durdu, içindeyiz","pencereden biri girdi","balkondan biri girdi",
 "someone has broken into the apartment","someone is in our apartment","someone is trying to enter","a guy is trying to force our door","Someone just kicked the door",
 "I'm locked in the bathroom","we're locked in the apartment and can't get out","the door won't open and we're trapped inside","he threatened to kill us",
 "Jemand bricht gerade in unsere Wohnung ein","Es ist jemand in der Wohnung","Der Aufzug steckt fest, wir sind drin","Im Aufzug sind wir stecken geblieben",
 "Quelqu'un essaie de forcer la porte","Il tente de forcer la porte","Il y a quelqu'un dans l'appartement","On nous a cambriolés",
 "Alguien intenta forzar la puerta","Hay alguien dentro del apartamento","Han entrado en el piso","Кто-то пытается взломать дверь","В квартире кто-то есть","Нас заперли в лифте",
 "Лифт застрял, мы внутри","Он угрожает нам ножом","علقنا في المصعد","شخص يحاول اقتحام الشقة","BIRI KAPIYI ZORLUYOR","Help! we are trapped in the lift - can you send help?",
 "Alguien está forzando mi puerta","Biri kapıyı zorluyor! Lütfen yardım edin, ne yapalım?",
];
const SHOULD_NOT_CLEAR: string[] = [
 "Hırsızlığa karşı kasa var mı?","Asansörde mahsur kalırsak kimi arayacağız?","What if someone breaks in?","Eğer biri içeri girerse ne yapmalıyız?","Asansörde mahsur kaldıysak kimi arayalım?",
 "Kapıyı zorluyorum ama açılmıyor","Kapıyı zorladık, anahtar kırıldı","We had to force the door open","Kimse kapıyı zorlamıyor","Nobody is breaking in, relax","He is not threatening us",
 "Asansör var mı?","Bu bölgede hırsız var mı?","Hırsızlığa karşı alarm var mı?","Sivrisinekler bize saldırdı","Mücken greifen uns an","The weather looks threatening",
 "My friend is threatening to leave early","Kapıyı zorlamayın lütfen",'"someone is breaking in" yazmışlar yorumda',"Asansörde mahsur kalma durumunda kimi arayacağız",
 "Asansörde mahsur kalınca ne yapılır","Asansörde mahsur kaldığımızda kimi arayalım","Should we get stuck in the elevator, who do we call","Imagine someone is breaking in",
 "Biz asansörde mahsur kalmadık","Yorumlarda biri kapıyı zorladı yazıyordu, doğru mu?","Reviews mention we were robbed","The reviewer said they were trapped in the lift",
 "Önceki misafirler asansörde mahsur kalmış","Çilingir kapıyı zorluyor","Polis kapıyı zorluyor","Rüzgar kapıyı zorluyor","Ev sahibi bizi ceza ile tehdit ediyor","Airbnb bizi tehdit ediyor",
 "Biz asansörde kaldık ama kurtulduk","Evde hırsız var mı?","Asansörde mahsur kalan olmuş mu hiç?","Has anyone ever been trapped in the elevator?",
 "Do you have a safe against thieves?","If the elevator gets stuck what do we do?","Is the building safe from break-ins?","Last year people broke into the apartment",
 "Kapıyı mı zorluyorlar?","Is someone trying to break in?","Dün gece biri kapıyı zorladı",
];

describe("geliştirme seti", () => {
  it.each(SHOULD_CLEAR)("AÇIK: %s", (msg) => {
    expect(personDangerOf(msg).level).toBe("clear");
  });
  it.each(SHOULD_NOT_CLEAR)("açık DEĞİL: %s", (msg) => {
    expect(personDangerOf(msg).level).not.toBe("clear");
  });
});

// ---------------------------------------------------------------------------
// Kör setler #1, #2, #3 (ayrı yazarlar, 7 dil × 26–30): İLK ölçümleri 52/105, 69/105, 75/105 yakalama + 2/77, 7/105, 5/105 yanlış alarmdı; ardından genel
// sınıflar eklendi (artık "görülmüş" — yalnız gerileme pini; tarafsız ölçüm yeni kör setle, `docs/TASARIM-2026-10-31-devam-eden-tehlike-uyarisi.md`).
// Pin: yanlış alarm 0 (açık tehlike sanılıp ev sahibine acil uyarı + oto-yanıt durması); yakalama ölçülen düzeyin altına inmez.
// ---------------------------------------------------------------------------
type SetItem = { l: string; t: string };
const seenSet = (n: number) =>
  JSON.parse(readFileSync(join(process.cwd(), `tests/fixtures/person-danger/seen-set-${n}.json`), "utf8")) as { clear: SetItem[]; notClear: SetItem[] };

describe.each([
  [1, 93],
  [2, 93],
  // #3 tarafsız ölçüm (10-31): yakalama 75/105 — bu sete bakılarak yakalama AYARLANMADI; yalnız 5 yanlış alarm sınıfı (deyim, başka şehirde
  // geçmiş olay, içeri hava girmesi, dizi izleme) genel kuralla kapatıldı.
  [3, 75],
] as const)("görülmüş kör set #%i", (n, minRecall) => {
  const set = seenSet(n);
  it("yanlış AÇIK yok", () => {
    expect(set.notClear.filter((x) => personDangerOf(x.t).level === "clear").map((x) => x.t)).toEqual([]);
  });
  it(`yakalama en az ${minRecall}/${set.clear.length}`, () => {
    expect(set.clear.filter((x) => personDangerOf(x.t).level === "clear").length).toBeGreaterThanOrEqual(minRecall);
  });
});
