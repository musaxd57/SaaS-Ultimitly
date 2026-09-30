import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, detectRiskTypes } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// KISA ACİL SÖZCÜKLERİ TAM SÖZCÜK (kurucu onayı 09-26, #51). Alt dize eşleşmesi canlıda yanlış acil üretiyordu: Almanca
// "Gastgeber" (ev sahibi) içindeki "gas", "fireplace" içindeki "fire", ASCII katlamada "açılıyor" → "acilıyor" içindeki
// "acil". Sonuç: bu mesajlara hiç otomatik cevap gitmiyor + acil rozeti. İKİ YÖNLÜ: gerçek acil (tam sözcük + bileşik
// listesi) AYNEN yakalanır.
// ---------------------------------------------------------------------------

const FALSE_ALARMS: [string, string][] = [
  ["Ich möchte mit dem Gastgeber sprechen.", "DE ev sahibi"],
  ["Danke an den Gastgeber, alles super!", "DE ev sahibine teşekkür"],
  ["Die Gastfreundschaft war toll.", "DE misafirperverlik"],
  ["Is the fireplace working?", "EN şömine"],
  ["Is there a firework show tonight?", "EN havai fişek"],
  ["Havuz ne zaman açılıyor?", "TR açılıyor (ASCII açıl→acil)"],
  ["Sauna kaçta açılıyor?", "TR açılıyor"],
  ["Kapı kolayca açıldı, teşekkürler.", "TR açıldı"],
  ["The facilities are great.", "EN facilities"],
  ["C'est facile, merci.", "FR facile"],
  // Onay paketi `docs/ONAY-acil-asci-carpismasi-2026-09-10.md` satırları + ASCII yazım + "acılı" (baharatlı).
  ["Market kaçta açılıyor?", "TR onay paketi"],
  ["Kahvaltı açılış saati nedir?", "TR açılış"],
  ["Balkon kapısı açılır mı?", "TR açılır"],
  ["What facilities does the apartment have?", "EN facilities soru"],
  ["Are there laundry facilities nearby?", "EN facilities yakın"],
  ["Es muy fácil llegar?", "ES fácil"],
  ["Havuz ne zaman acilir?", "TR ASCII açılır"],
  ["Kapi acildi tesekkurler", "TR ASCII açıldı (acildi BİLEREK listede yok)"],
  ["Acılı yemek önerir misiniz?", "TR acılı (acili BİLEREK listede yok)"],
  ["We had a campfire, lovely", "EN campfire"],
  ["Die Gasse ist ruhig", "DE Gasse (gas + e)"],
  // Türkçe "gaz" (ikinci onay 09-26): mağaza / yer adları / gazete / gazoz / doğalgaz faturası.
  ["Yakında bir mağaza var mı?", "TR mağaza"],
  ["Mağazalar kaçta kapanıyor?", "TR mağazalar"],
  ["Gazipaşa havalimanından nasıl gelirim?", "TR Gazipaşa"],
  ["Gaziantep'ten geliyoruz", "TR Gaziantep"],
  ["Gazi Mahallesi'ne yakın mı?", "TR Gazi (gazi BİLEREK listede yok)"],
  ["Gazete bırakıyor musunuz?", "TR gazete"],
  ["Gazoz var mı buzdolabında?", "TR gazoz"],
  ["Yakında gazino var mı?", "TR gazino"],
  ["Doğalgaz faturası kimde?", "TR doğalgaz tek başına"],
  ["Kombi doğalgazla mı çalışıyor?", "TR doğalgazla"],
];

