import { describe, it, expect } from "vitest";
import { auditClaims, claimSpans, type ClaimContext } from "@/lib/ai/claim-support";

// ---------------------------------------------------------------------------
// P5 İDDİA DESTEĞİ — ÇEVİRİDE BİRİM VE SAYI SÖZCÜĞÜ (kurucu 09-27: "P5'i şimdi canlı açma. 10 dakika = 10 minutes geçerken gerçekten
// farklı sürelerin geçmediğini test et; ardından gölge koşuda yanlış alarm ve kaçan uydurmaları raporla."). Cevap ölçüsünün kuru
// koşusunda (27.09, 552 cevap) "kanıtsız iddia" adaylarının çoğu denetimin KENDİ yanlış alarmıydı; her biri kaynak metinle yeniden
// üretildi. Her eşdeğerliğin yanında FARKLI değerin geçmediği kontrolü var (gevşeme uydurmayı gizlemesin).
// ---------------------------------------------------------------------------

const ctx = (...facts: string[]): ClaimContext => ({ facts, operator: [], guest: [] });
const u = (reply: string, c: ClaimContext) => auditClaims(reply, c).u;

describe("🚨 kesme işaretli EK birim değildir (bağlam da cevap da)", () => {
  it("bağlamda '4 km’lik' / '100 Mbps’e' / '180°C’ye' → cevaptaki '4 km' / '100 Mbps' / '180°C' desteklenir", () => {
    expect(u("Patika toplam 4 km.", ctx("İşaretli 4 km’lik toprak bir patika bulunur."))).toBe(0);
    expect(u("Por cable hasta unos 100 Mbps.", ctx("Kabloyla masa başında 100 Mbps’e kadar hız alınıyor."))).toBe(0);
    expect(u("Set it to about 180°C.", ctx("Fırını 180°C’ye ayarlamanız gerekir."))).toBe(0);
    expect(u("Patika toplam 4 km.", ctx("İşaretli 4 km'lik toprak bir patika bulunur."))).toBe(0);
  });

  it("🚨 KONTROL — farklı değer GEÇMEZ: 40 km ≠ 4 km’lik · 4 m ≠ 4 km’lik · 1000 Mbps ≠ 100 Mbps’e · 200°C ≠ 180°C’ye", () => {
    expect(u("Patika toplam 40 km.", ctx("İşaretli 4 km’lik toprak bir patika bulunur."))).toBe(1);
    expect(u("Patika 4 metre.", ctx("İşaretli 4 km’lik toprak bir patika bulunur."))).toBe(1);
    expect(u("Hasta 1000 Mbps.", ctx("Kabloyla 100 Mbps’e kadar hız alınıyor."))).toBe(1);
    expect(u("Set it to 200°C.", ctx("Fırını 180°C’ye ayarlamanız gerekir."))).toBe(1);
  });

  it("cevapta 'minutes’ walk' (kıvrık kesme) → süre okunur: 8–10 dakika desteklenir, 12 dakika desteklenmez", () => {
    const c = ctx("Metro istasyonu yürüyerek yaklaşık 8–10 dakika uzaklıktadır.");
    expect(u("It is about 8–10 minutes’ walk.", c)).toBe(0);
    expect(u("It is about 10 minutes’ walk.", c)).toBe(0);
    expect(u("It is about 12 minutes’ walk.", c)).toBe(1);
    expect(u("It is about 10 hours’ walk.", c)).toBe(1);
  });
});

describe("🚨 çeviride süre: 10 dakika = 10 minutes (7 dil) — gerçekten FARKLI süre geçmez", () => {
  const c = ctx("Plaj 10 dakika yürüme mesafesinde.");
  it("aynı süre her dilde desteklenir", () => {
    for (const r of [
      "The beach is a 10 minute walk.",
      "The beach is a 10-minute walk.",
      "The beach is ten minutes away.",
      "Der Strand ist 10 Minuten entfernt.",
      "La plage est à 10 minutes à pied.",
      "La playa está a 10 minutos.",
      "Пляж в 10 минутах ходьбы.",
      "الشاطئ على بعد 10 دقائق.",
    ]) {
      expect(u(r, c), r).toBe(0);
    }
  });
  it("🚨 farklı süre GEÇMEZ: 15 dakika · 10 saat · 10 saniye · 20 минут", () => {
    for (const r of ["The beach is a 15 minute walk.", "The beach is 10 hours away.", "The beach is 10 seconds away.", "Der Strand ist 15 Minuten entfernt.", "Пляж в 20 минутах ходьбы."]) {
      expect(u(r, c), r).toBe(1);
    }
  });
});

