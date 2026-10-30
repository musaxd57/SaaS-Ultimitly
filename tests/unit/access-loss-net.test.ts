import { describe, it, expect } from "vitest";
import { detectRiskType, detectRiskTypes, isAccessLossText, classifyFallback } from "@/lib/ai/fallback";
import { cleanGateEvidence } from "@/lib/ai/gate-evidence";
import { passesAutoReplySafetyGate } from "@/lib/automation";

// ---------------------------------------------------------------------------
// ERİŞİM KAYBI AĞI (kurucu 10-29 gece, GD4: "anahtarı kaybettim, bulamıyorum gibi şeyler hosta kalsın, öncelikli olarak hosta
// gösterilsin"). Önceki durum (ölçüldü, `docs/claude/sozcuk-aglari.md`): "Anahtarı kaybettim" konu ağında `checkin` sayılıyordu ("anahtar"
// sözcüğü giriş KONUSU listesinde), hiçbir risk ağı bir KAYIP OLAYINI tanımıyordu → tutulmuyor, e-posta yok, öncelik yok; yedi dilin
// beşinde ("Schlüssel verloren", "perdu la clé" …) hiç etiket yoktu.
// Ağ yalnız SIKILAŞTIRIR (bir oto-gönderimi ENGELLEYEBİLİR, asla sebep olmaz) — kurucunun "sezgi yalnız ipucu ya da sıkılaştıran yedek"
// ilkesine uygun. Ek / koşul eki okunmaz: kayıp fiilinin TAM biçimleri ("kaybettim", "lost my") aranır, varsayım ("kaybedersem", "if I
// lose") bilerek eşleşmez — çünkü o biçim LİSTEDE YOK, ek okuyan bir kural yüzünden değil.
// ---------------------------------------------------------------------------

describe("erişim kaybı — tutulması gereken mesajlar (her dilde)", () => {
  it.each([
    // TR
    "Anahtarı kaybettim",
    "Anahtarımı kaybettim, yedek var mı?",
    "ANAHTARI KAYBETTİM",
    "anahtari kaybettim",
    "Anahtarı galiba dün akşam restoranda kaybettik",
    "Anahtarlar kayboldu",
    "Anahtar kayıp, ne yapacağız?",
    "Anahtarımı bulamıyorum",
    "Anahtarları bulamadık",
    "Çantam çalındı, anahtar da içindeydi",
    "Kapı kartını kaybettim",
    "Oda kartımı bulamıyorum",
    "Anahtarları içeride unuttum, kapı kapandı",
    "Anahtarı unuttum",
    "Anahtar kilitte kırıldı",
    "Anahtar kutusu boş",
    "Kapıda kaldık, ne yapmalıyız?",
    "Otopark kumandasını kaybettim",
    // EN
    "I lost my key",
    "We lost the keys",
    "I can't find my keys",
    "Someone stole our keys",
    "I lost my fob",
    "I lost the key card",
    "I locked myself out",
    "I'm locked out",
    "Kapıda kilitli kaldım",
    "Wir sind ausgesperrt",
    "Me quedé fuera del apartamento",
    "The lockbox is empty",
    "The key broke in the lock",
    "I forgot my keys inside",
    "The key is missing from the key box",
    // DE / FR / ES / RU / AR
    "Ich habe meinen Schlüssel verloren",
    "Wir finden den Schlüssel nicht",
    "J'ai perdu la clé",
    // Aksansız yazım (sağlamlık ölçümü 10-29 gece buldu): "clé" → "cle", "perdí" → "perdi"
    "J'ai perdu la cle de l'appartement",
    "Perdi la llave",
    "Je ne trouve pas mes clés",
    "He perdido la llave",
    "No encuentro las llaves",
    "Я потерял ключ",
    "Не могу найти ключи",
    "فقدت المفتاح",
    "لا أجد المفاتيح",
  ])("%j → access_security", (m) => {
    expect(isAccessLossText(m)).toBe(true);
    expect(detectRiskTypes(m)).toContain("access_security");
  });
});

