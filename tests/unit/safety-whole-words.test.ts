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

// ---------------------------------------------------------------------------
// KURUCU KARARI K6 (09-30) — ACİL AĞI BAĞLAMLA: acil sözcüğü bir YERİN / GÜVENLİK EŞYASININ adıysa ("Polis merkezi nerede?",
// "Yangın söndürücü nerede?") ya da misafir acil olmadığını SÖYLÜYORSA ("Acil değil ama havlu lazım") mesaj tek başına acil değil.
// 🚨 Kurucu: "hırsızlık olmuş, polis merkezi nerede, sizi şikâyet edicem" ve "Yangın söndürücü nerede, mutfak yanıyor!" ACİL kalır;
// "acil değil" ifadesi gerçek tehlikeyi BASTIRMAZ. Kural: mesajda bir OLAY işareti (yanma, duman, hırsızlık, saldırı, tehdit /
// şikâyet, yaralanma, sağlık, kilitli kalma, su sızıntısı) varsa HİÇBİR nötrleme yapılmaz. Aynı kural 09-30'un çıkış yeri ve
// "not hurt" nötrlemelerine de uygulanır — "Yangın merdiveni nerede, mutfak yanıyor!" o turdan beri acil DEĞİLDİ (gerileme).
// İKİ YÖNLÜ: her yanlış alarmın yanında gerçek acil ikizi.
// ---------------------------------------------------------------------------
const K6_FALSE: [string, string][] = [
  ["Polis merkezi nerede?", "kurucu örneği: yer sorusu"],
  ["En yakın polis merkezi nerede?", "TR yer sorusu"],
  ["POLİS MERKEZİ NEREDE?", "TR büyük harf"],
  ["Polis karakolu uzak mı?", "TR karakol"],
  ["Polis merkezi nerede? Pasaportumu kaybettim", "kayıp eşya tehlike değil"],
  ["Where is the nearest police station?", "EN yer sorusu"],
  ["Is the police station far from the apartment?", "EN yer sorusu"],
  ["Yangın söndürücü nerede?", "kurucu örneği: güvenlik eşyası"],
  ["Yangın söndürücüsü var mı dairede?", "TR söndürücüsü"],
  ["Yangın tüpü nerede?", "TR yangın tüpü"],
  ["Yangın söndürme cihazı var mı?", "TR söndürme cihazı"],
  ["Where is the fire extinguisher?", "EN fire extinguisher"],
  ["Is there a fire blanket in the kitchen?", "EN fire blanket"],
  ["Acil değil ama havlu lazım", "kurucu örneği: acil değil"],
  ["ACİL DEĞİL ama çarşaf lazım", "TR büyük harf"],
  ["Acil degil ama havlu lazim", "TR ASCII"],
  ["Acil değil, müsait olunca wifi şifresini yazar mısınız?", "TR acil değil + istek"],
  ["Acil bir durum yok, sadece wifi soracaktım", "TR acil bir durum yok"],
  ["Hiç acil değil, yarın bakarsınız", "TR hiç acil değil"],
  ["Acil olmayan bir sorum var: otopark nerede?", "TR acil olmayan"],
  ["Acil bir sorun değil, ütü nerede?", "TR acil bir sorun değil"],
  ["No emergency, just wondering where the fire extinguisher is", "EN no emergency + eşya"],
  ["Not an emergency but the towels are missing", "EN not an emergency"],
  ["This isn't an emergency, but could you send the wifi password?", "EN isn't an emergency"],
  ["Non-emergency question: where is the iron?", "EN non-emergency"],
  ["Acil değil ama kombinin ışığı yanıyor", "ışık yanıyor yanma değil"],
  // Büyük harf İngilizce: Türkçe katlama "I"yı "ı" yapar ("ISN'T" → "ısn't") — kalıplar iki biçimi de kabul eder.
  ["THIS ISN'T AN EMERGENCY, BUT COULD YOU SEND THE WIFI PASSWORD?", "EN büyük harf isn't"],
  ["WHERE IS THE POLICE STATION?", "EN büyük harf police station"],
  ["EMERGENCY EXIT NEREDE?", "EN büyük harf çıkış yeri (09-30 kalıbı)"],
  ["WHERE ARE THE EMERGENCY STAIRS?", "EN büyük harf emergency stairs"],
  ["IS THE EMERGENCY STAIRWAY OPEN AT NIGHT", "EN büyük harf emergency stairway"],
  ["POLIS MERKEZI NEREDE?", "TR ASCII büyük harf"],
  ["Polis istasyonu nerede?", "TR polis istasyonu"],
  ["Where is the police department?", "EN police department"],
  ["Yangın battaniyesi var mı?", "TR yangın battaniyesi"],
  ["Yangın söndürme aleti nerede?", "TR söndürme aleti"],
  ["Acil olmasa da bakabilir misiniz, musluk damlatıyor", "TR acil olmasa da"],
  ["Acil olmadığı için yarın gelebilirsiniz", "TR acil olmadığı"],
  ["Acil sayılmaz ama ütü lazım", "TR acil sayılmaz"],
  ["Aciliyeti yok, müsait olduğunuzda wifi şifresini gönderir misiniz?", "TR aciliyeti yok"],
  ["It's not really an emergency, but the TV remote is missing", "EN not really an emergency"],
  ["It wasn't an emergency, the alarm was a test", "EN wasn't an emergency"],
];
const K6_TRUE: [string, string][] = [
  ["Hırsızlık olmuş polis merkezi nerede sizi şikayet edicem", "kurucu örneği: hırsızlık + şikâyet"],
  ["Polis merkezi nerede? Sizi şikayet edeceğim", "şikâyet tehdidi"],
  ["Polis merkezi nerede? Çantamızı çaldılar", "TR çaldılar"],
  ["Evimize hırsız girdi, polis merkezi nerede?", "TR hırsız"],
  ["Someone stole our bags, where is the police station?", "EN stole"],
  ["We were robbed. Where is the police station?", "EN robbed"],
  ["Where is the police station? A man attacked us", "EN attacked"],
  ["Yangın söndürücü nerede, mutfak yanıyor!", "kurucu örneği: eşya + yanıyor"],
  ["Where is the fire extinguisher? The kitchen is burning!", "EN burning"],
  ["Where is the fire extinguisher? Something is smoking in the oven", "EN smoking"],
  ["Acil değil ama mutfakta gaz kokusu var", "kurucu kuralı: acil değil tehlikeyi bastırmaz (gaz)"],
  ["Acil değil ama mutfak yanıyor", "acil değil + yanıyor"],
  ["Acil durum değil ama kapı kilitli kaldı", "acil değil + kilitli kaldı"],
  ["Acil değil ama çocuğum düştü, dizi kanıyor", "acil değil + yaralanma"],
  ["Acil değil ama asansörde sıkıştık", "acil değil + mahsur"],
  ["No emergency, but I think I smell something burning", "EN no emergency + burning"],
  ["Klima çalışmıyor, bu acil değil mi?!", "soru biçimi olumsuzlama değil"],
  ["Acil bir durum yok mu? Kapıda biri bağırıyor", "soru biçimi olumsuzlama değil (yok mu)"],
  ["Polis merkezi nerede? Kapıyı zorla açmaya çalışıyorlar", "zorla (olay)"],
  ["Where is the police station? Our car was broken into", "EN broken into"],
  ["Acil değil ama elim kanıyor", "yaralanma (kanıyor)"],
  ["Not an emergency but my daughter has a high fever", "sağlık (fever)"],
  ["Acil değil ama asansörde mahsur kaldık", "mahsur"],
  ["No emergency, but we're stuck outside the building", "kilitli kalma (stuck)"],
  ["Acil değil ama tavandan sızıntı var", "su sızıntısı"],
  ["Acil değil, acil!", "olumsuzlamadan sonra ayrı acil"],
  ["Yangın merdiveni nerede, mutfak yanıyor!", "09-30 gerilemesi: çıkış yeri + yanıyor"],
  ["Acil çıkış nerede? Mutfak yanıyor", "09-30 gerilemesi: acil çıkış + yanıyor"],
  ["I'm not hurt but the kitchen is burning", "09-30 gerilemesi: not hurt + burning"],
];

describe("kurucu kararı K6 (09-30) — acil ağı bağlamla: yer / eşya sorusu ve 'acil değil'", () => {
  for (const [m, why] of K6_FALSE) {
    it(`🚨 yanlış alarm YOK: ${why} — "${m}"`, () => {
      expect(detectRiskTypes(m)).not.toContain("safety_emergency");
    });
  }
  for (const [m, why] of K6_TRUE) {
    it(`🚨 gerçek acil: ${why} — "${m}"`, () => {
      expect(detectRiskType(m)).toBe("safety_emergency");
    });
  }
});