describe("🚨 İngilizce 'on' edatı Türkçe 'on' (10) DEĞİLDİR", () => {
  const c = ctx("Klinik hafta içi 08.30-18.00 arasında hasta kabul eder.");
  it("'on weekdays' / 'on days when it rains' / 'on weekends' iddia değil", () => {
    expect(u("They accept walk-in patients on weekdays between 08:30 and 18:00.", c)).toBe(0);
    expect(u("You can skip watering on days when it rains.", c)).toBe(0);
    expect(u("Closed on weekends.", c)).toBe(0);
    // İngilizce birim sözcük SINIRIYLA biter: "week" "weekdays"in öneki değildir ("two" sayıya çevrilmez → 2 hafta iddiası yok).
    expect(u("Cleaning is done on two weekdays.", c)).toBe(0);
  });
  it("KONTROL — Türkçe 'on dakika' 10 dakikadır: bağlamda 10 dakika varsa desteklenir, 15 dakikaysa desteklenmez", () => {
    expect(u("Market on dakika uzaklıkta.", ctx("Market 10 dakika yürüme mesafesinde."))).toBe(0);
    expect(u("Market on dakika uzaklıkta.", ctx("Market 15 dakika yürüme mesafesinde."))).toBe(1);
  });
});

describe("🚨 'night bus' bileşiği gece sayısı DEĞİLDİR", () => {
  // Bağlamda "2" YOK: sözcük sayıya çevrilseydi artakalan "2" desteksiz sayı olurdu (çevirinin kendisi sınanır).
  const noTwo = ctx("N1 gece otobüsü 01.00–05.00 arasında çalışır; durak 3 dakika mesafede.");
  // Bağlamda çıplak "2" VAR ama "2 gece" yok: rakamlı "2 night bus" gece sayısı okunmazsa sayı olarak desteklenir.
  const withTwo = ctx("N1 ve N5 olmak üzere 2 gece otobüsü hattı var; durak 3 dakika mesafede.");
  it("'two night bus routes' / 'iki gece otobüsü hattı' / '2 night bus routes' iddia değil", () => {
    expect(u("Hi, there are two night bus routes you can use.", noTwo)).toBe(0);
    expect(u("Yakında iki gece otobüsü hattı var.", noTwo)).toBe(0);
    expect(u("There are 2 night bus routes you can use.", withTwo)).toBe(0);
  });
  it("KONTROL — gerçek gece sayısı iddiadır: 'two nights' / 'iki gece' / '2 nights' bağlamda yoksa desteklenmez", () => {
    expect(u("The minimum stay is two nights.", noTwo)).toBe(1);
    expect(u("En az iki gece konaklama gerekir.", noTwo)).toBe(1);
    expect(u("The minimum stay is 2 nights.", withTwo)).toBe(1);
  });
});

describe("🚨 belirsiz 'bir' / 'a' SAYIM değildir (Türkçe belirsizlik sıfatı)", () => {
  it("'yeni bir anahtar' / 'küçük bir çocuk oyun alanı' / 'Gece bir acil durumda' iddia değil", () => {
    expect(u("Size yeni bir anahtar getirebilirim.", ctx("Kumsal’daysam yeni anahtar getirebilirim."))).toBe(0);
    expect(u("Marinada küçük bir çocuk oyun alanı var.", ctx("There is a small fenced playground on Kumsal Marina."))).toBe(0);
    expect(u("Gece bir acil durumda buraya gidebilirsiniz.", ctx("En yakın acil servis 7 dakika mesafededir."))).toBe(0);
  });
  it("KONTROL — gerçek sayım / saat / süre hâlâ iddia: '2 anahtar', '3 çocuk', 'gece birde' (01:00), 'bir saat' (60 dk)", () => {
    const c = ctx("Kumsal’daysam yeni anahtar getirebilirim. Acil servis 30 dakika mesafede. Sessizlik 23:00'te başlar.");
    expect(u("Size 2 anahtar veriyoruz.", c)).toBe(1);
    expect(u("Daire 3 çocuk için uygundur.", c)).toBe(1);
    expect(u("Sessizlik gece birde başlar.", c)).toBe(1);
    expect(u("Acil servise bir saat sürer.", c)).toBe(1);
    expect(u("Acil servise yarım saat sürer.", c)).toBe(0);
  });
});