const TRUE_EMERGENCIES: [string, string][] = [
  ["I smell gas in the kitchen", "EN gas"],
  ["There is a gas leak!", "EN gas leak"],
  ["GAS! Please help", "EN büyük harf"],
  ["Es riecht nach Gas", "DE Gas tam sözcük"],
  ["Starker Gasgeruch in der Küche", "DE bileşik Gasgeruch"],
  ["Wir haben ein Gasleck!", "DE bileşik Gasleck"],
  ["Fire in the kitchen!", "EN fire"],
  ["The apartment is on fire", "EN on fire"],
  ["Should I call the firefighters?", "EN firefighters"],
  ["ACİL! Su her yeri bastı", "TR ACİL büyük harf"],
  ["Acil durum var, lütfen arayın", "TR acil durum"],
  ["Acilen gelir misiniz?", "TR acilen"],
  ["acil yardim lazim", "TR ASCII yazım"],
  // Alt dize eşleşmesinin tuttuğu biçimler GERİLEMESİN: Türkçe ad çekimleri + uzatılmış yazım + çoğul/bileşik.
  ["Acile gittik, lütfen arayın", "TR acile"],
  ["Acilde bekliyoruz", "TR acilde"],
  ["acilden döndük", "TR acilden"],
  ["Aciliyeti var lütfen", "TR aciliyeti"],
  ["Bu acildir!", "TR acildir"],
  ["çok acil", "TR çok acil"],
  ["ACİLLL YARDIM", "TR uzatılmış"],
  ["FIREEE", "EN uzatılmış"],
  ["gasss smell here", "EN uzatılmış gas"],
  ["There are wildfires near the house", "EN wildfires"],
  ["fires nearby!", "EN fires"],
  // ASCII katlama ı/i yazım hatasını da tutar (standart katlama tutmazdı).
  ["Acıl durum var, yardım edin", "TR ı/i yazım hatası"],
  // Türkçe / Fransızca "gaz" gerçek acil AYNEN (ikinci onay 09-26).
  ["Gaz kokusu var!", "TR gaz kokusu"],
  ["gaz kokuyo", "TR ağız yazımı"],
  ["Gaz kaçağı var galiba", "TR gaz kaçağı"],
  ["Evde gaz sızıntısı var", "TR gaz sızıntısı"],
  ["Gazdan zehirlendik sanırım", "TR gazdan"],
  ["Gazın kokusu odaya yayıldı", "TR gazın"],
  ["Gazda bir sorun var sanki", "TR gazda"],
  // ("… kaçak yapıyor" biçimi zaten elektrik kaçağı kalıbına takılır; bu satırlar yalnız "kaçak" girdisini sınar.)
  ["Mutfakta doğalgaz kaçak var gibi", "TR doğalgaz kaçak"],
  ["Doğalgaz sızıntısı var", "TR doğalgaz sızıntı"],
  ["Tüpgaz kaçağı olabilir", "TR tüpgaz kaçağı"],
  ["Tüpgaz kaçak var galiba", "TR tüpgaz kaçak"],
  ["Doğal gaz kokusu var", "TR iki sözcük doğal gaz"],
  ["Doğalgaz kokuyor", "TR doğalgaz + koku"],
  ["Dogalgaz kacagi var", "TR ASCII doğalgaz kaçağı"],
  ["Tüpgaz kokusu geliyor", "TR tüpgaz + koku"],
  ["GAAAZ KOKUSU", "TR uzatılmış gaz"],
  ["Il y a une odeur de gaz dans la cuisine", "FR gaz"],
];

