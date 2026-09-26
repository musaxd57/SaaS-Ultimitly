import { describe, it, expect } from "vitest";
import { scrubStyleProfileForPublic as scrub } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR DEDEKTÖRÜ — KARAKTERİZASYON (ÖLÇÜM) KÜMESİ, 08-09.
//
// 🚨 BU TEST BİR HEDEF DEĞİL, BİR FOTOĞRAFTIR. Aşağıdaki sayılar "istediğimiz
// davranış" değil, BUGÜNKÜ davranıştır. Amacı, dedektöre dokunan kişinin
// değişimin İKİ EKSENDEKİ bedelini görmeden ilerlememesi.
//
// Neden var: `looksLikeSecret` iki yönde birden kusurlu ve ikisi AYNI ANDA doğru
// (`docs/ACIK-ISLER-2026-08-08.md` §7 ve §7h). Bu turda iki aday düzeltme
// ÖLÇÜLDÜ ve İKİSİ DE REDDEDİLDİ:
//
//   temel çizgi        → kaçan 11/18 · yanlış elenen 1/14
//   A) isim ekle       → kaçan 10/18 · yanlış elenen 2/14   (+1 yakalama, +1 FP)
//      (kasa|zil|interkom|asansör|turnike|kilit) — NET KAZANÇ YOK.
//      Sebep YAPISAL: kalıp, ismin HEMEN ARDINDAN rakam istiyor
//      (`\w{0,24}\s*[:=#.\-–—]?\s*`). "Kasa kombinasyonu 4590" gibi araya
//      açıklayıcı kelime giren yazımlar isim eklenerek yakalanamaz; yakalamak
//      için bitişikliği gevşetmek gerekir ki o da (B).
//   B) öbekli rakam    → kaçan 8/18 · yanlış elenen 4/14   (+3 yakalama, +3 FP)
//      Ve yeni üç yanlış-pozitif TAM OLARAK 08-07'de yaşanan regresyonun aynısı:
//      ADRES, ACİL TELEFON, KAPICI TELEFONU. `looksLikeSecret` kalemin TAMAMINA
//      uygulandığı için eşleşen kalem KOMPLE düşer — misafir "adres ne?"
//      dediğinde AI'ın elinde adres kalmaz.
//
// SONUÇ: bu bir regex hatası değil, YAPISAL BİR DENGE. Gerçek çözüm ayrı bir
// tur (yapısal sınıflandırıcı ya da kalem-yerine-SATIR bazlı eleme).
// ⚠️ Sayıları güncellemek serbesttir; DEĞİŞTİRMEDEN ÖNCE her iki sütuna da bak.
// ---------------------------------------------------------------------------

const flags = (line: string) => scrub(line) === null; // tek satır → elenirse null

// SIR (yakalanmalı) — §7h'nin ölçtüğü 11 + bugün yakalananlar
const SECRETS = [
  "Kapı kodu: 4590", "Anahtar kutusu 7788", "Giriş: 4590", "Kapı 4590",
  "Wifi şifresi: gunes1907", "Şifre: Hunter2", "PIN: 5678",
  "Anahtar kutusunun açılışı 4-5-9-0", "Kapı için 45 90 giriniz", "Giriş: 4 5 9 0",
  "Kasa kombinasyonu 4590", "Zil paneline 4590 yazın", "İnterkomdan 4590 tuşlayın",
  "Asansör kartının numarası 4590", "Turnikeden geçmek için 4590",
  "Elektronik kilidin açılış sayısı: 4590", "Numaramız 4590",
  "The entry sequence is four five nine zero",
];
// MEŞRU (elenmemeli) — 08-07'de yanlışlıkla elenen 6 kalem + tuzaklar
const LEGIT = [
  "Adres: Caferağa Mah. Moda Cad. No 12, posta kodu 34710",
  "Acil telefon: girişindeki güvenlik 0212 555 4433",
  "Kapıcı 0532 111 2233", "Check-in saati 15:00, check-out 11:00",
  "Daire 5, 3. kat", "Bina 1998 yılında yapıldı",
  "Kapı 3, 34710 Kadıköy", "Rezervasyon numaranız HMX4K2",
  "Gece 23:00'ten sonra sessizlik ricamız var",
  "Otopark ücreti 250 TL", "Kilit 2019 yılında yenilendi",
  "Asansör 8 kişiliktir", "Zili iki kez çalın", "Kasada havlu bulabilirsiniz",
];

describe("sır dedektörü — iki eksenli karakterizasyon", () => {
  it("bugünkü kaçan/yanlış-elenen sayıları SABİT (değişirse bilinçli olsun)", () => {
    const missed = SECRETS.filter((x) => !flags(x));
    const falsePositives = LEGIT.filter((x) => flags(x));
    expect({ missed: missed.length, falsePositives: falsePositives.length }).toEqual({
      missed: 11,
      falsePositives: 1,
    });
    // Tek bilinen yanlış-pozitif ADRES kalemidir (§7). Başka bir kalem düşerse
    // bu satır kırmızı verir — sayı aynı kalsa bile YERİ değişmiş olur.
    expect(falsePositives).toEqual([
      "Adres: Caferağa Mah. Moda Cad. No 12, posta kodu 34710",
    ]);
  });

  // 🚨 UZUNLUK KEMERİ DETERMİNİSTİK BİR ATLATMAYDI (saldırgan denetimi 08-09).
  // Tarama `text.slice(0, 4000)` yapıyordu ve yorumu şu varsayıma dayanıyordu:
  // "bir erişim sırrı ilk birkaç yüz karakterdedir". Ölçülerek ÇÜRÜTÜLDÜ:
  // 4.829 karakterlik sıradan ev kuralları + sonda `Kapı kodu: 4590` → kalem
  // SÜZGEÇTEN GEÇİYOR ve `packKnowledgeBase` ilk kalemi boyutuna bakmadan
  // TAMAMEN paketlediği için sır modele ulaşıyordu. Aynı boşluk QR yüzeyinde de
  // vardı ("sırlar bağlamdan TAMAMEN çıkarılır" değişmezini deliyordu).
  it("uzun kalemin SONUNDAKİ sır da yakalanır (4000 karakter atlatması)", () => {
    // ⚠️ TEK SATIR olmalı: `scrubStyleProfileForPublic` SATIR bazlı süzüyor,
    // yani çok satırlı bir girdide sır zaten kendi kısa satırında yakalanırdı.
    // Atlatmanın gerçek şekli, sırrın UZUN BİR SATIRIN sonunda olması.
    const filler = "Ev kuralları: sigara içilmez, evcil hayvan kabul edilmez. ".repeat(90);
    expect(filler.length).toBeGreaterThan(4000);
    expect(flags(`${filler} Kapı kodu: 4590`)).toBe(true);
    // KONTROL: sırsız uzun kalem ELENMEZ (kemeri "her uzunu at"a çevirme).
    expect(flags(filler)).toBe(false);
  });

  it("KONTROL: dedektör TAMAMEN kapatılırsa bu dosya kırmızı verir", () => {
    // Bu olmadan "her şeyi geçir" mutasyonu yalnız `missed` sayısını değiştirir
    // ve biri onu güncelleyip yeşile çevirebilir. En temel iki yakalama pinli.
    expect(flags("Kapı kodu: 4590")).toBe(true);
    expect(flags("Wifi şifresi: gunes1907")).toBe(true);
  });
});