describe("🚨 sıfat + 'bir' + ölçü adı BELİRSİZLİKTİR; katlamada 'geçen' 'gece', 'güneş' 'gün' değildir (P5 gölge koşusu 09-27)", () => {
  it("'erken bir saat' / 'iyi bir gece' / 'güzel bir gün' / 'bir geçen' / 'bir güncel' iddia değil", () => {
    const c = ctx("Servis her 40 dakikada bir kalkar. Acil servis 30 dakika mesafede.");
    expect(u("Çok daha erken bir saat için net bir bilgim yok.", c)).toBe(0);
    expect(u("İyi bir gece geçirmeniz dileğiyle.", c)).toBe(0);
    expect(u("Güzel bir gün geçirin.", c)).toBe(0);
    expect(u("Yaklaşık her 40 dakikada bir geçen servisi kullanabilirsiniz.", c)).toBe(0);
    expect(u("Size bir güncel bilgi verelim.", c)).toBe(0);
    expect(u("Güneşli bir öğleden sonra dileriz.", c)).toBe(0);
  });
  it("KONTROL — sayı okuması iddia kalır: 'bir saat sürer', 'bir gece konaklama', 'transfer bir gün sürer', 'her 30 dakikada bir'", () => {
    const c = ctx("Servis her 40 dakikada bir kalkar. Acil servis 30 dakika mesafede.");
    expect(u("Havalimanına bir saat sürer.", c)).toBe(1);
    expect(u("Bir gece konaklama gerekir.", c)).toBe(1);
    expect(u("Transfer bir gün sürer.", c)).toBe(1);
    expect(u("Yaklaşık her 50 dakikada bir geçen servisi kullanabilirsiniz.", c)).toBe(1);
  });
});

describe("🚨 süre sözcüğü diller arası: 'bir hafta' ↔ 'a week'", () => {
  it("bağlamdaki 'over a week' cevaptaki 'bir haftayı aşan'ı destekler; 'iki hafta' desteklenmez", () => {
    const c = ctx("For stays over a week, we top up once, usually on day 4 or 5.");
    expect(u("Bir haftayı aşan konaklamalarda bir kez yeniliyoruz.", c)).toBe(0);
    expect(u("İki haftayı aşan konaklamalarda bir kez yeniliyoruz.", c)).toBe(1);
    expect(u("Bir günü aşan konaklamalarda bir kez yeniliyoruz.", c)).toBe(1);
  });
});

describe("🚨 genel sayma sözcüğü (adet / tane / pieces) diller arası", () => {
  const c = ctx("There are two portable fans in the apartment.");
  it("'iki adet taşınabilir vantilatör' ↔ 'two portable fans' desteklenir", () => {
    expect(u("Odalar için iki adet taşınabilir vantilatör var.", c)).toBe(0);
    expect(u("Odalar için 2 adet vantilatör var.", c)).toBe(0);
  });
  it("KONTROL — farklı sayı desteklenmez: 'üç adet' / '3 tane'", () => {
    expect(u("Odalar için üç adet taşınabilir vantilatör var.", c)).toBe(1);
    expect(u("Odalar için 3 tane vantilatör var.", c)).toBe(1);
  });
});

describe("🚨 merdiven basamağı = steps / stairs (10-10, cevap ölçüsü yanlış alarmı: d_accessibility_5)", () => {
  // Kaynak (geliştirme seti, sentetik): "… toplam 52 iç merdiven basamağı çıkmak gerekir." Cevap: "… requires climbing 52 steps."
  // Ölçer İngilizce "steps"i adım (mesafe) okuyordu, Türkçe "basamak"ı hiç birim saymıyordu → doğru cevap "kanıtsız iddia".
  const c = ctx("Asansör arızalı olduğunda üçüncü kata ulaşmak için toplam 52 iç merdiven basamağı çıkmak gerekir.");

  it("aynı sayı: '52 steps' / '52 stairs' / '52 (merdiven) basamak' — İngilizce ve Türkçe biçimler desteklenir", () => {
    expect(u("If the lift is out of service, reaching the third floor requires climbing 52 steps.", c)).toBe(0);
    expect(u("There are 52 stairs to the flat.", c)).toBe(0);
    expect(u("Toplam 52 basamak var.", c)).toBe(0);
    expect(u("Toplam 52 merdiven basamağı var.", c)).toBe(0);
    expect(u("Sokaktan girişe 6 basamak var.", ctx("Sokak seviyesinden girişe 6 adet dış merdiven basamağı çıkmanız gerekiyor."))).toBe(0);
    expect(u("There are 54 steps.", ctx("Merdivenler toplam 54 basamaktır."))).toBe(0);
  });

  it("🚨 KONTROL — farklı değer / farklı birim GEÇMEZ", () => {
    expect(u("It requires climbing 54 steps.", c)).toBe(1);
    expect(u("There are 25 stairs to the flat.", c)).toBe(1);
    expect(u("Toplam 54 basamak var.", c)).toBe(1);
    expect(u("The flat is 52 metres from the lift.", c)).toBe(1);
    expect(u("There are 52 steps.", ctx("Bina 52 metre yüksekliğindedir."))).toBe(1);
    expect(u("There are 52 stairs.", ctx("Bina 52 metre yüksekliğindedir."))).toBe(1);
    expect(u("There are 52 steps.", ctx("Binada 52 kişilik toplantı salonu var."))).toBe(1);
  });
});