describe("kısa acil sözcükleri — tam sözcük", () => {
  for (const [m, why] of FALSE_ALARMS) {
    it(`yanlış alarm YOK: ${why} — "${m}"`, () => {
      expect(detectRiskTypes(m)).not.toContain("safety_emergency");
    });
  }
  for (const [m, why] of TRUE_EMERGENCIES) {
    it(`gerçek acil AYNEN: ${why} — "${m}"`, () => {
      expect(detectRiskType(m)).toBe("safety_emergency");
    });
  }
  it("büyük/küçük harf ve Türkçe büyük İ fark etmez (üç katlama adayı)", () => {
    for (const m of ["ACIL", "ACİL", "acil", "Acil", "GAS", "Fire", "ACİLEN"]) expect(detectRiskType(m)).toBe("safety_emergency");
  });
  it("aşırı uygulama yok: kapı açılmıyor ŞİKÂYET olarak tutulmaya devam eder (acil etiketi yerine)", () => {
    expect(classifyFallback("Kapı açılmıyor, kod çalışmıyor.").isComplaint).toBe(true);
    expect(detectRiskType("Kapı açılmıyor, kod çalışmıyor.")).toBe("complaint");
  });
});

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — ACİL AĞI DARALTMA + YANGIN İFADELERİ. "kaza / polis / hurt" alt dize yerine TAM SÖZCÜK + gerçek
// çekimler; çıkış YERİ sorusu ("Emergency exit nerede?") tek başına acil değil; "Çocuğun ateşi var" yangın DEĞİL (sağlık ayrı).
// Kurucunun örnekleri birebir burada. İKİ YÖNLÜ: her yanlış alarmın yanında gerçek acil ikizi.
// ---------------------------------------------------------------------------
const DECISION_0930_FALSE: [string, string][] = [
  ["Kazağımı unuttum", "kurucu örneği: kazak"],
  ["Kazandık! Harika bir tatildi", "TR kazanmak"],
  ["Kombi kazanı ses yapıyor", "TR kazan (kombi)"],
  ["Polisiye kitap var mı?", "TR polisiye"],
  ["Metropolis sineması nerede?", "EN metropolis"],
  ["It wouldn't hurt to ask for extra towels", "EN deyim wouldn't hurt"],
  ["It wouldn’t hurt to ask", "EN kıvrık kesme işareti"],
  ["I'm not hurt, just asking about the gym", "EN not hurt"],
  ["Emergency exit nerede?", "kurucu örneği: çıkış yeri"],
  ["Acil çıkış nerede?", "TR acil çıkış yeri"],
  ["ACİL ÇIKIŞ NEREDE?", "TR büyük harf"],
  ["Where is the fire exit?", "EN fire exit"],
  ["Yangın merdiveni hangi tarafta?", "TR yangın merdiveni yeri"],
  ["Çocuğun ateşi var, yakında eczane var mı?", "kurucu örneği: ateş = yüksek ateş, yangın değil"],
  ["Mangal ateşi nasıl yakılır?", "TR mangal ateşi"],
  ["Alev Hanım yarın gelecek", "TR ad: Alev"],
];
const DECISION_0930_TRUE: [string, string][] = [
  ["Kaza yaptık, yardım gerekiyor", "kurucu örneği: kaza"],
  ["Kazada yaralandık", "TR kazada"],
  ["Trafik kazası geçirdik, gelemiyoruz", "TR kazası"],
  ["Kazaya karıştık", "TR kazaya"],
  ["Polisi aradık, kapıda biri var", "TR polisi"],
  ["Polis geldi", "TR polis"],
  ["Polise haber verin lütfen", "TR polise"],
  ["My son is hurt", "EN hurt"],
  ["My back hurts badly, I fell", "EN hurts"],
  ["He is hurting a lot", "EN hurting"],
  ["Doesn't hurt? It hurts a lot!", "EN deyimden sonra gerçek bildirim"],
  ["Acil çıkış kilitli, içeride duman var", "kurucu örneği: çıkış + duman"],
  ["Emergency! The emergency exit is blocked", "EN çıkıştan önce ayrı 'Emergency!'"],
  // KİLİTLİ / ENGELLİ ÇIKIŞ bugünkü gibi ACİL (yalnız çıkışın YERİNİ soran mesaj acilden çıktı).
  ["Acil çıkış kapısı kilitli", "TR kilitli acil çıkış"],
  ["Acil çıkış kilitli!", "TR kilitli acil çıkış (kısa)"],
  ["The emergency exit is locked", "EN locked emergency exit"],
  ["Fire exit is blocked by boxes", "EN blocked fire exit"],
  ["Yangın merdiveninin kapısı açılmıyor", "TR açılmayan yangın merdiveni"],
  ["The fire door won't open", "EN fire door won't open"],
  ["Emergency exit nerede? Kapı kilitli", "yer sorusu + ayrı cümlede kilit"],
  ["Yangın var, yangın merdivenine koşuyoruz", "TR yangın var + merdiven"],
  ["Ocak alev aldı!", "yangın ifadesi: alev aldı"],
  ["Perde tutuştu", "yangın ifadesi: tutuştu"],
  ["Mutfakta ateş çıktı", "yangın ifadesi: ateş çıktı"],
  ["Alevler yükseliyor", "yangın ifadesi: alevler"],
  ["There are flames in the kitchen", "EN flames"],
];

describe("kurucu kararı 09-30 — acil ağı daraltma + yangın ifadeleri", () => {
  for (const [m, why] of DECISION_0930_FALSE) {
    it(`🚨 yanlış alarm YOK: ${why} — "${m}"`, () => {
      expect(detectRiskTypes(m)).not.toContain("safety_emergency");
    });
  }
  for (const [m, why] of DECISION_0930_TRUE) {
    it(`🚨 gerçek acil: ${why} — "${m}"`, () => {
      expect(detectRiskType(m)).toBe("safety_emergency");
    });
  }
});
