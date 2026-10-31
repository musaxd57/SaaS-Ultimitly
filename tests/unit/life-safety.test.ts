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
    // İnceleme 10-31: asansör (sıra serbest, 7 dil), Rusça çoğul, aksanlı yazım, Arapça tanım edatı, yaralanma, "acil + ev sahibi".
    "Мы застряли в лифте", "застряла в лифте", "We are stuck in an elevator", "The lift is stuck and we are inside", "Wir stecken im Aufzug fest",
    "Nous sommes bloqués dans l'ascenseur", "Estamos atrapados en el ascensor", "Il s'est évanoui", "Mi madre está herida", "Está sangrando mucho",
    "URGENT my wife fell in the shower and broke her leg, I need to talk to the host", "اللص دخل الشقة", "تعرضنا للتهديد", "لدي الحساسية",
    "My son is bleeding", "She broke her arm", "ACİL, ev sahibiyle hemen görüşmem lazım",
    // Kapıda kalma öteki tehlike sözünü gizlemez (yan cümle ayrımı).
    "Anahtarı kaybettik, ambulans lazım", "We are locked out, call an ambulance", "locked out, my child is alone inside and not breathing",
  ])("İKİSİ BİRDEN: %s", (s) => {
    expect(life(s)).toBe(true);
  });

  it.each([
    "ACİL klima çalışmıyor", "Acil iade istiyorum", "Anahtarı kaybettik kapıda kaldık", "Kilitli kaldık dışarıda", "We are locked out",
    "Kapı kodu çalışmıyor acil", "ACİL kapıda kaldık", "Anahtar içeride kaldı, kapıda kaldık", "Keys are locked inside, we are locked out",
    "Wifi çalışmıyor", "İade istiyorum", "Ödemeyi havaleyle yapabilir miyim?", "Ev sahibiyle görüşmek istiyorum", "Klima çalışmıyor",
    "Robot süpürge çalışmıyor", "Is there a robot vacuum?", "Ворота не открываются", "Je suis coincé dehors",
    "Anahtarı kaybettik, içeri giremiyoruz", "Lost the key, can't get in", "Lost the key. Help, we can't get inside!", "Ich habe mich ausgesperrt",
    "Perdimos la llave, no podemos entrar", "Мы потеряли ключ, не можем войти", "Wir haben den Schlüssel verloren und kommen nicht rein",
    "Kilitli kaldık dışarıda, lütfen yardım edin", "URGENT: I want to talk to the host about a refund", "Is there an elevator?", "ملص",
    "Asansör var mı, kaçıncı kat?",
  ])("ÖNCE WHATSAPP: %s", (s) => {
    expect(life(s)).toBe(false);
  });

  it("turun BÜTÜN misafir metinlerine bakılır (yalnız son mesaja değil); anlama katmanının 'acil' hükmü tek başına yeter", () => {
    expect(lifeSafetyOf({ texts: ["Mutfakta duman var", "Bir de wifi şifresi?"] })).toMatchObject({ lifeSafety: true, basis: "hazard" });
    expect(lifeSafetyOf({ texts: ["Klima çalışmıyor"], understandingEmergency: true })).toEqual({ lifeSafety: true, basis: "understanding" });
    expect(lifeSafetyOf({ texts: ["Klima çalışmıyor"], understandingEmergency: false })).toEqual({ lifeSafety: false, basis: "none" });
    expect(lifeSafetyOf({ texts: [] })).toEqual({ lifeSafety: false, basis: "none" });
    // Tehlike SONRAKİ metinde (ilk metin sıradan): yine can güvenliği.
    expect(lifeSafetyOf({ texts: ["Bir de wifi şifresi?", "Mutfakta duman var"] })).toMatchObject({ lifeSafety: true, basis: "hazard" });
  });

  it("uzun mesajda tehlike baştaki 8.000 karakterin içindeyse bulunur (yalnız ilk satır değil); sonrası okunmaz (süre sınırı)", () => {
    const pad = "Merhaba, konaklamamız çok güzel geçiyor. ".repeat(20);
    expect(pad.length).toBeGreaterThan(500);
    expect(lifeSafetyOf({ texts: [`${pad}Mutfakta gaz kokusu var!`] }).lifeSafety).toBe(true);
    expect(lifeSafetyOf({ texts: [`${"a ".repeat(4_100)}Mutfakta gaz kokusu var!`] }).lifeSafety).toBe(false);
  });

  it("aynı sınıflayıcı art arda çağrılınca aynı hükmü verir (genel kalıbın durum taşıması yok)", () => {
    for (let i = 0; i < 3; i++) {
      expect(life("Help!")).toBe(true);
      expect(life("ACİL klima çalışmıyor")).toBe(false);
    }
  });
});