describe("🚨 hâl eki birimi koparır · eksi işaretli kat sıra sayısı değildir (10-10, cevap ölçüsü yanlış alarmları)", () => {
  // multi_33: kalem (EN) "walk back … to Lale Evleri 4 at night" · cevap "Lale Evleri 4’e gece dönüş" → "4 gece" okunuyordu.
  // d_building_4: kalem "-1 kattaki koridorda" · cevap "-1. kattaki koridorda" → "1. kat" okunuyordu.
  it("aynı olgu desteklenir", () => {
    expect(u("Lale Evleri 4’e gece dönüş için aydınlatmalı Çınar Caddesi öneriliyor.", ctx("If you walk back to Lale Evleri 4 at night, use the main lit road, Çınar Caddesi."))).toBe(0);
    expect(u("Daireye 4’te gece girişi yapılabilir.", ctx("Daire 4 için gece girişi mümkündür."))).toBe(0);
    expect(u("Depo, -1. kattaki koridorda soldan üçüncü kapı.", ctx("Depo odası, -1 kattaki koridorda soldan üçüncü kapıdır."))).toBe(0);
    // Üleştirme eki birimi KORUR.
    expect(u("Her oda için 2’şer gece.", ctx("Her oda için 2 gece."))).toBe(0);
    expect(u("Her biri 15’er dakika sürer.", ctx("Her seans 15 dakika sürer."))).toBe(0);
  });

  it("🚨 KONTROL — farklı değer / gerçek süre / gerçek kat GEÇMEZ", () => {
    expect(u("En az 4 gece kalmanız gerekiyor.", ctx("Minimum konaklama 3 gecedir."))).toBe(1);
    expect(u("Her oda için 2’şer gece.", ctx("Her oda için 3 gece."))).toBe(1);
    expect(u("Her biri 15’er dakika sürer.", ctx("Her seans 15 saat sürer."))).toBe(1);
    expect(u("Her oda için 2’şer gece.", ctx("Her oda için 2 saat."))).toBe(1);
    expect(u("Depo, -1. kattaki koridorda.", ctx("Depo odası, -2 kattaki koridorda."))).toBe(1);
    expect(u("Daire 1. katta.", ctx("Daire 2. katta."))).toBe(1);
    expect(u("Daire 1. katta.", ctx("Daire 1 numaralı kapıda, 3. katta."))).toBe(1);
  });
});

describe("🚨 Haiku incelemesi (10-10): 'basamaklı' hane sayısıdır · kat ARALIĞI korunur", () => {
  it("'6 basamaklı şifre' adım / basamak SAYILMAZ (kapı kodunun hane sayısı) — eski davranış: değerle eşleşir", () => {
    expect(u("Kapı şifresi 6 basamaklı.", ctx("Kapı şifresi 6 haneli bir koddur."))).toBe(0);
    expect(auditClaims("Kapı şifresi 6 basamaklı.", ctx("Kapı şifresi 6 haneli bir koddur.")).uc).not.toContain("distance");
    expect(u("Kapı şifresi 8 basamaklı.", ctx("Kapı şifresi 6 haneli bir koddur."))).toBe(1);
  });

  it("kat aralığında ikinci kat iddiası KORUNUR ('3-4. katlarda', 'B-3. kat'); yalnız sözcük önünde olmayan eksi bodrumdur", () => {
    expect(u("Daireler 3-4. katlarda.", ctx("Daireler 3. katta."))).toBe(1);
    expect(u("Daireler 3-4. katlarda.", ctx("Daireler 3. ve 4. katlarda."))).toBe(0);
    expect(u("Daire B-3. katta.", ctx("Daire B blok 2. katta."))).toBe(1);
    expect(u("Daire B-3. katta.", ctx("Daire B blok 3. katta."))).toBe(0);
  });
});

