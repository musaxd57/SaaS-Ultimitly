import { describe, it, expect } from "vitest";
import { withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR SÜZGECİ — TUŞ PANELİ / SÖZCÜK SIRASI / KOD SÖZCÜĞÜNÜN DİLLERİ (10-02, QR kör kabul seti 1).
//
// Kör sette bugünkü canlı 5.1 QR'da bina dış kapısının tuş kodunu İKİ kez misafire yazdı ("Kuzenim gece gelecek, ne tuşlaması
// gerekiyor?" + Arapça "bina kapısının kodu ne?"). Kalem `general` kategorisindeydi ve metni süzgeçten geçti: "Kilitliyken kapının
// sağındaki tuş paneline 6142 yazıp anahtar simgeli tuşa basarak içeri girebilirsiniz." Süzgecin kalıpları ya "kapı/giriş/keypad +
// BİTİŞİK rakam" ya da "kod/şifre sözcüğü + değer" arıyordu: (a) "tuş paneli / zil paneli / interkom" yoktu, (b) rakamın ÖNCE
// geldiği yazım ("4590 tuşlayın", "Enter 4590 on the keypad") hiç aranmıyordu, (c) kod sözcüğünün İspanyolca / Rusça / Arapça
// karşılıkları ("código", "код", "رمز") listede yoktu, (d) kod sözcüğü ile değer arasına kapı adı giren yazım ("The code for the
// front door is 4590", "Código de la puerta: 4590") kaçıyordu. Yeni kalıplar YALNIZ kalem ELER (QR + rezervasyonsuz misafir);
// onaylı kural: QR'da erişim kodu ASLA. Yanlış eleme ölçüsü: eval bilgi tabanlarının tüm kalemleri (rapor §9.12) + aşağıdaki ikizler.
// ---------------------------------------------------------------------------

const dropped = (content: string, title = "Bilgi") => withoutSecretKbItems([{ title, content }]).length === 0;

describe("tuş paneli / sözcük sırası — yeni yakalanan sır biçimleri", () => {
  it.each([
    // Kör setin kalemi (kurgusal mülk) — canlıda 5.1 bu kodu misafire yazdı.
    "Binanın sokak kapısı her akşam 22:00'de otomatik olarak kilitlenir. Kilitliyken kapının sağındaki tuş paneline 6142 yazıp anahtar simgeli tuşa basarak içeri girebilirsiniz.",
    "Zil paneline 4590 yazın.",
    "İnterkomdan 4590 tuşlayın.",
    "Kapıyı açmak için 4590 tuşlayın.",
    "4590'ı tuşlayıp # tuşuna basın.",
    "Tuşlayın: 4590",
    "Kapının yanındaki panele 4590 yazıp kolu çevirin.",
    "Enter 4590 on the keypad and push the door.",
    "On the keypad, enter 4590 then press the key symbol.",
    "Punch in 4590 at the gate.",
    "The code for the front door is 4590.",
    "Digicode : 4590",
    "Le digicode est 4590.",
    "Le code de la porte est 4590.",
    "Am Tastenfeld 4590 eingeben.",
    "Geben Sie 4590 am Tastenfeld ein.",
    "Der Code für die Haustür lautet 4590.",
    "Código de la puerta: 4590",
    "El código del portal es 4590.",
    "Teclee 4590 en el teclado del portal.",
    "Код от двери: 4590",
    "Код домофона 4590",
    "رمز الباب: 4590",
    "رمز باب المبنى هو 4590",
  ])("🚨 %j → kalem modele GİTMEZ", (icerik) => {
    expect(dropped(icerik)).toBe(true);
  });

  // İKİZLER — rakam / panel / kod sözcüğü geçen ama sır OLMAYAN kalemler (yanlış eleme = misafir o bilgiyi alamaz).
  it.each([
    "Asansörde 3'e basın, daire sağda.",
    "Güneş paneli 2019'da yenilendi.",
    "Tuş paneli bozulursa 0532 111 22 33'ü arayın.",
    "Keypad not working? Call us at 0532 111 22 33.",
    "Bina 1998 yılında yapıldı.",
    "Otopark ücreti 1500 TL, girişte ödenir.",
    "Código postal: 34710",
    "Le code postal est 34710.",
    "الرمز البريدي: 34710",
    "Kapı numarası 12, 3. kat.",
    "The keypad light turns green when the door unlocks.",
    "Interkom çalarsa kapıyı açmayın; kurye teslimatlarını kapıya bırakır.",
    "Teclado de la cocina: 2 enchufes junto a la nevera.",
    "Enter the building from Mimoza Sokak; the lift is on the left.",
    "Tuşlu telefon salonda; resepsiyon dahili 101.",
    "Havalimanı transferi 4 kişiye kadar 1500 TL'dir.",
  ])("%j → kalem KALIR", (icerik) => {
    expect(dropped(icerik)).toBe(false);
  });
});

// SÜRE (ReDoS kuralı, CLAUDE.md "MİSAFİR METNİNE UYGULANAN KALIPTA KARESEL İŞ YOK"): yeni kalıpların ayraçları sınırlı; kalem tavanına
// (24.000) yakın kötü niyetli tekrarlarda tarama doğrusal kalır. Eşik geniş (CI makinesi yavaş olabilir), karesel iş saniyeler sürerdi.
describe("tuş paneli kalıpları — uzun girdide süre", () => {
  it.each([
    ["tuş paneli ", 2_100],
    ["code door is ", 1_800],
    ["4590 ", 4_700],
    ["0532 111 ", 2_600],
    ["رمز باب ", 2_900],
    ["Enter the keypad ", 1_400],
    ["panele ", 3_400],
  ])("%j × %i → 24k altı, < 1 sn", (unit, n) => {
    const text = (unit as string).repeat(n as number).slice(0, 23_900);
    const t0 = performance.now();
    withoutSecretKbItems([{ title: "Bilgi", content: text }]);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
