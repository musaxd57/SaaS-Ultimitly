import { describe, it, expect } from "vitest";
import { lifeSafetyOf } from "@/lib/ai/life-safety";

// ---------------------------------------------------------------------------
// CAN GÜVENLİĞİ SINIFI (tasarım §3.12, kurucu kararı 10-31 sabah). Can güvenliği → WhatsApp + e-posta ikisi birden hemen; değilse önce
// WhatsApp, 10 dk okunmazsa e-posta. Kurucunun seçtiği kategoriler: yangın / gaz / elektrik + tıbbi + su baskını + mahsur / hırsız / tehdit +
// kategorisiz "ACİL". Kapıda kalma, arıza, şikâyet, para, iptal → standart (acil sözcüğü olsa bile).
// ---------------------------------------------------------------------------

const life = (s: string) => lifeSafetyOf({ texts: [s] }).lifeSafety;

describe("can güvenliği sınıfı", () => {
  it.each([
    "Mutfakta yangın çıktı!", "Gaz kokusu var", "Prizden kıvılcım çıkıyor", "Banyoyu su bastı", "Tavandan su akıyor",
    "Annem düştü başı kanıyor", "Kalp krizi geçiriyor ambulans lazım", "My wife fainted", "I can't breathe", "allergic reaction",
    "Çocuk banyoda kilitli kaldı", "Asansörde mahsur kaldık", "We are stuck in the elevator", "Biri kapıyı zorluyor", "Hırsız girdi",
    "Someone broke in", "There is an intruder", "Komşu bizi tehdit ediyor", "Police!", "ACİL!!! lütfen hemen ulaşın", "Help!", "Emergency, call me",
    "Annem bayıldı", "Es brennt in der Wohnung", "Il y a le feu", "Hay fuego en la cocina", "У нас пожар", "حريق في الشقة",
  ])("İKİSİ BİRDEN: %s", (s) => {
    expect(life(s)).toBe(true);
  });

  it.each([
    "ACİL klima çalışmıyor", "Acil iade istiyorum", "Anahtarı kaybettik kapıda kaldık", "Kilitli kaldık dışarıda", "We are locked out",
    "Kapı kodu çalışmıyor acil", "ACİL kapıda kaldık", "Anahtar içeride kaldı, kapıda kaldık", "Keys are locked inside, we are locked out",
    "Wifi çalışmıyor", "İade istiyorum", "Ödemeyi havaleyle yapabilir miyim?", "Ev sahibiyle görüşmek istiyorum", "Klima çalışmıyor",
    "Robot süpürge çalışmıyor", "Is there a robot vacuum?", "Ворота не открываются", "Je suis coincé dehors",
  ])("ÖNCE WHATSAPP: %s", (s) => {
    expect(life(s)).toBe(false);
  });

  it("turun BÜTÜN misafir metinlerine bakılır (yalnız son mesaja değil); anlama katmanının 'acil' hükmü tek başına yeter", () => {
    expect(lifeSafetyOf({ texts: ["Mutfakta duman var", "Bir de wifi şifresi?"] })).toMatchObject({ lifeSafety: true, basis: "hazard" });
    expect(lifeSafetyOf({ texts: ["Klima çalışmıyor"], understandingEmergency: true })).toEqual({ lifeSafety: true, basis: "understanding" });
    expect(lifeSafetyOf({ texts: ["Klima çalışmıyor"], understandingEmergency: false })).toEqual({ lifeSafety: false, basis: "none" });
    expect(lifeSafetyOf({ texts: [] })).toEqual({ lifeSafety: false, basis: "none" });
  });

  it("aynı sınıflayıcı art arda çağrılınca aynı hükmü verir (genel kalıbın durum taşıması yok)", () => {
    for (let i = 0; i < 3; i++) {
      expect(life("Help!")).toBe(true);
      expect(life("ACİL klima çalışmıyor")).toBe(false);
    }
  });
});