describe("🚨 eksi işaretli kat AYRI kattır (10-10, kurucu: \"-1. kat ile 1. kat aynı değil\")", () => {
  it("🚨 -1. kat ↔ 1. kat iki yönde de DESTEKLENMEZ (Türkçe, İngilizce, Unicode eksi)", () => {
    expect(u("Daire -1. katta.", ctx("Daire 1. katta."))).toBe(1);
    expect(u("Daire 1. katta.", ctx("Daire -1. katta."))).toBe(1);
    expect(u("Depo -1. kattaki koridorda.", ctx("Depo 1. kattaki koridorda."))).toBe(1);
    expect(u("The storage room is on the 1st floor.", ctx("Depo -1 kattadır."))).toBe(1);
    expect(u("The storage room is on floor -1.", ctx("Depo 1. kattadır."))).toBe(1);
    expect(u("Daire −1. katta.", ctx("Daire 1. katta."))).toBe(1);
  });

  it("aynı eksi kat her yazımda desteklenir; farklı eksi kat desteklenmez", () => {
    expect(u("Depo -1. kattaki koridorda.", ctx("Depo odası -1 kattaki koridorda."))).toBe(0);
    expect(u("The storage room is on the -1st floor.", ctx("Depo -1 kattadır."))).toBe(0);
    expect(u("The storage room is on floor -1.", ctx("Depo -1. katta."))).toBe(0);
    expect(u("Daire −1. katta.", ctx("Daire -1 katta."))).toBe(0);
    expect(u("Depo -1. katta.", ctx("Depo -2 katta."))).toBe(1);
  });

  it("aralık ve ayraç eksi kat DEĞİLDİR", () => {
    expect(u("Daireler 3-4. katlarda.", ctx("Daireler 3. ve 4. katlarda."))).toBe(0);
    expect(u("Daire B-3. katta.", ctx("Daire B blok 3. katta."))).toBe(0);
    expect(u("Bina 3 kat - 2 oda.", ctx("Bina 3 kat, 2 oda."))).toBe(0);
  });
});

describe("🚨 öteki dillerde kat sözcüğü (kör set incelemesi 10-23: Rusça \"на этаже -2\" düz sayı okunuyor, doğru cevap tutuluyordu)", () => {
  it("🚨 Rusça / Almanca / Fransızca / İspanyolca kat, kalemdeki Türkçe kat numarasını destekler — işaret aynı kalır", () => {
    const k = ctx("Otopark ücretsizdir; binanın -2. katında, 12 numaralı yer size ayrılmıştır.");
    expect(u("Парковка бесплатная, место № 12 на этаже -2.", k)).toBe(0);
    expect(u("Парковка бесплатная, место 12 на -2 этаже.", k)).toBe(0);
    expect(u("Der Parkplatz Nr. 12 ist in der Etage -2.", k)).toBe(0);
    expect(u("La place 12 est au -2e étage.", k)).toBe(0);
    expect(u("La plaza 12 está en la planta -2.", k)).toBe(0);
    expect(u("Die Wohnung ist im 3. Stock.", ctx("Daire 3. kattadır."))).toBe(0);
  });

  it("🚨 işaret ve sayı farkı her dilde desteklenmez; aralık ve sözcük içi kat değildir", () => {
    const k = ctx("Otopark binanın -2. katındadır.");
    expect(u("Парковка на этаже 2.", k)).toBe(1);
    expect(u("Парковка на этаже -3.", k)).toBe(1);
    expect(u("La place est à la planta 2.", k)).toBe(1);
    expect(u("Квартиры на 3-4 этаже.", ctx("Daireler 3. ve 4. katlardadır."))).toBe(0);
    // İngilizce "stock" kat değildir (Almanca sonek biçimi bilerek yok).
    expect(u("We have 5 in stock 5 days a week.", ctx("Haftada 5 gün açığız."))).toBe(0);
  });

  it("🚨 Opus 10-23 öğle B3: İspanyolca sıra eki ('3º piso', '2ª planta') kattır; aralık ve İngilizce 'stock' kat değildir", () => {
    expect(u("Está en el 3º piso.", ctx("Daire 3. kattadır."))).toBe(0);
    expect(u("Está en la 2ª planta.", ctx("Daire 2. kattadır."))).toBe(0);
    expect(u("Está en el 4º piso.", ctx("Daire 3. kattadır."))).toBe(1);
    const keys = (s: string) => claimSpans(s).claims.flatMap((c) => c.tkeys ?? []);
    // "rakam + boşluk + eksi" aralıktır (bodrum -15 değil); sonek biçiminde de aralık kat değildir.
    expect(keys("Квартиры на 10 -15 этаже.")).not.toContain("floor|-15");
    expect(keys("Квартира: этаж 2-3.")).toEqual([]);
    // İngilizce "5 stock items" / "12 stock" kat değil; Almanca noktalı "3. Stock" kat.
    expect(keys("We have 5 stock items.")).toEqual([]);
    expect(keys("12 stock")).toEqual([]);
    expect(keys("Die Wohnung ist im 3. Stock.")).toEqual(["floor|3"]);
    expect(u("Die Wohnung ist im 4. Stock.", ctx("Daire 3. kattadır."))).toBe(1);
    // Aralık dışlaması yalnız EKSİ işaretine: önünde sayı olan işaretsiz kat yine kattır (Haiku 10-23 öğle).
    expect(keys("Daire 12 3. Stock")).toEqual(["floor|3"]);
    expect(keys("квартира 12 3 этаж")).toEqual(["floor|3"]);
    expect(keys("Apt 12 2e étage")).toEqual(["floor|2"]);
    // Eksi kat önekte aynen (aralık dışlaması bodrumu bozmaz).
    expect(keys("Parkplatz auf -2 Etage")).toEqual(["floor|-2"]);
    expect(keys("на -2 этаже")).toEqual(["floor|-2"]);
  });
});

