import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, detectRiskTypes } from "@/lib/ai/fallback";
import { isPhysicalEmergency } from "@/lib/guest-chat";

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

// ---------------------------------------------------------------------------
// ALMANCA "rauch" (duman) TAM SÖZCÜK — kör set 9 ajanının bulgusu (10-02 gece), kurucu onayı 10-02 sabah (Sabah Kararları 49). Alt dize
// eşleşmesi Almancanın en sık fiillerinden "brauchen"i (ihtiyaç) yakalıyordu: "Ich brauche ein Handtuch" → acil (konuşma Sorunlu, yapay
// zekâ durur, ev sahibine acil e-posta). Misafir külliyatında (821) "rauch" geçen 3 mesajın 3'ü yanlış acildi. Gerçek duman bildirimi
// ("Es riecht nach Rauch", "Es raucht aus der Steckdose", "Rauchgeruch", "Rauchmelder") acil kalır.
// ---------------------------------------------------------------------------
describe("Almanca 'rauch' — tam sözcük (kurucu onayı 10-02)", () => {
  it.each([
    "Ich brauche ein Handtuch.",
    "Wir brauchen einen Parkplatz für morgen.",
    "Guten Abend! Brauchen wir unten an der Haustür einen Code?",
    "Wie kommen wir auf die Dachterrasse? Braucht man dafür einen Code?",
    "Ist die Wohnung für Nichtraucher?",
    "Wie hoch ist der Verbrauch der Klimaanlage?",
    "Ich bin Raucher, darf ich auf dem Balkon rauchen?",
    "Haben Sie gebrauchte Handtücher abgeholt?",
  ])("acil DEĞİL: %s", (m) => {
    expect(detectRiskTypes(m)).not.toContain("safety_emergency");
  });

  it.each([
    "Es riecht nach Rauch in der Küche!",
    "Überall ist Rauch!",
    "Es raucht aus der Steckdose.",
    "Starker Rauchgeruch im Flur.",
    "Der Rauchmelder piept die ganze Zeit.",
    "Im Schlafzimmer ist eine Rauchentwicklung.",
    "RAUCHHH in der Wohnung!!",
    "Eine dicke Rauchwolke kommt aus dem Fenster.",
    "Der Geruch des Rauches ist im ganzen Haus.",
  ])("acil KALIR: %s", (m) => {
    expect(detectRiskTypes(m)).toContain("safety_emergency");
  });
});

