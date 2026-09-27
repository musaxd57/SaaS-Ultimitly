import { describe, it, expect } from "vitest";
import { auditClaims, type ClaimContext } from "@/lib/ai/claim-support";

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