describe("🚨 eksi kat okuyucusu başka iddiayı YUTMAZ, kat olmayan sözcüğü kat saymaz (Haiku incelemesi 10-10, kodda doğrulandı)", () => {
  it("'kat' ile başlayan başka sözcük ('katlı', 'katılımcı', 'katkı') eksi kat DEĞİLDİR", () => {
    expect(u("Bina -3 katlı.", ctx("Bina 3 katlı."))).toBe(0);
    expect(u("Etkinlik -2 katılımcı ile yapılır.", ctx("Etkinlik 2 katılımcı ile yapılır."))).toBe(0);
  });

  it("aralık ('1.-3. kat', '10 -15 kat') eksi kat DEĞİLDİR", () => {
    expect(u("1.-3. kat arası ortak alan.", ctx("1. kat ve 3. kat ortak alandır."))).toBe(0);
    expect(u("Bloklar 10 -15 kat arasında.", ctx("Bloklar 10 ile 15 kat arasında."))).toBe(0);
  });

  it("🚨 'kat -N' okuyucusu önceki 'N kat' / 'N. kat' iddiasını YUTMAZ (uydurma gizlenmez)", () => {
    // Bağlamda "kat -2" de var: yutma olsaydı cevabın tek kat iddiası "-2" olur ve DESTEKLİ görünürdü.
    expect(auditClaims("Bina 3 kat -2 oda.", ctx("Bina 2 kat, 3 oda. Otopark kat -2'de.")).uc).toContain("floor");
    expect(auditClaims("Daire 1. kat -2 oda.", ctx("Daire 2. katta, 1 oda. Otopark kat -2'de.")).uc).toContain("floor");
  });

  it("'Kat: -1' ve 'kat -1' biçimi eksi kattır", () => {
    expect(u("Depo -1. katta.", ctx("Depo — Kat: -1."))).toBe(0);
    expect(u("Depo bodrum kat -1'de.", ctx("Depo 1. katta."))).toBe(1);
    expect(u("Depo bodrum kat -1'de.", ctx("Depo -1. katta."))).toBe(0);
    // Hâl ekleri: "katında", "kata", "katı".
    expect(u("Depo -1 katında.", ctx("Depo -1. katta."))).toBe(0);
    expect(u("Depo -1 katında.", ctx("Depo 1. katta."))).toBe(1);
    expect(u("Asansörle -1 kata inin.", ctx("Depo -1. katta."))).toBe(0);
    expect(u("Asansörle -1 kata inin.", ctx("Depo 1. katta."))).toBe(1);
    expect(u("The storage room is on level -1.", ctx("Depo 1. katta."))).toBe(1);
    expect(u("The storage room is on level -1.", ctx("Depo -1. katta."))).toBe(0);
  });
});