// ---------------------------------------------------------------------------
// AYNI SINIF, 10-02 sabah (kurucu: "canlıda bulunan hatayı düzelt işte güzelce en mantıklı yararlı şekilde"). Acil sözcüğü başka bir
// sözcüğün İÇİNDE ya da sabit bir öbeğin parçası olarak eşleşiyordu — sonuç: konuşma Sorunlu, yapay zekâ durur, ev sahibine acil
// e-posta; QR'da misafire "Tehlike varsa hemen 112'yi arayın." satırı. Ölçüldü (canlı kod): aşağıdaki "acil DEĞİL" cümlelerinin HEPSİ
// acil sayılıyordu. İKİ YÖNLÜ: her düzeltmenin gerçek acil ikizi aynı blokta ve acil KALIR.
// Anlam kararı gerektiren aşırı eşleşmeler ("Can we smoke on the balcony?", "İnternet düştü", "Daireye bayıldık", "Помогите,
// пожалуйста") BU TURDA DEĞİŞMEDİ — Sabah Kararları 51.
// ---------------------------------------------------------------------------
describe("sözcük içi / öbek çakışmaları — tam sözcük ve öbek nötrlemesi (kurucu onayı 10-02)", () => {
  it.each([
    // DE "feuer" sözcük içinde
    "Wo kann man heute Abend das Feuerwerk sehen?",
    "Haben Sie ein Feuerzeug für den Grill?",
    "Dürfen wir am Strand ein Lagerfeuer machen?",
    "Wo ist der Feuerlöscher? Nur zur Info.",
    // ES "humo" → EN / FR / ES övgü
    "Thanks for your sense of humour, see you soon!",
    "Love the humor in your house guide :)",
    "Merci pour votre humour, à bientôt !",
    "¡Gracias por el buen humor, nos encantó!",
    // FR "blessé" → EN övgü
    "We felt so blessed to stay at your beautiful apartment, thank you!",
    // EN "smoke" sözcük içinde + "smoke-free" öbeği
    "We are smokers, is there a balcony?",
    "Where can we buy smoked salmon nearby?",
    "Is the apartment smoke-free?",
    "Is it a smoke free apartment?",
    // EN "can't get in" → "get in touch" (ulaşamıyorum)
    "I can't get in touch with the cleaner, can you help?",
    "We cant get in touch with the host by phone.",
    "I can’t get in touch with anyone at the reception.",
    "I cannot get in touch with the host.",
    // olay bağlamı kalıbıyla aynı biçimler: öbek nötrlenmezse ikinci nötrleme (benzin istasyonu) bu cümlede GERİ ALINIRDI
    "Where is the gas station? I cannot get in touch with the host.",
    "Where is the gas station? I can't get in touch with the host.",
    // EN yer adı (police station ile aynı sınıf, K6)
    "Where is the nearest gas station?",
    "Are there gas stations on the way to the airport?",
    // EN "flooded with light" (ışık dolu)
    "The apartment is flooded with natural light, love it!",
    "The living room is flooded with sunlight in the morning.",
    "Our room was flooded with daylight.",
    "The terrace is flooded with sunshine all afternoon.",
    // FR / ES havai fişek, trafik ışığı, "acelesi yok"
    "Où peut-on voir le feu d'artifice ce soir ?",
    "On peut voir le feu d’artifice depuis le balcon ?",
    "Le feux d'artifice commence à quelle heure ?",
    "Après le feu rouge, on tourne à gauche ?",
    "Vous nous donnez le feu vert pour arriver à 14h ?",
    "Il n'y a pas le feu, répondez quand vous pouvez.",
    "¿Dónde podemos ver los fuegos artificiales?",
    // RU "ранен" sözcük içinde (bagaj saklama, kaydedildi)
    "Можно ли оставить багаж на хранение после выезда?",
    "Мой номер телефона сохранен у вас?",
    // AR "مصاب" → "المصابيح" (lambalar)
    "المصابيح في غرفة النوم لا تعمل",
    "أين المصابيح الاحتياطية؟",
    // TR ASCII / sözcük sınırı çakışmaları
    "Evin her yeri süper temizdi, teşekkürler.",
    "Kumanda priz yanında mı duruyor?",
    "Şarj aletini priz yanına bıraktım.",
    "Modem kablo yanındaki rafta mı?",
  ])("acil DEĞİL: %s", (m) => {
    expect(detectRiskTypes(m)).not.toContain("safety_emergency");
  });

  it.each([
    "Es gibt ein Feuer in der Küche!",
    "Feuer! Bitte helfen Sie!",
    "Die Feuerwehr ist schon unterwegs!",
    "Der Feueralarm geht ständig los.",
    "Der Feuermelder piept die ganze Zeit.",
    "Wegen des Feuers ist die Küche voller Ruß.",
    "Hay humo en la cocina.",
    "Sale mucho humo del horno.",
    "Hay humos raros en el baño.",
    "Hay una humareda en el pasillo.",
    "Mon fils est blessé.",
    "Ma femme est blessée.",
    "Deux personnes blessées dans l'escalier.",
    "Deux hommes blessés dans l'escalier.",
    "There is smoke coming from the oven!",
    "Smoke everywhere!",
    "The oven smokes a lot.",
    "The smoke alarm is beeping.",
    "Is the apartment smoke-free? There is smoke in the hallway.",
    "I'm locked out and can't get in.",
    "I can't get in, the door code doesn't work.",
    "We smell gas next to the gas station.",
    "The kitchen is flooded with water!",
    "Les feux d'artifice ont mis le feu au balcon !",
    "Il y a le feu dans l'appartement !",
    "Мой друг ранен, нужна помощь.",
    "Она ранена.",
    "У него ранение на ноге.",
    "صديقي مصاب ويحتاج إلى مساعدة",
    "صديقتي مصابة بجروح",
    "هناك مصابين في الشقة",
    "Her yeri su bastı!",
    "Banyoda her yeri su oldu.",
    "Mutfakta her yeri suyla doldu.",
    "Odanın her yeri suya battı.",
    "Mutfağın her yeri sularla dolu.",
    "Priz yanıyor!",
    "Priz yandı, koku var.",
    "Priz yanmış.",
    "Priz yanık görünüyor.",
    "Kablo yanıyor!",
    "Kablo yandı.",
    "Kablo yanmış.",
    "Kablo yanık görünüyor.",
  ])("acil KALIR: %s", (m) => {
    expect(detectRiskTypes(m)).toContain("safety_emergency");
  });

  it("QR: ışık dolu daire övgüsü misafire 112 satırı ÜRETMEZ; gerçek su baskını üretir", () => {
    expect(isPhysicalEmergency("The apartment is flooded with natural light, love it!")).toBe(false);
    expect(isPhysicalEmergency("The kitchen is flooded!")).toBe(true);
  });
});