describe("erişim kaybı — KONTROL: dokunulmayan mesajlar", () => {
  it.each([
    // Altın senaryo (golden-scenarios:511): giriş SORUSU otomatik cevaplanır.
    "Anahtarı nereden alacağız?",
    "Anahtar teslimi nasıl oluyor?",
    "Where do I pick up the keys?",
    "Should we leave the keys inside at checkout?",
    // Varsayım biçimi listede YOK (ek okunmuyor — kayıp fiilinin bu biçimi aranmıyor).
    "Anahtarı kaybedersem ne olur?",
    "What if I lose the key?",
    // Anahtar olmayan nesne
    "Pasaportumu kaybettim",
    "Kartımı kaybettim",
    "I lost my credit card",
    "Kumandayı bulamıyorum",
    "Wi-Fi şifresini bulamıyorum",
    // Aynı cümlede başka anlam ("sıkıştık" trafikte; "got lost" yolda; "forgot to ask")
    "Trafikte sıkıştık, anahtarı nereden alacağız?",
    "We got lost, where is the key box?",
    "I forgot to ask, where do we leave the keys?",
    "We got stuck in traffic, where do we pick up the keys?",
    // Ayrı cümleler: anahtar alındı, kaybolan cüzdan
    "Anahtarı aldım. Cüzdanımı kaybettim.",
    // "Turkey" içindeki "key" (W2 tam sözcük kuralı); "keyboard" anahtar değil (tam sözcük)
    "We love Turkey! Lost in the beauty of it.",
    // Acil ağının "can't get in" / "içeri giremiyor" kalıpları BİLEREK alınmadı (erken giriş sorusu, "get in touch")
    "I can't get in touch with the cleaner",
    "İçeri giremiyor muyuz erken?",
    "I lost my keyboard charger",
    // Ayrık olumsuzluk iki parçası birlikte aranır: yalnız "nicht" kayıp değildir
    "Den Schlüssel brauchen wir nicht mehr.",
  ])("%j → access_security DEĞİL", (m) => {
    expect(isAccessLossText(m)).toBe(false);
    expect(detectRiskTypes(m)).not.toContain("access_security");
  });
});

describe("öncelik sırası ve kapı kanıtı", () => {
  it("acil (kilitli kaldı) etiketi önde kalır — tur düzeyi tutuş değişmez", () => {
    expect(detectRiskType("Kilitli kaldım, anahtarı içeride unuttum")).toBe("safety_emergency");
    expect(detectRiskTypes("Kilitli kaldım, anahtarı içeride unuttum")).toEqual(["safety_emergency", "access_security"]);
  });

  it("yalnız kayıp: ilk etiket access_security; şikâyet sınıflandırması DEĞİŞMEDİ (konu yine giriş)", () => {
    expect(detectRiskType("Anahtarı kaybettim")).toBe("access_security");
    expect(classifyFallback("Anahtarı kaybettim").isComplaint).toBe(false);
  });

  it("kapı kanıtı access_security etiketini düşürmez (kelime ağı uyarıları kümesinde)", () => {
    expect(cleanGateEvidence({ lx: ["access_security", "uydurma"] })?.lx).toEqual(["access_security"]);
  });
});

describe("kanal kapısı (öğe kipi kapalı): önceki cevapsız mesajdaki kayıp anahtar sonraki zararsız soruyla gömülmez", () => {
  const OK = { intent: "wifi", riskLevel: "none", confidence: 0.95, source: "openai", reply: "Wi-Fi şifresi Lale2024." };
  it("'Anahtarı kaybettim' + ardından 'Wi-Fi şifresi ne?' → tutulur", () => {
    expect(passesAutoReplySafetyGate(OK, "Wi-Fi şifresi ne?", { pendingGuestMessages: ["Anahtarı kaybettim"] })).toBe(false);
  });
  it("KONTROL: 'Anahtarı nereden alacağız?' + 'Wi-Fi şifresi ne?' → bugünkü gibi gider", () => {
    expect(passesAutoReplySafetyGate(OK, "Wi-Fi şifresi ne?", { pendingGuestMessages: ["Anahtarı nereden alacağız?"] })).toBe(true);
  });
});
